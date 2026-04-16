import * as vscode from 'vscode';
import { AI_CHAT_MAX_HISTORY, SETTINGS } from '../constants';
import { AIStreamAbortedError } from '../errors';
import { McpClient } from '../mcp/mcpClient';
import { extractMcpToolCalls } from '../mcp/toolCallParser';
import type { McpToolCall } from '../types';
import { Logger } from '../utils/logger';
import { AIProviderRegistry } from './aiProvider';
import { getActiveAiContext } from './context';
import { buildSystemPrompt, DEFAULT_AI_LANGUAGE, normalizeAiLanguage } from './prompts';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  toolCalls?: McpToolCall[];
  applied?: boolean;
}

interface ChatPanelMessage {
  type:
    | 'send'
    | 'cancel'
    | 'clear'
    | 'ready'
    | 'selectionChanged'
    | 'applyToolCalls'
    | 'ignoreToolCalls';
  prompt?: string;
  context?: string;
  provider?: string;
  model?: string;
  timestamp?: number;
}

const CHAT_HISTORY_KEY = 'kicadstudio.aiChat.history';

/**
 * Multi-turn AI chat panel for KiCad Studio.
 */
export class KiCadChatPanel implements vscode.Disposable {
  public static readonly viewType = 'kicadstudio.aiChat';
  private static instance: KiCadChatPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private readonly history: ChatMessage[] = [];
  private readonly disposables: vscode.Disposable[] = [];
  private abortController: AbortController | undefined;
  private busy = false;
  private selectedProvider: string;
  private selectedModel: string;
  private disposed = false;

  static createOrShow(
    context: vscode.ExtensionContext,
    providers: AIProviderRegistry,
    logger: Logger,
    mcpClient?: McpClient
  ): KiCadChatPanel {
    if (KiCadChatPanel.instance) {
      KiCadChatPanel.instance.panel.reveal(vscode.ViewColumn.Beside);
      void KiCadChatPanel.instance.postHydrate();
      return KiCadChatPanel.instance;
    }

    const panel = vscode.window.createWebviewPanel(
      KiCadChatPanel.viewType,
      'KiCad AI Chat',
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')]
      }
    );

    const instance = new KiCadChatPanel(context, panel, providers, logger, mcpClient);
    KiCadChatPanel.instance = instance;
    context.subscriptions.push(instance);
    return instance;
  }

  private constructor(
    private readonly context: vscode.ExtensionContext,
    panel: vscode.WebviewPanel,
    private readonly providers: AIProviderRegistry,
    private readonly logger: Logger,
    private readonly mcpClient?: McpClient
  ) {
    this.panel = panel;
    const selection = providers.getSelection();
    this.selectedProvider = selection.provider;
    this.selectedModel = selection.model;
    this.history.push(...this.loadHistory());
    this.panel.webview.html = this.buildHtml();
    this.disposables.push(
      this.panel.onDidDispose(() => this.handleDisposed()),
      this.panel.webview.onDidReceiveMessage((message: ChatPanelMessage) => void this.handleMessage(message)),
      vscode.window.onDidChangeActiveTextEditor(() => void this.postContextInfo()),
      vscode.workspace.onDidSaveTextDocument(() => void this.postContextInfo())
    );
  }

  async submitPrompt(
    prompt: string,
    extraContext: string,
    selection?: { provider?: string; model?: string }
  ): Promise<void> {
    this.panel.reveal(vscode.ViewColumn.Beside);
    if (selection?.provider) {
      this.selectedProvider = selection.provider;
    }
    if (typeof selection?.model === 'string') {
      this.selectedModel = selection.model;
    }
    await this.runPrompt(prompt, extraContext);
  }

  private async handleMessage(message: ChatPanelMessage): Promise<void> {
    if (message.type === 'ready') {
      await this.postHydrate();
      return;
    }

    if (message.type === 'selectionChanged') {
      if (message.provider) {
        this.selectedProvider = message.provider;
      }
      if (typeof message.model === 'string') {
        this.selectedModel = message.model;
      }
      return;
    }

    if (message.type === 'cancel') {
      this.abortController?.abort(new AIStreamAbortedError());
      return;
    }

    if (message.type === 'clear') {
      this.history.length = 0;
      await this.persistHistory();
      await this.postHydrate();
      return;
    }

    if (message.type === 'applyToolCalls' && typeof message.timestamp === 'number') {
      await this.applyToolCalls(message.timestamp);
      return;
    }

    if (message.type === 'ignoreToolCalls' && typeof message.timestamp === 'number') {
      const target = this.history.find((entry) => entry.timestamp === message.timestamp);
      if (target) {
        target.applied = true;
        await this.persistHistory();
        await this.panel.webview.postMessage({ type: 'assistantReplace', message: target });
      }
      return;
    }

    if (message.type === 'send' && message.prompt?.trim()) {
      await this.runPrompt(message.prompt.trim(), message.context ?? '');
    }
  }

  private async runPrompt(prompt: string, extraContext: string): Promise<void> {
    if (this.busy) {
      this.abortController?.abort(new AIStreamAbortedError());
    }

    const provider = await this.providers.getProviderForSelection(
      this.selectedProvider,
      this.selectedModel
    );
    if (!provider?.isConfigured()) {
      void vscode.window.showWarningMessage(
        'AI provider is not configured. Choose a provider and store an API key first.'
      );
      await this.postStatus('AI provider is not configured.');
      return;
    }

    const userMessage: ChatMessage = {
      role: 'user',
      content: prompt,
      timestamp: Date.now()
    };
    this.history.push(userMessage);
    this.trimHistory();
    await this.persistHistory();
    await this.panel.webview.postMessage({ type: 'appendMessage', message: userMessage });

    const assistantMessage: ChatMessage = {
      role: 'assistant',
      content: '',
      timestamp: Date.now() + 1
    };
    this.history.push(assistantMessage);
    this.trimHistory();
    await this.persistHistory();
    await this.panel.webview.postMessage({ type: 'appendMessage', message: assistantMessage });

    const activeContext = getActiveAiContext();
    const aiLanguage = normalizeAiLanguage(
      vscode.workspace.getConfiguration().get<string>(SETTINGS.aiLanguage, DEFAULT_AI_LANGUAGE)
    );
    const conversation = this
      .buildConversationMessages()
      .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
      .join('\n\n');
    const context = [
      activeContext.description,
      extraContext ? `Additional context:\n${extraContext}` : '',
      activeContext.documentPreview ? `Document preview:\n${activeContext.documentPreview}` : '',
      conversation ? `Conversation history:\n${conversation}` : ''
    ]
      .filter(Boolean)
      .join('\n\n');
    const mcpState = this.mcpClient ? await this.mcpClient.testConnection() : undefined;
    const systemPrompt = buildSystemPrompt(aiLanguage, {
      ...activeContext.projectContext,
      mcpConnected: mcpState?.connected
    });

    this.busy = true;
    this.abortController = new AbortController();
    await this.panel.webview.postMessage({ type: 'busy', busy: true });
    await this.postStatus(`Streaming response from ${provider.name}...`);

    try {
      if (provider.analyzeStream) {
        await provider.analyzeStream(
          prompt,
          context,
          systemPrompt,
          async (chunk) => {
            assistantMessage.content += chunk;
            await this.panel.webview.postMessage({
              type: 'assistantChunk',
              timestamp: assistantMessage.timestamp,
              text: chunk
            });
          },
          this.abortController.signal
        );
      } else {
        assistantMessage.content = await provider.analyze(prompt, context, systemPrompt);
      }
      assistantMessage.toolCalls = extractMcpToolCalls(assistantMessage.content);
      await this.panel.webview.postMessage({
        type: 'assistantReplace',
        message: assistantMessage
      });
      await this.postStatus(`Response complete from ${provider.name}.`);
    } catch (error) {
      if (error instanceof AIStreamAbortedError || this.abortController.signal.aborted) {
        await this.postStatus('Streaming stopped.');
        if (!assistantMessage.content.trim()) {
          const index = this.history.indexOf(assistantMessage);
          if (index >= 0) {
            this.history.splice(index, 1);
          }
        }
      } else {
        const message = error instanceof Error ? error.message : String(error);
        assistantMessage.content = message;
        await this.panel.webview.postMessage({
          type: 'assistantReplace',
          message: assistantMessage
        });
        this.logger.error('AI chat request failed', error);
        void vscode.window.showErrorMessage(message);
      }
    } finally {
      this.busy = false;
      this.abortController = undefined;
      this.trimHistory();
      await this.persistHistory();
      await this.panel.webview.postMessage({ type: 'busy', busy: false });
    }
  }

  private buildConversationMessages(): Array<{ role: string; content: string }> {
    return this.history.slice(-AI_CHAT_MAX_HISTORY).map((message) => ({
      role: message.role,
      content: message.content
    }));
  }

  private loadHistory(): ChatMessage[] {
    const stored = this.context.workspaceState.get<ChatMessage[]>(CHAT_HISTORY_KEY, []);
    return stored.filter(
      (message) =>
        (message.role === 'user' || message.role === 'assistant') &&
        typeof message.content === 'string' &&
        typeof message.timestamp === 'number'
    );
  }

  private async persistHistory(): Promise<void> {
    await this.context.workspaceState.update(CHAT_HISTORY_KEY, this.history.slice(-AI_CHAT_MAX_HISTORY));
  }

  private trimHistory(): void {
    while (this.history.length > AI_CHAT_MAX_HISTORY) {
      this.history.shift();
    }
  }

  private async postHydrate(): Promise<void> {
    await this.panel.webview.postMessage({
      type: 'hydrate',
      history: this.history,
      provider: this.selectedProvider,
      model: this.selectedModel,
      busy: this.busy,
      contextInfo: getActiveAiContext().description
    });
  }

  private async postContextInfo(): Promise<void> {
    if (this.disposed) {
      return;
    }
    await this.panel.webview.postMessage({
      type: 'contextInfo',
      text: getActiveAiContext().description
    });
  }

  private async postStatus(text: string): Promise<void> {
    await this.panel.webview.postMessage({ type: 'status', text });
  }

  private async applyToolCalls(timestamp: number): Promise<void> {
    const target = this.history.find((entry) => entry.timestamp === timestamp);
    if (!target?.toolCalls?.length) {
      return;
    }
    if (!this.mcpClient) {
      void vscode.window.showWarningMessage('MCP client is not available in this session.');
      return;
    }

    const previews = await Promise.all(
      target.toolCalls.map(async (toolCall) => {
        try {
          return `${toolCall.name}: ${await this.mcpClient?.previewToolCall(toolCall)}`;
        } catch {
          return `${toolCall.name}: preview unavailable`;
        }
      })
    );

    const choice = await vscode.window.showInformationMessage(
      `Apply ${target.toolCalls.length} MCP tool call(s)?\n\n${previews.join('\n')}`,
      'Apply',
      'Cancel'
    );
    if (choice !== 'Apply') {
      return;
    }

    for (const toolCall of target.toolCalls) {
      await this.mcpClient.callTool(toolCall.name, toolCall.arguments);
    }

    target.applied = true;
    await this.persistHistory();
    await this.panel.webview.postMessage({
      type: 'assistantReplace',
      message: target
    });
    void vscode.window.showInformationMessage('Suggested MCP changes were applied.');
  }

  private buildHtml(): string {
    const nonce = createNonce();
    const markdownUri = this.panel.webview
      .asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'vendor', 'chat-markdown.js'))
      .toString();
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${this.panel.webview.cspSource} data:; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}' ${this.panel.webview.cspSource};">
  <style nonce="${nonce}">
    :root {
      color-scheme: dark;
      --bg: #020617;
      --panel: #0f172a;
      --panel-2: #111827;
      --border: rgba(148, 163, 184, 0.18);
      --text: #e2e8f0;
      --muted: #94a3b8;
      --accent: #38bdf8;
      --assistant: #172554;
      --user: #14532d;
      --danger: #ef4444;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 0;
      background: radial-gradient(circle at top, #0f172a 0%, #020617 62%);
      color: var(--text);
      font: 13px/1.5 "Segoe UI", system-ui, sans-serif;
      height: 100vh;
      display: grid;
      grid-template-rows: auto 1fr auto;
    }
    header, footer {
      padding: 12px 14px;
      border-bottom: 1px solid var(--border);
      background: rgba(2, 6, 23, 0.88);
      backdrop-filter: blur(10px);
    }
    footer {
      border-top: 1px solid var(--border);
      border-bottom: none;
      display: grid;
      gap: 10px;
    }
    .toolbar, .composer-actions {
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
    }
    select, input, textarea, button {
      border: 1px solid var(--border);
      background: var(--panel);
      color: var(--text);
      border-radius: 10px;
      padding: 8px 10px;
      font: inherit;
    }
    textarea {
      width: 100%;
      resize: vertical;
      min-height: 76px;
    }
    button {
      cursor: pointer;
      background: linear-gradient(180deg, #0ea5e9, #0369a1);
      color: white;
      font-weight: 600;
    }
    button.secondary {
      background: #1e293b;
    }
    button.danger {
      background: linear-gradient(180deg, #ef4444, #b91c1c);
    }
    #messages {
      overflow-y: auto;
      padding: 18px 14px 24px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .message {
      max-width: min(80ch, 85%);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 12px 14px;
      white-space: normal;
      word-break: break-word;
      box-shadow: 0 20px 40px rgba(2, 6, 23, 0.18);
    }
    .message.user {
      align-self: flex-end;
      background: rgba(20, 83, 45, 0.9);
    }
    .message.assistant {
      align-self: flex-start;
      background: rgba(23, 37, 84, 0.88);
    }
    .meta {
      color: var(--muted);
      font-size: 11px;
      margin-bottom: 6px;
    }
    .status {
      color: var(--muted);
      font-size: 12px;
      margin-left: auto;
    }
    .context-box {
      background: var(--panel-2);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 10px 12px;
      color: var(--muted);
      white-space: pre-wrap;
    }
    .tool-preview {
      margin-top: 10px;
      padding-top: 10px;
      border-top: 1px solid var(--border);
      display: grid;
      gap: 8px;
    }
    .tool-list {
      color: var(--muted);
      font-size: 12px;
    }
    .empty {
      color: var(--muted);
      text-align: center;
      margin-top: 18vh;
    }
    pre, code {
      font-family: Consolas, "Cascadia Code", monospace;
    }
  </style>
</head>
<body>
  <header>
    <div class="toolbar">
      <strong>KiCad AI Chat</strong>
      <select id="provider">
        <option value="none">Disabled</option>
        <option value="claude">Claude</option>
        <option value="openai">OpenAI</option>
        <option value="copilot">GitHub Copilot</option>
        <option value="gemini">Gemini</option>
      </select>
      <input id="model" type="text" placeholder="Model override (optional)" />
      <button id="clear" class="secondary" type="button">Sohbeti Temizle</button>
      <button id="cancel" class="danger" type="button">Durdur</button>
      <span id="status" class="status">Ready</span>
    </div>
  </header>
  <main id="messages">
    <div id="empty" class="empty">Start a KiCad conversation to keep multi-turn context here.</div>
  </main>
  <footer>
    <div id="context-info" class="context-box"></div>
    <textarea id="context-input" placeholder="Extra context for this turn (optional)"></textarea>
    <textarea id="prompt-input" placeholder="Ask about DRC/ERC issues, net behavior, component choices, or fabrication risks..."></textarea>
    <div class="composer-actions">
      <button id="send" type="button">Send</button>
    </div>
  </footer>
  <script nonce="${nonce}" src="${markdownUri}"></script>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const messagesEl = document.getElementById('messages');
    const emptyEl = document.getElementById('empty');
    const providerEl = document.getElementById('provider');
    const modelEl = document.getElementById('model');
    const statusEl = document.getElementById('status');
    const promptEl = document.getElementById('prompt-input');
    const contextEl = document.getElementById('context-input');
    const contextInfoEl = document.getElementById('context-info');
    const cancelButton = document.getElementById('cancel');
    const sendButton = document.getElementById('send');
    const messageMap = new Map();

    document.getElementById('send').addEventListener('click', sendPrompt);
    document.getElementById('cancel').addEventListener('click', () => vscode.postMessage({ type: 'cancel' }));
    document.getElementById('clear').addEventListener('click', () => vscode.postMessage({ type: 'clear' }));
    providerEl.addEventListener('change', postSelection);
    modelEl.addEventListener('change', postSelection);
    promptEl.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        sendPrompt();
      }
    });

    function postSelection() {
      vscode.postMessage({
        type: 'selectionChanged',
        provider: providerEl.value,
        model: modelEl.value
      });
    }

    function sendPrompt() {
      const prompt = promptEl.value.trim();
      if (!prompt) {
        return;
      }
      vscode.postMessage({
        type: 'send',
        prompt,
        context: contextEl.value
      });
      promptEl.value = '';
    }

    function renderMessage(message) {
      let container = messageMap.get(message.timestamp);
      if (!container) {
        container = document.createElement('article');
        container.className = 'message ' + message.role;
        container.dataset.timestamp = String(message.timestamp);
        container.innerHTML = '<div class="meta"></div><div class="content"></div><div class="tools"></div>';
        messageMap.set(message.timestamp, container);
        messagesEl.appendChild(container);
      }
      container.querySelector('.meta').textContent = message.role === 'user' ? 'You' : 'Assistant';
      container.querySelector('.content').innerHTML =
        message.role === 'assistant'
          ? window.KiCadChatMarkdown.renderMarkdown(message.content || '')
          : '<p>' + window.KiCadChatMarkdown.sanitizeHtml(message.content || '') + '</p>';
      const toolsEl = container.querySelector('.tools');
      const toolCalls = Array.isArray(message.toolCalls) ? message.toolCalls : [];
      if (message.role === 'assistant' && toolCalls.length && !message.applied) {
        const toolNames = toolCalls
          .map((tool) => '<code>' + window.KiCadChatMarkdown.sanitizeHtml(tool.name) + '</code>')
          .join(', ');
        toolsEl.innerHTML =
          '<div class="tool-preview">' +
          '<strong>Suggested MCP changes</strong>' +
          '<div class="tool-list">' + toolNames + '</div>' +
          '<div class="composer-actions">' +
          '<button type="button" data-apply-toolcalls="' + message.timestamp + '">Apply</button>' +
          '<button type="button" class="secondary" data-ignore-toolcalls="' + message.timestamp + '">Ignore</button>' +
          '</div>' +
          '</div>';
        toolsEl.querySelector('[data-apply-toolcalls]')?.addEventListener('click', () => {
          vscode.postMessage({ type: 'applyToolCalls', timestamp: message.timestamp });
        });
        toolsEl.querySelector('[data-ignore-toolcalls]')?.addEventListener('click', () => {
          vscode.postMessage({ type: 'ignoreToolCalls', timestamp: message.timestamp });
        });
      } else {
        toolsEl.innerHTML = '';
      }
      emptyEl.style.display = messageMap.size ? 'none' : 'block';
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    window.addEventListener('message', (event) => {
      const message = event.data;
      if (message.type === 'hydrate') {
        providerEl.value = message.provider || 'none';
        modelEl.value = message.model || '';
        contextInfoEl.textContent = message.contextInfo || '';
        statusEl.textContent = message.busy ? 'Streaming...' : 'Ready';
        cancelButton.disabled = !message.busy;
        sendButton.disabled = !!message.busy;
        messagesEl.querySelectorAll('.message').forEach((element) => element.remove());
        messageMap.clear();
        for (const item of message.history || []) {
          renderMessage(item);
        }
        emptyEl.style.display = messageMap.size ? 'none' : 'block';
      }
      if (message.type === 'appendMessage') {
        renderMessage(message.message);
      }
      if (message.type === 'assistantChunk') {
        const current = messageMap.get(message.timestamp);
        if (current) {
          const content = current.querySelector('.content');
          const previous = current.dataset.markdown || '';
          const next = previous + message.text;
          current.dataset.markdown = next;
          content.innerHTML = window.KiCadChatMarkdown.renderMarkdown(next);
          messagesEl.scrollTop = messagesEl.scrollHeight;
        }
      }
      if (message.type === 'assistantReplace') {
        renderMessage(message.message);
      }
      if (message.type === 'status') {
        statusEl.textContent = message.text || 'Ready';
      }
      if (message.type === 'busy') {
        cancelButton.disabled = !message.busy;
        sendButton.disabled = !!message.busy;
      }
      if (message.type === 'contextInfo') {
        contextInfoEl.textContent = message.text || '';
      }
    });

    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.handleDisposed();
    this.panel.dispose();
  }

  private handleDisposed(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.abortController?.abort(new AIStreamAbortedError());
    this.disposables.forEach((disposable) => disposable.dispose());
    KiCadChatPanel.instance = undefined;
  }
}

function createNonce(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let value = '';
  for (let index = 0; index < 32; index += 1) {
    value += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }
  return value;
}
