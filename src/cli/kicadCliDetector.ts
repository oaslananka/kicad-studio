import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import * as vscode from 'vscode';
import { CLI_CAPABILITY_COMMANDS, SETTINGS } from '../constants';
import type { DetectedKiCadCli } from '../types';

export function getCliCandidates(platform = process.platform, configuredPath = ''): string[] {
  const candidates: string[] = [];
  if (configuredPath) {
    candidates.push(configuredPath);
  }

  if (platform === 'win32') {
    const programFiles = process.env['PROGRAMFILES'] ?? 'C:\\Program Files';
    const programFilesX86 = process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)';
    const localAppData = process.env['LOCALAPPDATA'] ?? '';
    for (const version of ['10.0', '10', '9.0', '9', '8.0', '8', '7.0', '7', '6.0', '6']) {
      candidates.push(path.join(programFiles, 'KiCad', version, 'bin', 'kicad-cli.exe'));
      candidates.push(path.join(programFilesX86, 'KiCad', version, 'bin', 'kicad-cli.exe'));
      if (localAppData) {
        candidates.push(
          path.join(localAppData, 'Programs', 'KiCad', version, 'bin', 'kicad-cli.exe')
        );
      }
    }
  } else if (platform === 'darwin') {
    candidates.push(
      '/Applications/KiCad/KiCad.app/Contents/MacOS/kicad-cli',
      '/usr/local/bin/kicad-cli',
      '/opt/homebrew/bin/kicad-cli'
    );
  } else {
    candidates.push(
      '/usr/bin/kicad-cli',
      '/usr/local/bin/kicad-cli',
      '/snap/bin/kicad-cli',
      path.join(os.homedir(), '.local', 'bin', 'kicad-cli'),
      path.join(os.homedir(), '.var', 'app', 'org.kicad.KiCad', 'data', 'bin', 'kicad-cli')
    );
  }

  return [...new Set(candidates)];
}

export class KiCadCliDetector {
  private detected: DetectedKiCadCli | undefined;
  private readonly capabilityCache = new Map<string, boolean>();
  private warnedWorkspaceConfiguredPath = false;

  async detect(notifyOnMissing = false): Promise<DetectedKiCadCli | undefined> {
    if (this.detected) {
      return this.detected;
    }

    const configuredPath = vscode.workspace
      .getConfiguration()
      .get<string>(SETTINGS.cliPath, '')
      .trim();
    this.warnIfWorkspaceConfiguredPath(configuredPath);

    const candidates = getCliCandidates(process.platform, configuredPath);
    for (const candidate of candidates) {
      const resolved = await this.validateCandidate(candidate, candidate === configuredPath ? 'settings' : 'common-path');
      if (resolved) {
        this.detected = resolved;
        return resolved;
      }
    }

    const fromPath = this.findOnPath();
    if (fromPath) {
      const resolved = await this.validateCandidate(fromPath, 'path');
      if (resolved) {
        this.detected = resolved;
        return resolved;
      }
    }

    if (notifyOnMissing) {
      const selected = await vscode.window.showErrorMessage(
        'KiCad CLI (kicad-cli) was not found.',
        'Download KiCad',
        'Set Manual Path',
        'Help'
      );
      if (selected === 'Download KiCad') {
        await vscode.env.openExternal(vscode.Uri.parse('https://www.kicad.org/download/'));
      } else if (selected === 'Set Manual Path') {
        await vscode.commands.executeCommand('workbench.action.openSettings', SETTINGS.cliPath);
      } else if (selected === 'Help') {
        await vscode.env.openExternal(
          vscode.Uri.parse(
            'https://github.com/oaslananka/kicad-studio/blob/main/docs/installation.md'
          )
        );
      }
    }

    return undefined;
  }

  clearCache(): void {
    this.detected = undefined;
    this.capabilityCache.clear();
  }

  getVersion(): number | undefined {
    if (!this.detected) {
      return undefined;
    }
    return Number.parseInt(this.detected.version.split('.')[0] ?? '', 10) || undefined;
  }

  async hasCapability(command: keyof typeof CLI_CAPABILITY_COMMANDS): Promise<boolean> {
    const detected = await this.detect();
    if (!detected) {
      return false;
    }

    if (this.capabilityCache.has(command)) {
      return this.capabilityCache.get(command) ?? false;
    }

    const args = [...CLI_CAPABILITY_COMMANDS[command], '--help'];
    const result = spawnSync(detected.path, args, { encoding: 'utf8' });
    const supported = result.status === 0 || /Usage:/i.test(`${result.stdout}\n${result.stderr}`);
    this.capabilityCache.set(command, supported);
    return supported;
  }

  private async validateCandidate(
    candidate: string,
    source: DetectedKiCadCli['source']
  ): Promise<DetectedKiCadCli | undefined> {
    if (!candidate) {
      return undefined;
    }

    const resolvedCandidate = this.normalizeCandidate(candidate);
    if (!fs.existsSync(resolvedCandidate)) {
      return undefined;
    }

    const result = spawnSync(resolvedCandidate, ['--version'], { encoding: 'utf8' });
    if (result.status !== 0) {
      return undefined;
    }

    const output = `${result.stdout}\n${result.stderr}`.trim();
    if (!this.looksLikeKiCadCli(output, resolvedCandidate)) {
      return undefined;
    }

    const versionMatch = output.match(/(\d+\.\d+(?:\.\d+)?)/);
    const version = versionMatch?.[1] ?? 'unknown';
    return {
      path: resolvedCandidate,
      version,
      versionLabel: `KiCad ${version}`,
      source
    };
  }

  private findOnPath(): string | undefined {
    const finder = process.platform === 'win32' ? 'where' : 'which';
    const result = spawnSync(finder, ['kicad-cli'], { encoding: 'utf8' });
    if (result.status !== 0) {
      return undefined;
    }
    return result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);
  }

  private normalizeCandidate(candidate: string): string {
    const normalized = path.resolve(candidate.trim());
    try {
      return fs.realpathSync.native(normalized);
    } catch {
      return normalized;
    }
  }

  private looksLikeKiCadCli(versionOutput: string, candidate: string): boolean {
    return /\bkicad(?:-cli)?\b/i.test(versionOutput) || /kicad-cli(?:\.exe)?$/i.test(path.basename(candidate));
  }

  private warnIfWorkspaceConfiguredPath(configuredPath: string): void {
    if (!configuredPath || this.warnedWorkspaceConfiguredPath) {
      return;
    }

    const inspect = vscode.workspace
      .getConfiguration()
      .inspect<string>(SETTINGS.cliPath);
    if (!inspect?.workspaceValue && !inspect?.workspaceFolderValue) {
      return;
    }

    this.warnedWorkspaceConfiguredPath = true;
    void vscode.window.showWarningMessage(
      'KiCad Studio is using a workspace-level kicad-cli path override. Only use workspace overrides for repositories you trust.'
    );
  }
}
