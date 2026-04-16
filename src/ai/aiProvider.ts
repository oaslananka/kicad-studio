import * as vscode from 'vscode';
import { AI_SECRET_KEY, SETTINGS } from '../constants';
import type { AIProvider } from '../types';
import { ClaudeProvider } from './claudeProvider';
import { CopilotProvider, GeminiProvider } from './copilotProvider';
import { OpenAIProvider } from './openaiProvider';
import {
  DEFAULT_CLAUDE_MODEL,
  DEFAULT_OPENAI_API_MODE,
  DEFAULT_OPENAI_MODEL
} from './prompts';

export class AIProviderRegistry {
  constructor(private readonly context: vscode.ExtensionContext) {}

  async getProvider(): Promise<AIProvider | undefined> {
    const selection = this.getSelection();
    return this.getProviderForSelection(selection.provider, selection.model);
  }

  getSelection(): { provider: string; model: string; openAIApiMode: string } {
    const config = vscode.workspace.getConfiguration();
    return {
      provider: config.get<string>(SETTINGS.aiProvider, 'none'),
      model: config.get<string>(SETTINGS.aiModel, '').trim(),
      openAIApiMode: config.get<string>(SETTINGS.aiOpenAIApiMode, DEFAULT_OPENAI_API_MODE)
    };
  }

  async getProviderForSelection(selected: string, model = ''): Promise<AIProvider | undefined> {
    if (selected === 'none') {
      return undefined;
    }

    if (selected === 'copilot') {
      return new CopilotProvider();
    }
    if (selected === 'gemini') {
      return new GeminiProvider();
    }

    const apiKey = await this.context.secrets.get(AI_SECRET_KEY);
    if (!apiKey) {
      return undefined;
    }

    if (selected === 'claude') {
      return new ClaudeProvider(apiKey, model || DEFAULT_CLAUDE_MODEL);
    }
    if (selected === 'openai') {
      const apiMode = this.getSelection().openAIApiMode;
      return new OpenAIProvider(
        apiKey,
        model || DEFAULT_OPENAI_MODEL,
        apiMode === 'chat-completions' ? 'chat-completions' : 'responses'
      );
    }
    return undefined;
  }
}
