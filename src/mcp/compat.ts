import type { McpCompatStatus } from '../types';

export const MCP_COMPAT = {
  required: '>=3.0.0 <4.0.0',
  recommended: '>=3.0.2 <4.0.0',
  testedAgainst: '3.0.2'
} as const;

export function normalizeMcpVersion(version: string | undefined): string {
  if (!version?.trim()) {
    return '0.0.0';
  }
  const parsed = parseSemver(version.trim());
  return parsed ? `${parsed.major}.${parsed.minor}.${parsed.patch}` : '0.0.0';
}

export function getMcpCompatStatus(
  version: string | undefined
): McpCompatStatus {
  const normalized = normalizeMcpVersion(version);
  if (!satisfiesCompatRange(normalized, MCP_COMPAT.required)) {
    return 'incompatible';
  }
  return satisfiesCompatRange(normalized, MCP_COMPAT.recommended)
    ? 'ok'
    : 'warn';
}

export function isMcpVersionSupported(version: string | undefined): boolean {
  return getMcpCompatStatus(version) !== 'incompatible';
}

function satisfiesCompatRange(version: string, range: string): boolean {
  const parsed = parseSemver(version);
  if (!parsed) {
    return false;
  }
  if (range === MCP_COMPAT.required) {
    return parsed.major === 3;
  }
  if (range === MCP_COMPAT.recommended) {
    return (
      parsed.major === 3 &&
      (parsed.minor > 0 || (parsed.minor === 0 && parsed.patch >= 2))
    );
  }
  return false;
}

function parseSemver(
  value: string
): { major: number; minor: number; patch: number } | undefined {
  const match = /(?:^|[^\d])(\d+)\.(\d+)(?:\.(\d+))?/.exec(value);
  if (!match) {
    return undefined;
  }
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3] ?? '0');
  if (
    !Number.isInteger(major) ||
    !Number.isInteger(minor) ||
    !Number.isInteger(patch)
  ) {
    return undefined;
  }
  return { major, minor, patch };
}
