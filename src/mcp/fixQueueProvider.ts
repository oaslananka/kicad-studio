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
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<FixItem | undefined>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;
  private items: FixItem[] = [];

  constructor(private readonly mcpClient: McpClient) {}

  getTreeItem(element: FixItem): vscode.TreeItem {
    return new FixQueueTreeItem(element);
  }

  getChildren(): FixItem[] {
    return this.items;
  }

  async refresh(): Promise<void> {
    this.items = await this.mcpClient.fetchFixQueue();
    this.onDidChangeTreeDataEmitter.fire(undefined);
  }

  async applyFix(item: FixItem): Promise<void> {
    const preview =
      item.preview ??
      (await this.mcpClient.previewToolCall({
        name: item.tool,
        arguments: item.args
      }));

    const choice = await vscode.window.showInformationMessage(
      `Apply fix: ${item.description}\n\nPreview: ${preview}`,
      'Apply',
      'Cancel'
    );

    if (choice !== 'Apply') {
      return;
    }

    await this.mcpClient.callTool(item.tool, item.args);
    item.status = 'done';
    this.onDidChangeTreeDataEmitter.fire(undefined);
    void vscode.window.showInformationMessage(`Applied: ${item.description}`);
  }
}
