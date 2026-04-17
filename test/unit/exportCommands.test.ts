import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { buildCliExportCommands, KiCadExportService } from '../../src/cli/exportCommands';
import { zipDirectory } from '../../src/utils/zipUtils';
import { __setConfiguration } from './vscodeMock';

describe('buildCliExportCommands', () => {
  beforeEach(() => {
    __setConfiguration({
      'kicadstudio.gerber.precision': 6,
      'kicadstudio.ipc2581.version': 'C',
      'kicadstudio.ipc2581.units': 'mm',
      'kicadstudio.viewer.theme': 'kicad',
      'kicadstudio.bom.fields': ['Reference', 'Value', 'Footprint']
    });
  });

  it('builds KiCad 9+ 3D and CAM export commands', () => {
    const pcb = 'C:\\project\\board.kicad_pcb';
    expect(buildCliExportCommands('export-brep', pcb, 'fab', { versionMajor: 9 })[0]).toContain('brep');
    expect(buildCliExportCommands('export-ply', pcb, 'fab', { versionMajor: 9 })[0]).toContain('ply');
    expect(buildCliExportCommands('export-gencad', pcb, 'fab', { versionMajor: 9 })[0]).toContain('gencad');
    expect(buildCliExportCommands('export-ipcd356', pcb, 'fab', { versionMajor: 9 })[0]).toContain('ipcd356');
  });

  it('builds gerber precision only for KiCad 9 and newer', () => {
    const pcb = '/project/board.kicad_pcb';
    expect(buildCliExportCommands('export-gerbers', pcb, '/project/fab', { versionMajor: 9 })[0]).toEqual(
      expect.arrayContaining(['--precision', '6'])
    );
    expect(buildCliExportCommands('export-gerbers', pcb, '/project/fab', { versionMajor: 6 })[0]).not.toContain(
      '--precision'
    );
  });

  it('returns empty commands for BREP and PLY on KiCad 7 and older', () => {
    const pcb = '/project/board.kicad_pcb';
    expect(buildCliExportCommands('export-brep', pcb, '/project/fab', { versionMajor: 7 })).toEqual([]);
    expect(buildCliExportCommands('export-ply', pcb, '/project/fab', { versionMajor: 7 })).toEqual([]);
  });

  it('builds pick-and-place export as CSV in millimeters', () => {
    const command = buildCliExportCommands('export-pos', '/project/board.kicad_pcb', '/project/fab')[0];
    expect(command).toEqual(
      expect.arrayContaining(['pos', '--format', 'csv', '--units', 'mm', '--side', 'both'])
    );
  });

  it('builds symbol and footprint SVG export commands', () => {
    expect(buildCliExportCommands('export-fp-svg', '/project/R_0603.kicad_mod', '/project/fab')[0]).toEqual(
      ['fp', 'export', 'svg', '--output', '/project/fab', '/project/R_0603.kicad_mod']
    );
    expect(buildCliExportCommands('export-sym-svg', '/project/lib.kicad_sym', '/project/fab')[0]).toEqual(
      ['sym', 'export', 'svg', '--output', '/project/fab', '--theme', 'kicad', '/project/lib.kicad_sym']
    );
  });

  it('reads IPC-2581 version and units from settings', () => {
    const command = buildCliExportCommands('export-ipc2581', '/project/board.kicad_pcb', '/project/fab')[0];
    expect(command).toEqual(expect.arrayContaining(['--version', 'C', '--units', 'mm']));
  });
});

describe('zipDirectory', () => {
  it('creates a readable zip archive', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kicadstudio-zip-'));
    const sourceDir = path.join(root, 'source');
    const outputFile = path.join(root, 'package.zip');
    fs.mkdirSync(path.join(sourceDir, 'nested'), { recursive: true });
    fs.writeFileSync(path.join(sourceDir, 'manifest.json'), '{"ok":true}', 'utf8');
    fs.writeFileSync(path.join(sourceDir, 'nested', 'board.gbr'), 'G04 test*', 'utf8');

    await zipDirectory(sourceDir, outputFile);

    const archive = fs.readFileSync(outputFile);
    expect(archive.subarray(0, 4).toString('hex')).toBe('504b0304');
    expect(archive.toString('utf8')).toContain('manifest.json');
    expect(archive.toString('utf8')).toContain('nested/board.gbr');
  });
});

describe('KiCadExportService.renderViewerSvg', () => {
  it('returns the generated schematic SVG for inline fallback rendering', async () => {
    __setConfiguration({
      'kicadstudio.viewer.theme': 'kicad',
      'kicadstudio.bom.fields': ['Reference']
    });

    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kicadstudio-export-service-'));
    const schematicFile = path.join(workspaceRoot, 'sample.kicad_sch');
    fs.writeFileSync(schematicFile, '(kicad_sch (symbol "U1"))', 'utf8');

    const runner = {
      run: jest.fn(async ({ command }: { command: string[] }) => {
        const outputDir = command[command.indexOf('--output') + 1];
        if (!outputDir) {
          throw new Error('Missing output directory.');
        }
        fs.mkdirSync(outputDir, { recursive: true });
        fs.writeFileSync(
          path.join(outputDir, 'sample.svg'),
          '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>',
          'utf8'
        );
        return {
          stdout: '',
          stderr: '',
          exitCode: 0,
          durationMs: 1
        };
      })
    };
    const detector = {
      detect: jest.fn().mockResolvedValue({
        path: 'kicad-cli',
        version: '10.0.1'
      })
    };
    const logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn()
    };

    const service = new KiCadExportService(
      runner as never,
      detector as never,
      {} as never,
      {} as never,
      {} as never,
      logger as never
    );

    const svg = await service.renderViewerSvg(vscode.Uri.file(schematicFile));

    expect(runner.run).toHaveBeenCalledWith(
      expect.objectContaining({
        command: expect.arrayContaining(['sch', 'export', 'svg', '--output'])
      })
    );
    expect(svg).toContain('<svg');

    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it('uses single-file PCB SVG export for board fallback rendering on KiCad 9+', async () => {
    __setConfiguration({
      'kicadstudio.viewer.theme': 'kicad'
    });

    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kicadstudio-board-export-'));
    const boardFile = path.join(workspaceRoot, 'board.kicad_pcb');
    fs.writeFileSync(
      boardFile,
      `(kicad_pcb
        (layers
          (0 "F.Cu" signal)
          (31 "B.Cu" signal)
          (36 "B.SilkS" user "B.Silkscreen")
          (37 "F.SilkS" user "F.Silkscreen")
          (44 "Edge.Cuts" user)
        )
        (footprint "R1")
      )`,
      'utf8'
    );

    const runner = {
      run: jest.fn(async ({ command }: { command: string[] }) => {
        const outputPath = command[command.indexOf('--output') + 1];
        if (!outputPath) {
          throw new Error('Missing output file.');
        }
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.writeFileSync(
          outputPath,
          '<svg xmlns="http://www.w3.org/2000/svg"><circle cx="5" cy="5" r="4"/></svg>',
          'utf8'
        );
        return {
          stdout: '',
          stderr: '',
          exitCode: 0,
          durationMs: 1
        };
      })
    };
    const detector = {
      detect: jest.fn().mockResolvedValue({
        path: 'kicad-cli',
        version: '10.0.1'
      })
    };
    const logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn()
    };

    const service = new KiCadExportService(
      runner as never,
      detector as never,
      {} as never,
      {} as never,
      {} as never,
      logger as never
    );

    const svg = await service.renderViewerSvg(vscode.Uri.file(boardFile));

    expect(runner.run).toHaveBeenCalledWith(
      expect.objectContaining({
        command: expect.arrayContaining([
          'pcb',
          'export',
          'svg',
          '--mode-single',
          '--page-size-mode',
          '0'
        ])
      })
    );
    expect(runner.run).toHaveBeenCalledWith(
      expect.objectContaining({
        command: expect.not.arrayContaining(['--theme'])
      })
    );
    expect(svg).toContain('<svg');

    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });
});
