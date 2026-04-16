import { McpClient } from '../../src/mcp/mcpClient';
import { __setConfiguration } from './vscodeMock';

function createJsonResponse(body: unknown, init?: { status?: number; headers?: Record<string, string> }) {
  return {
    ok: (init?.status ?? 200) >= 200 && (init?.status ?? 200) < 300,
    status: init?.status ?? 200,
    headers: new Headers({
      'content-type': 'application/json',
      ...(init?.headers ?? {})
    }),
    json: async () => body
  };
}

function createSseResponse(payload: string, init?: { status?: number; headers?: Record<string, string> }) {
  return {
    ok: (init?.status ?? 200) >= 200 && (init?.status ?? 200) < 300,
    status: init?.status ?? 200,
    headers: new Headers({
      'content-type': 'text/event-stream',
      ...(init?.headers ?? {})
    }),
    text: async () => payload
  };
}

describe('McpClient', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    __setConfiguration({
      'kicadstudio.mcp.endpoint': 'http://127.0.0.1:27185',
      'kicadstudio.mcp.pushContext': true,
      'kicadstudio.mcp.allowLegacySse': false
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  function createClient() {
    return new McpClient(
      { detectKicadMcpPro: jest.fn().mockResolvedValue({ found: true, source: 'uvx' }) } as never,
      { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } as never
    );
  }

  it('initializes a session and reuses MCP-Session-Id for subsequent calls', async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce(
        createJsonResponse({ result: {} }, { headers: { 'MCP-Session-Id': 'session-123' } })
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          result: {
            structuredContent: { ok: true }
          }
        })
      );
    global.fetch = fetchMock as typeof fetch;

    const result = await createClient().callTool('project_ping', {});

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[1]?.headers).toEqual(
      expect.objectContaining({ 'MCP-Session-Id': 'session-123' })
    );
  });

  it('parses JSON text tool results and falls back to plain text when JSON parsing fails', async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce(
        createJsonResponse({ result: {} }, { headers: { 'MCP-Session-Id': 'session-json' } })
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          result: {
            content: [{ text: '{"preview":"ready"}' }]
          }
        })
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          result: {
            content: [{ text: 'preview unavailable' }]
          }
        })
      );
    global.fetch = fetchMock as typeof fetch;

    const client = createClient();

    await expect(client.callTool('tool_json', {})).resolves.toEqual({ preview: 'ready' });
    await expect(client.callTool('tool_text', {})).resolves.toEqual({ text: 'preview unavailable' });
  });

  it('parses JSON-RPC payloads returned over text/event-stream', async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce(
        createJsonResponse({ result: {} }, { headers: { 'MCP-Session-Id': 'session-xyz' } })
      )
      .mockResolvedValueOnce(
        createSseResponse(
          'event: message\ndata: {"result":{"structuredContent":{"preview":"via-sse"}}}\n\n'
        )
      );
    global.fetch = fetchMock as typeof fetch;

    const result = await createClient().callTool('tool_sse', {});

    expect(result).toEqual({ preview: 'via-sse' });
  });

  it('reads resources as JSON when possible and as raw text otherwise', async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce(
        createJsonResponse({ result: {} }, { headers: { 'MCP-Session-Id': 'session-resource' } })
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          result: {
            contents: [{ text: '{"items":[{"id":"fix-1"}]}' }]
          }
        })
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          result: {
            contents: [{ text: 'raw-text' }]
          }
        })
      );
    global.fetch = fetchMock as typeof fetch;

    const client = createClient();

    await expect(client.readResource('kicad://project/fix_queue')).resolves.toEqual({
      items: [{ id: 'fix-1' }]
    });
    await expect(client.readResource('kicad://project/notes')).resolves.toEqual({ text: 'raw-text' });
  });

  it('prefers the fix queue resource and falls back to a tool call when the resource is empty', async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce(
        createJsonResponse({ result: {} }, { headers: { 'MCP-Session-Id': 'session-fixes' } })
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          result: {
            contents: [{ text: '{"items":[{"id":"fix-1","description":"From resource"}]}' }]
          }
        })
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          result: {
            contents: []
          }
        })
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          result: {
            structuredContent: {
              items: [{ id: 'fix-2', description: 'From tool', tool: 'apply_fix', args: {} }]
            }
          }
        })
      );
    global.fetch = fetchMock as typeof fetch;

    const client = createClient();

    await expect(client.fetchFixQueue()).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'fix-1' })])
    );
    await expect(client.fetchFixQueue()).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'fix-2', tool: 'apply_fix' })])
    );
  });

  it('handles disabled context push and connection failures gracefully', async () => {
    __setConfiguration({
      'kicadstudio.mcp.endpoint': 'http://127.0.0.1:27185',
      'kicadstudio.mcp.pushContext': false,
      'kicadstudio.mcp.allowLegacySse': false
    });
    const fetchMock = jest.fn().mockResolvedValue(
      createJsonResponse({ error: { message: 'boom' } }, { status: 500 })
    );
    global.fetch = fetchMock as typeof fetch;

    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    const client = new McpClient(
      { detectKicadMcpPro: jest.fn().mockResolvedValue({ found: true, source: 'uvx' }) } as never,
      logger as never
    );

    await expect(
      client.pushContext({
        activeFile: 'board.kicad_pcb',
        fileType: 'pcb',
        drcErrors: []
      })
    ).resolves.toBeUndefined();

    await expect(client.testConnection()).resolves.toEqual(
      expect.objectContaining({ available: true, connected: false })
    );
    expect(logger.debug).toHaveBeenCalled();
  });

  it('uses the legacy /sse fallback only when explicitly enabled', async () => {
    __setConfiguration({
      'kicadstudio.mcp.endpoint': 'http://127.0.0.1:27185',
      'kicadstudio.mcp.pushContext': true,
      'kicadstudio.mcp.allowLegacySse': true
    });
    const fetchMock = jest.fn()
      .mockResolvedValueOnce(createJsonResponse({ result: {} }, { status: 404 }))
      .mockResolvedValueOnce(createJsonResponse({ result: {} }))
      .mockResolvedValueOnce(createJsonResponse({ result: {} }, { status: 404 }))
      .mockResolvedValueOnce(
        createJsonResponse({
          result: {
            structuredContent: { fallback: true }
          }
        })
      );
    global.fetch = fetchMock as typeof fetch;

    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    const client = new McpClient(
      { detectKicadMcpPro: jest.fn().mockResolvedValue({ found: true, source: 'uvx' }) } as never,
      logger as never
    );

    await expect(client.callTool('legacy_tool', {})).resolves.toEqual({ fallback: true });
    expect(fetchMock.mock.calls[1]?.[0]).toBe('http://127.0.0.1:27185/sse');
    expect(fetchMock.mock.calls[3]?.[0]).toBe('http://127.0.0.1:27185/sse');
    expect(logger.warn).toHaveBeenCalled();
  });

  it('reports a healthy connection when tools/list succeeds', async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce(
        createJsonResponse({ result: {} }, { headers: { 'MCP-Session-Id': 'session-ok' } })
      )
      .mockResolvedValueOnce(createJsonResponse({ result: { tools: [] } }));
    global.fetch = fetchMock as typeof fetch;

    await expect(createClient().testConnection()).resolves.toEqual(
      expect.objectContaining({ available: true, connected: true })
    );
  });

  it('returns preview fallback text and undefined resources when MCP omits text content', async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce(
        createJsonResponse({ result: {} }, { headers: { 'MCP-Session-Id': 'session-preview' } })
      )
      .mockResolvedValueOnce(createJsonResponse({ result: { structuredContent: {} } }))
      .mockResolvedValueOnce(createJsonResponse({ result: { contents: [{}] } }));
    global.fetch = fetchMock as typeof fetch;

    const client = createClient();

    await expect(
      client.previewToolCall({ name: 'project_fix', arguments: {}, preview: 'Saved preview' })
    ).resolves.toBe('Saved preview');
    await expect(client.readResource('kicad://project/empty')).resolves.toBeUndefined();
  });

  it('logs and swallows context-push errors when MCP is enabled but unavailable', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      createJsonResponse({ error: { message: 'bad gateway' } }, { status: 502 })
    );
    global.fetch = fetchMock as typeof fetch;

    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    const client = new McpClient(
      { detectKicadMcpPro: jest.fn().mockResolvedValue({ found: true, source: 'uvx' }) } as never,
      logger as never
    );

    await expect(
      client.pushContext({
        activeFile: 'board.kicad_pcb',
        fileType: 'pcb',
        drcErrors: ['clearance']
      })
    ).resolves.toBeUndefined();

    expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('MCP context push skipped'));
  });

  it('reports a clear upgrade error when the server does not expose streamable HTTP', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      createJsonResponse({ result: {} }, { status: 404 })
    );
    global.fetch = fetchMock as typeof fetch;

    await expect(createClient().callTool('legacy_only_tool', {})).rejects.toThrow(
      'does not expose Streamable HTTP'
    );
  });
});
