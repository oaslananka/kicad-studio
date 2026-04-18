import * as vscode from 'vscode';
import { COMMANDS } from '../constants';
import { McpDetector } from '../mcp/mcpDetector';
import { DesignIntentPanel } from '../mcp/designIntentPanel';
import type { CommandServices } from './types';

/**
 * Register MCP integration commands.
 */
export function registerMcpCommands(
  extensionContext: vscode.ExtensionContext,
  services: CommandServices
): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand(COMMANDS.setupMcpIntegration, async () => {
      const install = await services.mcpClient.detectInstall();
      if (!install.found) {
        const choice = await vscode.window.showWarningMessage(
          'kicad-mcp-pro could not be detected. Install it first, then rerun setup.',
          'Open Repository'
        );
        if (choice === 'Open Repository') {
          await vscode.env.openExternal(
            vscode.Uri.parse('https://github.com/oaslananka/kicad-mcp-pro')
          );
        }
        return;
      }
      const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!root) {
        void vscode.window.showWarningMessage(
          'Open a workspace folder before configuring MCP integration.'
        );
        return;
      }
      const detector = new McpDetector();
      const profile = await vscode.window.showQuickPick(
        [
          'full',
          'minimal',
          'pcb_only',
          'schematic_only',
          'manufacturing',
          'high_speed',
          'power',
          'simulation',
          'analysis',
          'agent_full'
        ],
        {
          title: 'Select kicad-mcp-pro profile',
          placeHolder: 'Choose the MCP profile to write into .vscode/mcp.json'
        }
      );
      if (!profile) {
        return;
      }
      await detector.generateMcpJson(root, install, profile);
      await services.refreshMcpState();
    }),

    vscode.commands.registerCommand(COMMANDS.openDesignIntent, () => {
      DesignIntentPanel.createOrShow(extensionContext, services.mcpClient);
    }),

    vscode.commands.registerCommand(COMMANDS.refreshFixQueue, () =>
      services.fixQueueProvider.refresh()
    ),

    vscode.commands.registerCommand(COMMANDS.applyFixQueueItem, (item) =>
      services.fixQueueProvider.applyFix(item)
    ),

    vscode.commands.registerCommand(COMMANDS.addDrcRuleWithMcp, async () => {
      const state = await services.mcpClient.testConnection();
      if (!state.connected) {
        await vscode.commands.executeCommand(COMMANDS.setupMcpIntegration);
        return;
      }
      await vscode.commands.executeCommand(COMMANDS.openDesignIntent);
    })
  ];
}
