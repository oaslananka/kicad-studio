import * as vscode from 'vscode';
import { COMMANDS } from '../constants';
import { McpDetector } from '../mcp/mcpDetector';
import { DesignIntentPanel } from '../mcp/designIntentPanel';
import { DrcRuleEditorPanel } from '../drc/drcRuleEditorPanel';
import { registerTrustedCommand } from '../utils/workspaceTrust';
import {
  showStructuredError,
  structuredErrorFromUnknown,
  troubleshootingUri
} from '../utils/notifications';
import { pickMcpProfile } from './mcpProfilePicker';
import { runManufacturingReleaseWizard } from './manufacturingReleaseWizard';
import type { CommandServices } from './types';

/**
 * Register MCP integration commands.
 */
export function registerMcpCommands(
  extensionContext: vscode.ExtensionContext,
  services: CommandServices
): vscode.Disposable[] {
  return [
    registerTrustedCommand(
      COMMANDS.setupMcpIntegration,
      async () => {
        const install = await services.mcpClient.detectInstall();
        if (!install.found) {
          const choice = await vscode.window.showWarningMessage(
            'kicad-mcp-pro could not be detected. Install it first, then rerun setup.',
            'Install',
            'Open Repository'
          );
          if (choice === 'Install') {
            await vscode.commands.executeCommand(COMMANDS.installMcp);
            return;
          }
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
      },
      'Setup MCP Integration'
    ),

    registerTrustedCommand(
      COMMANDS.installMcp,
      async () => {
        const detector = new McpDetector();
        const candidates = await detector.detectInstallers();
        const choice = await vscode.window.showQuickPick(
          [
            ...candidates.map((candidate) => ({
              label: candidate.label,
              description: candidate.description,
              candidate
            })),
            {
              label: 'Open install docs',
              description: 'Open kicad-mcp-pro installation documentation'
            }
          ],
          {
            title: 'Install kicad-mcp-pro'
          }
        );
        if (!choice) {
          return;
        }
        if (!('candidate' in choice)) {
          await vscode.env.openExternal(
            vscode.Uri.parse(
              'https://github.com/oaslananka/kicad-mcp-pro#installation'
            )
          );
          return;
        }
        const task = new vscode.Task(
          {
            type: 'shell',
            task: 'install-kicad-mcp-pro'
          },
          vscode.TaskScope.Workspace,
          'Install kicad-mcp-pro',
          'KiCad',
          new vscode.ProcessExecution(
            choice.candidate.command,
            choice.candidate.args
          )
        );
        await vscode.tasks.executeTask(task);
        const followUp = await vscode.window.showInformationMessage(
          'Install task started. Re-run MCP detection when it finishes?',
          'Detect',
          'Later'
        );
        if (followUp === 'Detect') {
          await services.refreshMcpState();
        }
      },
      'Install kicad-mcp-pro'
    ),

    vscode.commands.registerCommand(COMMANDS.retryMcp, async () => {
      await services.mcpClient.retryNow();
      await services.refreshMcpState();
    }),

    vscode.commands.registerCommand(COMMANDS.openMcpUpgradeGuide, () =>
      vscode.env.openExternal(
        vscode.Uri.parse(
          'https://github.com/oaslananka/kicad-mcp-pro#installation'
        )
      )
    ),

    registerTrustedCommand(
      COMMANDS.pickMcpProfile,
      () => pickMcpProfile(services),
      'Pick MCP Profile'
    ),

    vscode.commands.registerCommand(COMMANDS.openDesignIntent, () => {
      DesignIntentPanel.createOrShow(extensionContext, services.mcpClient);
    }),

    vscode.commands.registerCommand(COMMANDS.refreshFixQueue, () =>
      services.fixQueueProvider.refresh()
    ),

    vscode.commands.registerCommand(COMMANDS.applyFixQueueItem, async (item) =>
      runWithStructuredMcpErrorHandling(services, () =>
        services.fixQueueProvider.applyFix(item)
      )
    ),

    vscode.commands.registerCommand(
      COMMANDS.applyFixQueueById,
      async (id: string) =>
        runWithStructuredMcpErrorHandling(services, () =>
          services.fixQueueProvider.applyFixById(id)
        )
    ),

    vscode.commands.registerCommand(COMMANDS.applyAllFixQueueItems, async () =>
      runWithStructuredMcpErrorHandling(services, () =>
        services.fixQueueProvider.applyAll()
      )
    ),

    vscode.commands.registerCommand(COMMANDS.addDrcRuleWithMcp, async () => {
      await DrcRuleEditorPanel.createOrShow(
        extensionContext,
        services.mcpClient
      );
    }),

    registerTrustedCommand(
      COMMANDS.manufacturingRelease,
      () => runManufacturingReleaseWizard(services),
      'Manufacturing Release'
    )
  ];
}

async function runWithStructuredMcpErrorHandling(
  services: CommandServices,
  action: () => Promise<void>
): Promise<void> {
  try {
    await action();
  } catch (error) {
    const structured = structuredErrorFromUnknown(error);
    if (structured) {
      await showStructuredError(
        structured,
        troubleshootingUri(services.context.extensionUri, structured.code)
      );
      return;
    }
    throw error;
  }
}
