import * as vscode from 'vscode';
import { AI_SECRET_KEY, COMMANDS, OCTOPART_SECRET_KEY } from '../constants';
import type { CommandServices } from './types';

/**
 * Register secret/API-key management commands.
 */
export function registerSecretCommands(services: CommandServices): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand(COMMANDS.setOctopartApiKey, async () => {
      const value = await vscode.window.showInputBox({
        title: 'Store Octopart/Nexar API key',
        password: true,
        ignoreFocusOut: true
      });
      if (!value) {
        return;
      }
      await services.context.secrets.store(OCTOPART_SECRET_KEY, value);
      void vscode.window.showInformationMessage('Octopart/Nexar API key stored securely.');
    }),

    vscode.commands.registerCommand(COMMANDS.setAiApiKey, async () => {
      const value = await vscode.window.showInputBox({
        title: 'Store AI API key',
        password: true,
        ignoreFocusOut: true
      });
      if (!value) {
        return;
      }
      await services.context.secrets.store(AI_SECRET_KEY, value);
      void vscode.window.showInformationMessage('AI API key stored securely.');
    }),

    vscode.commands.registerCommand(COMMANDS.clearSecrets, async () => {
      await services.context.secrets.delete(AI_SECRET_KEY);
      await services.context.secrets.delete(OCTOPART_SECRET_KEY);
      void vscode.window.showInformationMessage('Stored KiCad Studio secrets cleared.');
    }),

    vscode.commands.registerCommand(COMMANDS.showStoredSecrets, async () => {
      const aiSecret = await services.context.secrets.get(AI_SECRET_KEY);
      const octopartSecret = await services.context.secrets.get(OCTOPART_SECRET_KEY);
      const configured = [
        aiSecret ? 'AI provider key' : undefined,
        octopartSecret ? 'Octopart/Nexar key' : undefined
      ].filter(Boolean);
      void vscode.window.showInformationMessage(
        configured.length
          ? `Stored secrets: ${configured.join(', ')}`
          : 'No KiCad Studio secrets are currently stored.'
      );
    })
  ];
}
