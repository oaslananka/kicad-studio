import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import * as vscode from 'vscode';
import type { McpInstallStatus } from '../types';

function run(command: string, args: string[]): { ok: boolean; output: string } {
  try {
    const result = spawnSync(command, args, {
      encoding: 'utf8',
      stdio: 'pipe'
    });
    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim();
    return {
      ok: result.status === 0,
      output
    };
  } catch (error) {
    return {
      ok: false,
      output: error instanceof Error ? error.message : String(error)
    };
  }
}

export class McpDetector {
  async detectKicadMcpPro(): Promise<McpInstallStatus> {
    const uvxResult = this.tryUvx();
    if (uvxResult.found) {
      return {
        found: true,
        command: 'uvx',
        version: uvxResult.version,
        source: 'uvx'
      };
    }

    const binaryResult = this.tryBinary();
    if (binaryResult.found) {
      return {
        found: true,
        command: 'kicad-mcp-pro',
        version: binaryResult.version,
        source: 'global'
      };
    }

    const pipResult = this.tryPip();
    if (pipResult.found) {
      return {
        found: true,
        command: 'kicad-mcp-pro',
        version: pipResult.version,
        source: 'pip'
      };
    }

    const pipxResult = this.tryPipx();
    if (pipxResult.found) {
      return {
        found: true,
        command: 'kicad-mcp-pro',
        version: pipxResult.version,
        source: 'pip'
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
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? projectDir;
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

    const command = status.command === 'uvx' ? 'uvx' : 'kicad-mcp-pro';
    const args = status.command === 'uvx' ? ['kicad-mcp-pro'] : [];
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

  private tryUvx(): { found: boolean; version?: string } {
    const result = run('uvx', ['kicad-mcp-pro', '--version']);
    if (!result.ok) {
      return { found: false };
    }
    const version = extractVersion(result.output);
    return {
      found: true,
      ...(version ? { version } : {})
    };
  }

  private tryBinary(): { found: boolean; version?: string } {
    const result = run('kicad-mcp-pro', ['--version']);
    if (!result.ok) {
      return { found: false };
    }
    const version = extractVersion(result.output);
    return {
      found: true,
      ...(version ? { version } : {})
    };
  }

  private tryPip(): { found: boolean; version?: string } {
    for (const command of ['pip', 'pip3', 'python', 'python3']) {
      const args =
        command.startsWith('python')
          ? ['-m', 'pip', 'show', 'kicad-mcp-pro']
          : ['show', 'kicad-mcp-pro'];
      const result = run(command, args);
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

  private tryPipx(): { found: boolean; version?: string } {
    const result = run('pipx', ['list']);
    if (!result.ok || !/\bkicad-mcp-pro\b/i.test(result.output)) {
      return { found: false };
    }

    const version = result.output.match(/kicad-mcp-pro[^0-9]*(\d+\.\d+(?:\.\d+)?)/i)?.[1];
    return {
      found: true,
      ...(version ? { version } : {})
    };
  }
}

function extractVersion(output: string): string | undefined {
  return output.match(/(\d+\.\d+(?:\.\d+)?)/)?.[1];
}
