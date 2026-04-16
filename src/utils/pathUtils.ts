import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { KICAD_FILE_EXTENSIONS } from '../constants';

export function isKiCadFile(uriOrPath: vscode.Uri | string): boolean {
  const extname = path.extname(uriOrPath instanceof vscode.Uri ? uriOrPath.fsPath : uriOrPath);
  return KICAD_FILE_EXTENSIONS.includes(extname as (typeof KICAD_FILE_EXTENSIONS)[number]);
}

export function getWorkspaceFolderForUri(uri: vscode.Uri): vscode.WorkspaceFolder | undefined {
  return vscode.workspace.getWorkspaceFolder(uri);
}

export function getWorkspaceRoot(uri?: vscode.Uri): string | undefined {
  if (uri) {
    return getWorkspaceFolderForUri(uri)?.uri.fsPath;
  }
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

export function toPosixPath(value: string): string {
  return value.split(path.sep).join(path.posix.sep);
}

export function relativeToWorkspace(filePath: string, root = getWorkspaceRoot()): string {
  if (!root) {
    return filePath;
  }
  return toPosixPath(path.relative(root, filePath));
}

export function pathExistsOnAnyPlatform(targetPath: string): boolean {
  try {
    return fs.existsSync(targetPath);
  } catch {
    return false;
  }
}

export function normalizeUserPath(targetPath: string): string {
  if (targetPath.startsWith('~')) {
    return path.join(os.homedir(), targetPath.slice(1));
  }
  return path.normalize(targetPath);
}

export function findSiblingProjectFile(filePath: string): string | undefined {
  const sibling = path.join(path.dirname(filePath), `${path.parse(filePath).name}.kicad_pro`);
  if (fs.existsSync(sibling)) {
    return sibling;
  }

  try {
    const entries = fs.readdirSync(path.dirname(filePath));
    const projectEntry = entries.find((entry) => entry.endsWith('.kicad_pro'));
    return projectEntry ? path.join(path.dirname(filePath), projectEntry) : undefined;
  } catch {
    return undefined;
  }
}

export async function findFirstWorkspaceFile(
  pattern: string,
  exclude = '**/node_modules/**'
): Promise<string | undefined> {
  const files = await vscode.workspace.findFiles(pattern, exclude, 1);
  return files[0]?.fsPath;
}
