import * as vscode from 'vscode';
import { COMMANDS, SETTINGS } from '../constants';
import { KiCadChatPanel } from '../ai/chatPanel';
import { formatDiagnosticSummary, getActiveAiContext } from '../ai/context';
import { buildProactiveDRCPrompt } from '../ai/prompts';
import { resolveTargetFile } from '../utils/workspaceUtils';
import type { CommandServices } from './types';

/**
 * Register AI analysis and chat commands.
 */
export function registerAiCommands(
  extensionContext: vscode.ExtensionContext,
  services: CommandServices
): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand(COMMANDS.aiAnalyzeError, () =>
      services.errorAnalyzer.analyzeSelectedError()
    ),

    vscode.commands.registerCommand(COMMANDS.aiProactiveDRC, async () => {
      const latest = services.getLatestDrcRun();
      const provider = await services.aiProviders.getProvider();
      if (!provider?.isConfigured()) {
        void vscode.window.showWarningMessage(
          'AI provider is not configured. Choose a provider and store an API key first.'
        );
        return;
      }
      let drcRun = latest;
      if (!drcRun) {
        const file = await resolveTargetFile(undefined, '.kicad_pcb');
        if (!file) {
          return;
        }
        const result = await services.checkService.runDRC(file);
        drcRun = {
          file,
          diagnostics: result.diagnostics,
          summary: result.summary
        };
        services.setLatestDrcRun(drcRun);
      }
      const rankedDiagnostics = [...drcRun.diagnostics].sort(
        (left, right) => right.severity - left.severity
      );
      const prompt = buildProactiveDRCPrompt(
        rankedDiagnostics
          .slice(0, 5)
          .map((diagnostic) => `${diagnostic.code ?? 'rule'}: ${diagnostic.message}`),
        [formatDiagnosticSummary(drcRun.summary), getActiveAiContext().description]
          .filter(Boolean)
          .join('\n')
      );
      const panel = KiCadChatPanel.createOrShow(
        extensionContext,
        services.aiProviders,
        services.logger,
        services.mcpClient
      );
      await panel.submitPrompt('Analyze the latest DRC results and prioritize fixes.', prompt);
    }),

    vscode.commands.registerCommand(COMMANDS.aiExplainCircuit, () =>
      services.circuitExplainer.explainSelection()
    ),

    vscode.commands.registerCommand(COMMANDS.openAiChat, () => {
      KiCadChatPanel.createOrShow(
        extensionContext,
        services.aiProviders,
        services.logger,
        services.mcpClient
      );
    }),

    vscode.commands.registerCommand(COMMANDS.testAiConnection, async () => {
      const provider = await services.aiProviders.getProvider();
      if (!provider?.isConfigured()) {
        services.setAiHealthy(undefined);
        services.statusBar.update({ aiConfigured: false, aiHealthy: undefined });
        void vscode.window.showWarningMessage(
          'AI provider is not configured. Choose a provider and store an API key first.'
        );
        return;
      }
      const result = await provider.testConnection();
      services.setAiHealthy(result.ok);
      services.statusBar.update({ aiConfigured: true, aiHealthy: result.ok });
      if (result.ok) {
        void vscode.window.showInformationMessage(
          `${provider.name} connection OK (${result.latencyMs} ms).`
        );
      } else {
        void vscode.window.showErrorMessage(
          `${provider.name} connection failed after ${result.latencyMs} ms. ${result.error ?? ''}`.trim()
        );
      }
    }),

    vscode.commands.registerCommand(COMMANDS.manageChatProvider, async () => {
      const picked = await vscode.window.showQuickPick(
        [
          {
            label: 'Set Claude API key',
            description: 'Store the API key used by the KiCad Studio chat provider.',
            action: 'set-key'
          },
          {
            label: 'Pick Claude model',
            description: 'Choose the model string exposed by the KiCad Studio chat provider.',
            action: 'pick-model'
          },
          {
            label: 'Test chat provider',
            description:
              'Verify the configured Claude-backed provider can answer a test request.',
            action: 'test'
          }
        ],
        {
          title: 'Manage KiCad Studio chat provider',
          placeHolder: 'Choose a KiCad Studio Claude provider action'
        }
      );
      if (!picked) {
        return;
      }

      if (picked.action === 'set-key') {
        await vscode.commands.executeCommand(COMMANDS.setAiApiKey);
        return;
      }

      if (picked.action === 'pick-model') {
        const currentModel = vscode.workspace
          .getConfiguration()
          .get<string>(SETTINGS.aiModel, '');
        const model = await vscode.window.showInputBox({
          title: 'Claude model for KiCad Studio chat provider',
          value: currentModel,
          placeHolder: 'claude-sonnet-4-6',
          prompt: 'Leave empty to use the default Claude model.'
        });
        if (typeof model !== 'string') {
          return;
        }

        await vscode.workspace
          .getConfiguration()
          .update(SETTINGS.aiProvider, 'claude', vscode.ConfigurationTarget.Global);
        await vscode.workspace
          .getConfiguration()
          .update(SETTINGS.aiModel, model.trim(), vscode.ConfigurationTarget.Global);
        void vscode.window.showInformationMessage(
          'KiCad Studio chat provider settings updated.'
        );
        return;
      }

      if (picked.action === 'test') {
        await vscode.workspace
          .getConfiguration()
          .update(SETTINGS.aiProvider, 'claude', vscode.ConfigurationTarget.Global);
        await vscode.commands.executeCommand(COMMANDS.testAiConnection);
      }
    })
  ];
}
