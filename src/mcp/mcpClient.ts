import * as vscode from 'vscode';
import { SETTINGS } from '../constants';
import type { FixItem, McpInstallStatus, McpToolCall, StudioContext } from '../types';
import { Logger } from '../utils/logger';
import { McpDetector } from './mcpDetector';

interface JsonRpcResponse<T> {
  result?: T;
  error?: {
    message?: string;
  };
}

interface RpcTransportResult<T> {
  json: JsonRpcResponse<T>;
  sessionId?: string | undefined;
}

export interface McpConnectionState {
  available: boolean;
  connected: boolean;
  install?: McpInstallStatus | undefined;
}

export class McpClient {
  private lastInstall: McpInstallStatus = { found: false, source: 'none' };
  private sessionId: string | undefined;
  private initializePromise: Promise<void> | undefined;

  constructor(
    private readonly detector: McpDetector,
    private readonly logger: Logger
  ) {}

  async detectInstall(): Promise<McpInstallStatus> {
    this.lastInstall = await this.detector.detectKicadMcpPro();
    return this.lastInstall;
  }

  async testConnection(): Promise<McpConnectionState> {
    const install = await this.detectInstall();
    const endpoint = this.getEndpoint();
    if (!endpoint) {
      return {
        available: install.found,
        connected: false,
        install
      };
    }

    try {
      await this.rpc('tools/list', {});
      return {
        available: install.found,
        connected: true,
        install
      };
    } catch (error) {
      this.logger.debug(
        `MCP connection test failed: ${error instanceof Error ? error.message : String(error)}`
      );
      return {
        available: install.found,
        connected: false,
        install
      };
    }
  }

  async pushContext(context: StudioContext): Promise<void> {
    if (!vscode.workspace.getConfiguration().get<boolean>(SETTINGS.mcpPushContext, true)) {
      return;
    }

    try {
      await this.callTool('studio_push_context', {
        ...context
      });
    } catch (error) {
      this.logger.debug(
        `MCP context push skipped: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async callTool(
    name: string,
    args: Record<string, unknown>
  ): Promise<Record<string, unknown> | undefined> {
    const result = await this.rpc<{
      content?: Array<{ text?: string }>;
      structuredContent?: Record<string, unknown>;
    }>('tools/call', {
      name,
      arguments: args
    });

    if (result?.structuredContent && typeof result.structuredContent === 'object') {
      return result.structuredContent;
    }

    const firstText = result?.content?.find((item) => typeof item.text === 'string')?.text;
    if (firstText) {
      try {
        return JSON.parse(firstText) as Record<string, unknown>;
      } catch {
        return {
          text: firstText
        };
      }
    }

    return undefined;
  }

  async previewToolCall(toolCall: McpToolCall): Promise<string> {
    const preview =
      (await this.callTool('studio_preview_tool_call', {
        name: toolCall.name,
        arguments: toolCall.arguments
      })) ?? {};
    return String(
      preview['preview'] ?? preview['text'] ?? toolCall.preview ?? 'Preview unavailable.'
    );
  }

  async readResource(uri: string): Promise<Record<string, unknown> | undefined> {
    const result = await this.rpc<{
      contents?: Array<{ text?: string }>;
    }>('resources/read', {
      uri
    });
    const text = result?.contents?.find((item) => typeof item.text === 'string')?.text;
    if (!text) {
      return undefined;
    }
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      return { text };
    }
  }

  async fetchFixQueue(): Promise<FixItem[]> {
    const resource = await this.readResource('kicad://project/fix_queue');
    const items =
      (Array.isArray(resource?.['items']) ? resource['items'] : undefined) ??
      (Array.isArray(resource?.['fixes']) ? resource['fixes'] : undefined);

    if (items) {
      return items.map((item, index) => normalizeFixItem(item, index));
    }

    const toolResult = await this.callTool('project_get_fix_queue', {});
    const fixItems =
      (Array.isArray(toolResult?.['items']) ? toolResult['items'] : undefined) ??
      (Array.isArray(toolResult?.['fixes']) ? toolResult['fixes'] : undefined) ??
      [];
    return fixItems.map((item, index) => normalizeFixItem(item, index));
  }

  private getEndpoint(): string {
    return vscode.workspace
      .getConfiguration()
      .get<string>(SETTINGS.mcpEndpoint, 'http://127.0.0.1:27185')
      .replace(/\/$/, '');
  }

  private async rpc<T>(method: string, params: Record<string, unknown>): Promise<T | undefined> {
    if (method !== 'initialize') {
      await this.ensureInitialized();
    }

    const { json, sessionId } = await this.postJsonRpc<T>(method, params);
    if (sessionId) {
      this.sessionId = sessionId;
    }
    if (json.error) {
      throw new Error(json.error.message ?? 'Unknown MCP error');
    }
    return json.result;
  }

  private async ensureInitialized(): Promise<void> {
    if (this.sessionId) {
      return;
    }
    if (this.initializePromise) {
      return this.initializePromise;
    }

    this.initializePromise = (async () => {
      const { sessionId } = await this.postJsonRpc('initialize', {
        protocolVersion: '2024-11-05',
        clientInfo: {
          name: 'kicad-studio',
          version: '2.4.0-dev'
        },
        capabilities: {}
      });
      this.sessionId = sessionId;
    })();

    try {
      await this.initializePromise;
    } finally {
      this.initializePromise = undefined;
    }
  }

  private async postJsonRpc<T>(
    method: string,
    params: Record<string, unknown>
  ): Promise<RpcTransportResult<T>> {
    const baseEndpoint = this.getEndpoint();
    const primaryEndpoint = `${baseEndpoint}/mcp`;
    const requestBody = JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method,
      params
    });

    const primaryResponse = await fetch(primaryEndpoint, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: requestBody
    });

    if (primaryResponse.status === 404 || primaryResponse.status === 405) {
      const allowLegacySse = vscode.workspace
        .getConfiguration()
        .get<boolean>(SETTINGS.mcpAllowLegacySse, false);
      if (!allowLegacySse) {
        throw new Error(
          `The configured MCP server at ${primaryEndpoint} does not expose Streamable HTTP. Upgrade kicad-mcp-pro or enable ${SETTINGS.mcpAllowLegacySse} to try the legacy /sse fallback.`
        );
      }

      this.logger.warn('Falling back to legacy MCP /sse transport because allowLegacySse is enabled.');
      return this.readRpcResponse<T>(
        await fetch(`${baseEndpoint}/sse`, {
          method: 'POST',
          headers: this.buildHeaders(),
          body: requestBody
        })
      );
    }

    return this.readRpcResponse<T>(primaryResponse);
  }

  private buildHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...(this.sessionId ? { 'MCP-Session-Id': this.sessionId } : {})
    };
  }

  private async readRpcResponse<T>(response: Response): Promise<RpcTransportResult<T>> {
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const sessionId = response.headers.get('MCP-Session-Id') ?? undefined;
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('text/event-stream')) {
      return {
        json: parseSseJsonRpc<T>(await response.text()),
        sessionId
      };
    }

    return {
      json: (await response.json()) as JsonRpcResponse<T>,
      sessionId
    };
  }
}

function normalizeFixItem(value: unknown, index: number): FixItem {
  const item = typeof value === 'object' && value !== null ? value : {};
  const record = item as Record<string, unknown>;
  return {
    id: String(record['id'] ?? `fix-${index + 1}`),
    description: String(record['description'] ?? record['title'] ?? `Suggested fix ${index + 1}`),
    severity:
      record['severity'] === 'error' ||
      record['severity'] === 'warning' ||
      record['severity'] === 'info'
        ? record['severity']
        : 'info',
    tool: String(record['tool'] ?? record['name'] ?? 'unknown_tool'),
    args:
      typeof record['args'] === 'object' && record['args'] !== null
        ? (record['args'] as Record<string, unknown>)
        : {},
    status:
      record['status'] === 'pending' ||
      record['status'] === 'applying' ||
      record['status'] === 'done' ||
      record['status'] === 'failed'
        ? record['status']
        : 'pending',
    ...(typeof record['preview'] === 'string' ? { preview: record['preview'] } : {})
  };
}

function parseSseJsonRpc<T>(payload: string): JsonRpcResponse<T> {
  const events = payload
    .split(/\r?\n\r?\n/)
    .map((chunk) =>
      chunk
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice('data:'.length).trim())
        .join('')
    )
    .filter(Boolean);

  const lastEvent = events.at(-1);
  if (!lastEvent) {
    throw new Error('The MCP server returned an empty SSE payload.');
  }

  return JSON.parse(lastEvent) as JsonRpcResponse<T>;
}
