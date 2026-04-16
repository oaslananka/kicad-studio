import type { StudioContext } from '../types';
import { McpClient } from './mcpClient';

export class ContextBridge {
  private lastContext: StudioContext | null = null;
  private pendingContext: StudioContext | null = null;
  private flushTimer: NodeJS.Timeout | undefined;

  constructor(private readonly client: McpClient) {}

  async pushContext(context: StudioContext): Promise<void> {
    if (JSON.stringify(context) === JSON.stringify(this.lastContext)) {
      return;
    }

    this.pendingContext = context;
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
    }

    this.flushTimer = setTimeout(() => {
      const nextContext = this.pendingContext;
      this.pendingContext = null;
      this.flushTimer = undefined;
      if (!nextContext || JSON.stringify(nextContext) === JSON.stringify(this.lastContext)) {
        return;
      }

      this.lastContext = nextContext;
      void this.client.pushContext(nextContext);
    }, 500);
  }
}
