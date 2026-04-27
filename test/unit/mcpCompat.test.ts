import {
  MCP_COMPAT,
  getMcpCompatStatus,
  isMcpVersionSupported,
  normalizeMcpVersion
} from '../../src/mcp/compat';

describe('MCP compatibility helpers', () => {
  it('declares the supported MCP 3.x contract', () => {
    expect(MCP_COMPAT).toEqual({
      required: '>=3.0.0 <4.0.0',
      recommended: '>=3.0.2 <4.0.0',
      testedAgainst: '3.0.2'
    });
  });

  it('normalizes versions and classifies compatibility', () => {
    expect(normalizeMcpVersion('kicad-mcp-pro 3.0.2')).toBe('3.0.2');
    expect(normalizeMcpVersion(undefined)).toBe('0.0.0');
    expect(getMcpCompatStatus('3.0.2')).toBe('ok');
    expect(getMcpCompatStatus('3.0.0')).toBe('warn');
    expect(getMcpCompatStatus('2.4.8')).toBe('incompatible');
    expect(isMcpVersionSupported('3.1.0')).toBe(true);
    expect(isMcpVersionSupported('4.0.0')).toBe(false);
  });
});
