import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { KiCadCliRunner } from './kicadCliRunner';
import { Logger } from '../utils/logger';

export type SupportedPcbImportFormat =
  | 'pads'
  | 'altium'
  | 'eagle'
  | 'cadstar'
  | 'fabmaster'
  | 'pcad'
  | 'solidworks';

export class KiCadImportService {
  constructor(
    private readonly runner: KiCadCliRunner,
    private readonly logger: Logger
  ) {}

  async importBoard(format: SupportedPcbImportFormat): Promise<void> {
    const selection = await vscode.window.showOpenDialog({
      title: `Import ${format} board`,
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false
    });
    const inputFile = selection?.[0]?.fsPath;
    if (!inputFile) {
      return;
    }

    const outputFile = path.join(
      path.dirname(inputFile),
      `${path.parse(inputFile).name}.kicad_pcb`
    );

    try {
      await this.runner.runWithProgress<string>({
        command: [
          'pcb',
          'import',
          '--format',
          format,
          '--output',
          outputFile,
          inputFile
        ],
        cwd: path.dirname(inputFile),
        progressTitle: `Importing ${format} board`
      });

      const projectFile = await ensureProjectForImportedBoard(outputFile);
      await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(projectFile));
      void vscode.window.showInformationMessage(
        `Imported ${path.basename(inputFile)} as ${path.basename(outputFile)}.`
      );
    } catch (error) {
      this.logger.error(`Import ${format} failed`, error);
      void vscode.window.showErrorMessage(
        error instanceof Error ? error.message : `Import failed for ${format}.`
      );
    }
  }
}

async function ensureProjectForImportedBoard(boardFile: string): Promise<string> {
  const projectFile = path.join(
    path.dirname(boardFile),
    `${path.parse(boardFile).name}.kicad_pro`
  );

  if (!fs.existsSync(projectFile)) {
    await fs.promises.writeFile(
      projectFile,
      `${JSON.stringify(
        {
          meta: {
            filename: path.parse(boardFile).name,
            version: 1
          },
          board: {
            file: path.basename(boardFile)
          }
        },
        null,
        2
      )}\n`,
      'utf8'
    );
  }

  return projectFile;
}
