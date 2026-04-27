import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import * as vscode from 'vscode';
import type { McpInstallStatus } from '../types';

export interface McpInstallerCandidate {
  id: 'uvx' | 'pipx' | 'pip';
  label: string;
  description: string;
  command: string;
  args: string[];
}

function runExecFile(
  command: string,
  args: string[],
  timeoutMs: number
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { encoding: 'utf8', timeout: timeoutMs },
      (error, stdout, stderr) => {
        if (error) {
          reject(error);
        } else {
          resolve({ stdout: stdout ?? '', stderr: stderr ?? '' });
        }
      }
    );
  });
}

async function run(
  command: string,
  args: string[]
): Promise<{ ok: boolean; output: string }> {
  try {
    const { stdout, stderr } = await runExecFile(command, args, 8_000);
    const output = `${stdout}\n${stderr}`.trim();
    return { ok: true, output };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, output: message };
  }
}

export class McpDetector {
  async detectKicadMcpPro(): Promise<McpInstallStatus> {
    const uvxResult = await this.tryUvx();
    if (uvxResult.found) {
      return {
        found: true,
        command: 'uvx',
        version: uvxResult.version,
        source: 'uvx'
      };
    }

    const binaryResult = await this.tryBinary();
    if (binaryResult.found) {
      return {
        found: true,
        command: 'kicad-mcp-pro',
        version: binaryResult.version,
        source: 'global'
      };
    }

    const pipResult = await this.tryPip();
    if (pipResult.found) {
      return {
        found: true,
        command: 'kicad-mcp-pro',
        version: pipResult.version,
        source: 'pip'
      };
    }

    const pipxResult = await this.tryPipx();
    if (pipxResult.found) {
      return {
        found: true,
        command: 'pipx',
        version: pipxResult.version,
        source: 'pipx'
      };
    }

    const dockerResult = await this.tryDocker();
    if (dockerResult.found) {
      return {
        found: true,
        command: 'docker',
        source: 'docker'
      };
    }

    const inspectorResult = await this.tryInspector();
    if (inspectorResult.found) {
      return {
        found: true,
        command: 'npx',
        version: inspectorResult.version,
        source: 'inspector'
      };
    }

    return {
      found: false,
      source: 'none'
    };
  }

  async generateMcpJson(
    projectDir: string,
    status: McpInstallStatus,
    profile = 'full'
  ): Promise<void> {
    const root =
      vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? projectDir;
    const mcpJsonPath = path.join(root, '.vscode', 'mcp.json');

    if (fs.existsSync(mcpJsonPath)) {
      const choice = await vscode.window.showWarningMessage(
        '.vscode/mcp.json already exists. Overwrite it?',
        'Overwrite',
        'Cancel'
      );
      if (choice !== 'Overwrite') {
        return;
      }
    }

    const command =
      status.command === 'uvx'
        ? 'uvx'
        : status.command === 'docker'
          ? 'docker'
          : status.command === 'npx'
            ? 'npx'
            : 'kicad-mcp-pro';
    const args =
      status.command === 'uvx'
        ? ['kicad-mcp-pro']
        : status.command === 'docker'
          ? ['run', '--rm', '-i', 'kicad-mcp-pro:latest']
          : status.command === 'npx'
            ? ['@modelcontextprotocol/inspector', 'kicad-mcp-pro']
            : [];
    const config = {
      servers: {
        kicad: {
          type: 'stdio',
          command,
          args,
          env: {
            KICAD_MCP_PROJECT_DIR: projectDir,
            KICAD_MCP_PROFILE: profile
          }
        }
      }
    };

    fs.mkdirSync(path.dirname(mcpJsonPath), { recursive: true });
    fs.writeFileSync(mcpJsonPath, JSON.stringify(config, null, 2), 'utf8');

    void vscode.window.showInformationMessage(
      'kicad-mcp-pro was detected and .vscode/mcp.json was created. You can now use it from Claude Code, Cursor, or another MCP client.'
    );
  }

  async detectInstallers(): Promise<McpInstallerCandidate[]> {
    const candidates: McpInstallerCandidate[] = [];
    if (
      (await run('uvx', ['--version'])).ok ||
      (await run('uv', ['--version'])).ok
    ) {
      candidates.push({
        id: 'uvx',
        label: 'uv tool install kicad-mcp-pro',
        description: 'Recommended isolated Python tool install',
        command: 'uv',
        args: ['tool', 'install', 'kicad-mcp-pro']
      });
    }
    if ((await run('pipx', ['--version'])).ok) {
      candidates.push({
        id: 'pipx',
        label: 'pipx install kicad-mcp-pro',
        description: 'Install as an isolated Python app with pipx',
        command: 'pipx',
        args: ['install', 'kicad-mcp-pro']
      });
    }
    for (const command of ['pip', 'pip3', 'python', 'python3']) {
      const result = await run(
        command,
        command.startsWith('python')
          ? ['-m', 'pip', '--version']
          : ['--version']
      );
      if (result.ok) {
        candidates.push({
          id: 'pip',
          label: `${command} install --user kicad-mcp-pro`,
          description: 'Fallback user-site Python install',
          command,
          args: command.startsWith('python')
            ? ['-m', 'pip', 'install', '--user', 'kicad-mcp-pro']
            : ['install', '--user', 'kicad-mcp-pro']
        });
        break;
      }
    }
    return candidates;
  }

  private async tryUvx(): Promise<{ found: boolean; version?: string }> {
    const result = await run('uvx', ['kicad-mcp-pro', '--version']);
    if (!result.ok) {
      return { found: false };
    }
    const version = extractVersion(result.output);
    return {
      found: true,
      ...(version ? { version } : {})
    };
  }

  private async tryBinary(): Promise<{ found: boolean; version?: string }> {
    const result = await run('kicad-mcp-pro', ['--version']);
    if (!result.ok) {
      return { found: false };
    }
    const version = extractVersion(result.output);
    return {
      found: true,
      ...(version ? { version } : {})
    };
  }

  private async tryPip(): Promise<{ found: boolean; version?: string }> {
    for (const command of ['pip', 'pip3', 'python', 'python3']) {
      const args = command.startsWith('python')
        ? ['-m', 'pip', 'show', 'kicad-mcp-pro']
        : ['show', 'kicad-mcp-pro'];
      const result = await run(command, args);
      if (!result.ok) {
        continue;
      }
      const versionLine = result.output
        .split(/\r?\n/)
        .find((line) => line.toLowerCase().startsWith('version:'));
      const version = versionLine?.split(':')[1]?.trim();
      return {
        found: true,
        ...(version ? { version } : {})
      };
    }
    return { found: false };
  }

  private async tryPipx(): Promise<{ found: boolean; version?: string }> {
    const result = await run('pipx', ['list']);
    if (!result.ok || !/\bkicad-mcp-pro\b/i.test(result.output)) {
      return { found: false };
    }

    const version = result.output.match(
      /kicad-mcp-pro[^0-9]*(\d+\.\d+(?:\.\d+)?)/i
    )?.[1];
    return {
      found: true,
      ...(version ? { version } : {})
    };
  }

  private async tryDocker(): Promise<{ found: boolean }> {
    const result = await run('docker', [
      'image',
      'inspect',
      'kicad-mcp-pro:latest'
    ]);
    return { found: result.ok };
  }

  private async tryInspector(): Promise<{ found: boolean; version?: string }> {
    const result = await run('npx', [
      '--yes',
      '@modelcontextprotocol/inspector',
      '--version'
    ]);
    if (!result.ok) {
      return { found: false };
    }
    const version = extractVersion(result.output);
    return {
      found: true,
      ...(version ? { version } : {})
    };
  }
}

function extractVersion(output: string): string | undefined {
  return output.match(/(\d+\.\d+(?:\.\d+)?)/)?.[1];
}
