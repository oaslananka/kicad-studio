import type { StudioContext } from '../types';
import { McpClient } from './mcpClient';

export class ContextBridge {
  private lastContext: StudioContext | null = null;

  constructor(private readonly client: McpClient) {}

  async pushContext(context: StudioContext): Promise<void> {
    if (JSON.stringify(context) === JSON.stringify(this.lastContext)) {
      return;
    }

    this.lastContext = context;
    await this.client.pushContext(context);
  }
}
