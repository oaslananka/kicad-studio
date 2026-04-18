import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as childProcess from 'node:child_process';
import { McpDetector } from '../../src/mcp/mcpDetector';
import { window, workspace } from './vscodeMock';

jest.mock('node:child_process', () => ({
  execFile: jest.fn()
}));

describe('McpDetector.generateMcpJson', () => {
  let tempDir: string;
  let execFileMock: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kicadstudio-mcp-'));
    workspace.workspaceFolders = [{ uri: { fsPath: tempDir } }];
    execFileMock = childProcess.execFile as unknown as jest.Mock;
    // Default: all commands fail
    execFileMock.mockImplementation(
      (_command: string, _args: string[], _opts: unknown, callback: (err: Error | null, stdout: string, stderr: string) => void) => {
        callback(new Error('not found'), '', 'not found');
      }
    );
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('creates a stdio MCP configuration for uvx installs', async () => {
    const detector = new McpDetector();

    await detector.generateMcpJson(tempDir, {
      found: true,
      command: 'uvx',
      version: '0.5.0',
      source: 'uvx'
    }, 'analysis');

    const configPath = path.join(tempDir, '.vscode', 'mcp.json');
    const saved = JSON.parse(fs.readFileSync(configPath, 'utf8')) as {
      servers: {
        kicad: {
          command: string;
          args: string[];
          env: Record<string, string>;
        };
      };
    };

    expect(saved.servers.kicad.command).toBe('uvx');
    expect(saved.servers.kicad.args).toEqual(['kicad-mcp-pro']);
    expect(saved.servers.kicad.env['KICAD_MCP_PROJECT_DIR']).toBe(tempDir);
    expect(saved.servers.kicad.env['KICAD_MCP_PROFILE']).toBe('analysis');
    expect(window.showInformationMessage).toHaveBeenCalled();
  });

  it('keeps an existing file when overwrite is cancelled', async () => {
    const detector = new McpDetector();
    const configDir = path.join(tempDir, '.vscode');
    const configPath = path.join(configDir, 'mcp.json');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(configPath, '{"preserve":true}', 'utf8');
    (window.showWarningMessage as jest.Mock).mockResolvedValue('Cancel');

    await detector.generateMcpJson(tempDir, {
      found: true,
      command: 'kicad-mcp-pro',
      version: '0.5.0',
      source: 'global'
    });

    expect(fs.readFileSync(configPath, 'utf8')).toBe('{"preserve":true}');
  });

  it('overwrites an existing file when the user confirms the prompt', async () => {
    const detector = new McpDetector();
    const configDir = path.join(tempDir, '.vscode');
    const configPath = path.join(configDir, 'mcp.json');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(configPath, '{"preserve":true}', 'utf8');
    (window.showWarningMessage as jest.Mock).mockResolvedValue('Overwrite');

    await detector.generateMcpJson(tempDir, {
      found: true,
      command: 'kicad-mcp-pro',
      version: '0.5.0',
      source: 'global'
    });

    const saved = JSON.parse(fs.readFileSync(configPath, 'utf8')) as {
      servers: {
        kicad: {
          command: string;
          args: string[];
        };
      };
    };
    expect(saved.servers.kicad.command).toBe('kicad-mcp-pro');
    expect(saved.servers.kicad.args).toEqual([]);
  });

  it('prefers uvx during install detection when it is available', async () => {
    execFileMock.mockImplementation(
      (command: string, _args: string[], _opts: unknown, callback: (err: Error | null, stdout: string, stderr: string) => void) => {
        if (command === 'uvx') {
          callback(null, 'kicad-mcp-pro 0.8.0', '');
        } else {
          callback(new Error('missing'), '', 'missing');
        }
      }
    );

    const result = await new McpDetector().detectKicadMcpPro();

    expect(result).toEqual({
      found: true,
      command: 'uvx',
      version: '0.8.0',
      source: 'uvx'
    });
  });

  it('falls back to a global binary and then pip metadata', async () => {
    execFileMock.mockImplementation(
      (command: string, args: string[], _opts: unknown, callback: (err: Error | null, stdout: string, stderr: string) => void) => {
        if (command === 'kicad-mcp-pro') {
          callback(null, 'kicad-mcp-pro 0.9.1', '');
        } else {
          callback(new Error('missing'), '', 'missing');
        }
      }
    );

    const result = await new McpDetector().detectKicadMcpPro();

    expect(result.command).toBe('kicad-mcp-pro');
    expect(result.source).toBe('global');
  });

  it('uses pip metadata when no direct executable is available', async () => {
    execFileMock.mockImplementation(
      (command: string, args: string[], _opts: unknown, callback: (err: Error | null, stdout: string, stderr: string) => void) => {
        if (command === 'pip' && Array.isArray(args) && args[0] === 'show') {
          callback(null, 'Name: kicad-mcp-pro\nVersion: 0.7.4\n', '');
        } else {
          callback(new Error('missing'), '', 'missing');
        }
      }
    );

    const result = await new McpDetector().detectKicadMcpPro();

    expect(result).toEqual({
      found: true,
      command: 'kicad-mcp-pro',
      version: '0.7.4',
      source: 'pip'
    });
  });

  it('reports not found when all detection strategies fail', async () => {
    // Default mock already makes everything fail

    const result = await new McpDetector().detectKicadMcpPro();

    expect(result).toEqual({
      found: false,
      source: 'none'
    });
  });

  it('falls back to pipx metadata when uvx, global binary, and pip are unavailable', async () => {
    execFileMock.mockImplementation(
      (command: string, _args: string[], _opts: unknown, callback: (err: Error | null, stdout: string, stderr: string) => void) => {
        if (command === 'pipx') {
          callback(null, 'package kicad-mcp-pro 0.8.4, installed using Python 3.12.0', '');
        } else {
          callback(new Error('missing'), '', 'missing');
        }
      }
    );

    const result = await new McpDetector().detectKicadMcpPro();

    expect(result).toEqual({
      found: true,
      command: 'kicad-mcp-pro',
      version: '0.8.4',
      source: 'pip'
    });
  });
});
