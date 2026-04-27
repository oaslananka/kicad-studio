import * as vscode from 'vscode';
import { COMMANDS } from '../constants';
import type { FixItem } from '../types';
import { McpClient } from './mcpClient';

class FixQueueTreeItem extends vscode.TreeItem {
  constructor(public readonly item: FixItem) {
    super(item.description, vscode.TreeItemCollapsibleState.None);
    this.description = item.tool;
    this.tooltip = item.preview ?? item.description;
    this.contextValue = `fix-${item.severity}`;
    this.command = {
      command: COMMANDS.applyFixQueueItem,
      title: 'Apply Fix',
      arguments: [item]
    };
    this.iconPath = new vscode.ThemeIcon(
      item.severity === 'error'
        ? 'error'
        : item.severity === 'warning'
          ? 'warning'
          : 'lightbulb'
    );
  }
}

export class FixQueueProvider implements vscode.TreeDataProvider<FixItem> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<
    FixItem | undefined
  >();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;
  private items: FixItem[] = [];

  constructor(private readonly mcpClient: McpClient) {}

  getTreeItem(element: FixItem): vscode.TreeItem {
    return new FixQueueTreeItem(element);
  }

  getChildren(): FixItem[] {
    return this.items;
  }

  getFixesForUri(uri: vscode.Uri, range?: vscode.Range): FixItem[] {
    const target = normalizePath(uri.fsPath);
    return this.items.filter((item) => {
      if (!item.path || typeof item.line !== 'number') {
        return false;
      }
      if (normalizePath(item.path) !== target) {
        return false;
      }
      if (!range) {
        return true;
      }
      const line = Math.max(0, item.line - 1);
      return line >= range.start.line - 1 && line <= range.end.line + 1;
    });
  }

  async refresh(): Promise<void> {
    this.items = await this.mcpClient.fetchFixQueue();
    this.onDidChangeTreeDataEmitter.fire(undefined);
  }

  async applyFixById(id: string): Promise<void> {
    const item = this.items.find((candidate) => candidate.id === id);
    if (item) {
      await this.applyFix(item);
      return;
    }
    await this.mcpClient.callTool('apply_fix', { id });
    await this.refresh();
  }

  async applyAll(): Promise<void> {
    for (const item of [...this.items]) {
      if (item.status !== 'pending') {
        continue;
      }
      try {
        await this.applyFixInternal(item, { confirm: false });
      } catch {
        item.status = 'failed';
        break;
      }
    }
    this.onDidChangeTreeDataEmitter.fire(undefined);
  }

  async applyFix(item: FixItem): Promise<void> {
    await this.applyFixInternal(item, { confirm: true });
  }

  private async applyFixInternal(
    item: FixItem,
    options: { confirm: boolean }
  ): Promise<void> {
    const preview =
      item.preview ??
      (await this.mcpClient.previewToolCall({
        name: item.tool,
        arguments: item.args
      }));

    if (preview && options.confirm) {
      const document = await vscode.workspace.openTextDocument({
        content: preview,
        language: 'diff'
      });
      await vscode.window.showTextDocument(document);
    }

    const choice = options.confirm
      ? await vscode.window.showInformationMessage(
          `Apply fix: ${item.description}`,
          'Apply',
          'Cancel'
        )
      : 'Apply';

    if (choice !== 'Apply') {
      return;
    }

    await this.mcpClient.callTool(
      item.tool || 'apply_fix',
      item.tool ? item.args : { id: item.id }
    );
    item.status = 'done';
    this.onDidChangeTreeDataEmitter.fire(undefined);
    void vscode.window.showInformationMessage(`Applied: ${item.description}`);
  }
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').toLowerCase();
}
