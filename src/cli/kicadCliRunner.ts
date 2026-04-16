import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import * as vscode from 'vscode';
import { CLI_TIMEOUT_MS, SETTINGS } from '../constants';
import { CliExitError, KiCadCliNotFoundError, KiCadCliTimeoutError } from '../errors';
import type { CliResult, CliRunOptions } from '../types';
import { Logger } from '../utils/logger';
import { findSiblingProjectFile } from '../utils/pathUtils';
import { KiCadCliDetector } from './kicadCliDetector';

/**
 * Runs kicad-cli commands with progress reporting and request de-duplication.
 */
export class KiCadCliRunner {
  private readonly controllers = new Set<AbortController>();
  private readonly runningCommands = new Map<string, Promise<CliResult>>();

  constructor(
    private readonly detector: KiCadCliDetector,
    private readonly logger: Logger
  ) {}

  async run<T>(options: CliRunOptions): Promise<CliResult<T>> {
    const key = options.command.join(' ');
    const existing = this.runningCommands.get(key);
    if (existing) {
      return existing as Promise<CliResult<T>>;
    }

    const next = this.executeCommand<T>(options);
    this.runningCommands.set(key, next as Promise<CliResult>);
    try {
      return await next;
    } finally {
      this.runningCommands.delete(key);
    }
  }

  async runWithProgress<T>(options: CliRunOptions): Promise<T> {
    return vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        cancellable: true,
        title: options.progressTitle
      },
      async (progress, token) => {
        const progressAbort = new AbortController();
        token.onCancellationRequested(() =>
          progressAbort.abort(new Error(`KiCad command cancelled: ${options.command.join(' ')}`))
        );
        const result = await this.run<T>({
          ...options,
          signal: composeAbortSignals(options.signal, progressAbort.signal),
          onProgress: (message) => {
            if (message) {
              progress.report({ message: message.slice(0, 120) });
              options.onProgress?.(message);
            }
          }
        });
        return (result.parsed as T | undefined) ?? (result.stdout as unknown as T);
      }
    );
  }

  cancelAll(): void {
    for (const controller of this.controllers) {
      controller.abort(new Error('KiCad commands cancelled.'));
    }
    this.controllers.clear();
  }

  private async executeCommand<T>(options: CliRunOptions): Promise<CliResult<T>> {
    const detected = await this.detector.detect(true);
    if (!detected) {
      throw new KiCadCliNotFoundError();
    }

    const command = this.buildCommandWithDefineVars(options.command, options.cwd);
    const controller = new AbortController();
    const signal = composeAbortSignals(options.signal, controller.signal);
    this.controllers.add(controller);
    const startedAt = Date.now();
    this.logger.info(`Running ${detected.path} ${command.join(' ')}`);

    return new Promise<CliResult<T>>((resolve, reject) => {
      const child = spawn(detected.path, command, {
        cwd: options.cwd,
        env: process.env,
        signal,
        stdio: ['ignore', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';
      const timeout = setTimeout(() => {
        controller.abort(new KiCadCliTimeoutError(command.join(' '), CLI_TIMEOUT_MS));
      }, CLI_TIMEOUT_MS);

      const finish = (handler: () => void): void => {
        clearTimeout(timeout);
        this.controllers.delete(controller);
        handler();
      };

      child.stdout.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf8');
        stdout += text;
        options.onProgress?.(text.trim());
        this.logger.info(text.trimEnd());
      });

      child.stderr.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf8');
        stderr += text;
        options.onProgress?.(text.trim());
        this.logger.warn(text.trimEnd());
      });

      child.on('error', (error) => {
        finish(() => reject(this.normalizeError(error, options.command.join(' '))));
      });

      child.on('close', (exitCode) => {
        finish(() => {
          const result: CliResult<T> = {
            stdout,
            stderr,
            exitCode: exitCode ?? -1,
            durationMs: Date.now() - startedAt,
            parsed: options.parseOutput?.(stdout, stderr) as T | undefined
          };

          if ((exitCode ?? -1) !== 0) {
            reject(
              new CliExitError({
                command: command.join(' '),
                code: exitCode ?? -1,
                stdout,
                stderr: this.normalizeCliFailure(stderr || stdout || '')
              })
            );
            return;
          }
          resolve(result);
        });
      });
    });
  }

  private normalizeError(error: unknown, command: string): Error {
    if (error instanceof KiCadCliTimeoutError) {
      return error;
    }
    if (error instanceof Error && /ENOENT/i.test(error.message)) {
      return new KiCadCliNotFoundError();
    }
    if (error instanceof Error && error.name === 'AbortError') {
      if (error.cause instanceof Error) {
        return error.cause;
      }
      return new Error(`KiCad command cancelled before completion: ${command}.`);
    }
    return error instanceof Error ? error : new Error(String(error));
  }

  private normalizeCliFailure(message: string): string {
    if (/ENOENT/i.test(message)) {
      return new KiCadCliNotFoundError().message;
    }
    if (/No such file/i.test(message)) {
      return `KiCad command failed because a required file was not found.\n${message}`;
    }
    return `KiCad command failed.\n${message}`;
  }

  private buildCommandWithDefineVars(command: string[], cwd: string): string[] {
    const configuredVars = vscode.workspace
      .getConfiguration()
      .get<Record<string, string>>(SETTINGS.cliDefineVars, {});
    const projectVars = this.readProjectTextVariables(command, cwd);
    const mergedVars = {
      ...projectVars,
      ...configuredVars
    };

    const defineArgs = Object.entries(mergedVars)
      .filter((entry): entry is [string, string] => typeof entry[0] === 'string' && typeof entry[1] === 'string')
      .flatMap(([key, value]) => ['--define-var', `${key}=${value}`]);

    return defineArgs.length ? [...defineArgs, ...command] : command;
  }

  private readProjectTextVariables(command: string[], cwd: string): Record<string, string> {
    const targetFile = command.find((entry) => entry.endsWith('.kicad_pro') || entry.endsWith('.kicad_sch') || entry.endsWith('.kicad_pcb'));
    const projectFile = targetFile
      ? findSiblingProjectFile(path.isAbsolute(targetFile) ? targetFile : path.join(cwd, targetFile))
      : undefined;
    if (!projectFile || !fs.existsSync(projectFile)) {
      return {};
    }

    try {
      const raw = JSON.parse(fs.readFileSync(projectFile, 'utf8')) as {
        text_variables?: Record<string, string> | undefined;
      };
      return raw.text_variables ?? {};
    } catch {
      return {};
    }
  }
}

function composeAbortSignals(
  primary: AbortSignal | undefined,
  secondary: AbortSignal
): AbortSignal {
  if (!primary) {
    return secondary;
  }
  if (primary.aborted) {
    return primary;
  }

  const controller = new AbortController();
  const abortFrom = (source: AbortSignal): void => {
    controller.abort(source.reason);
  };

  primary.addEventListener('abort', () => abortFrom(primary), { once: true });
  secondary.addEventListener('abort', () => abortFrom(secondary), { once: true });
  return controller.signal;
}
