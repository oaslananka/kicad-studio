import * as os from 'node:os';
import { McpLogger } from '../../src/mcp/mcpLogger';
import { __setConfiguration } from './vscodeMock';

describe('McpLogger', () => {
  beforeEach(() => {
    __setConfiguration({ 'kicadstudio.mcp.logSize': 2 });
  });

  it('evicts old entries and renders markdown', () => {
    const logger = new McpLogger();
    logger.recordRequest('a', '{}', {});
    logger.recordResponse('b', { ok: true });
    logger.recordError('c', 'boom');

    expect(logger.list()).toHaveLength(2);
    expect(logger.renderMarkdown()).toContain('ERROR c');
  });

  it('redacts authorization headers and user home paths', () => {
    const logger = new McpLogger();
    logger.recordRequest('tools/call', JSON.stringify({ path: os.homedir() }), {
      Authorization: 'Bearer secret'
    });

    const rendered = logger.renderMarkdown();
    expect(rendered).toContain('[redacted]');
    expect(rendered).toContain('~');
    expect(rendered).not.toContain('Bearer secret');
  });

  it('truncates large payloads and clears entries', () => {
    const logger = new McpLogger();
    logger.recordResponse('large', { body: 'x'.repeat(9000) });
    expect(logger.renderMarkdown()).toContain('[truncated]');
    logger.clear();
    expect(logger.renderMarkdown()).toContain('No MCP traffic');
  });
});
