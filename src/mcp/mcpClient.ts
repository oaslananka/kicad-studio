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

export interface McpConnectionState {
  available: boolean;
  connected: boolean;
  install?: McpInstallStatus | undefined;
}

export class McpClient {
  private lastInstall: McpInstallStatus = { found: false, source: 'none' };

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
      await this.callTool('studio_push_context', context as unknown as Record<string, unknown>);
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
    const endpoint = `${this.getEndpoint()}/mcp`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        method,
        params
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const json = (await response.json()) as JsonRpcResponse<T>;
    if (json.error) {
      throw new Error(json.error.message ?? 'Unknown MCP error');
    }
    return json.result;
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
