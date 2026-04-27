# Phase v2.6.0-1 Summary

## Scope

- Added `src/mcp/compat.ts` as the compatibility source of truth.
- Promoted `semver` to a direct runtime dependency.
- Extended MCP state typing with compatible, warning, disconnected, and incompatible server-card metadata.
- Added version-gate tests for recommended, older-supported, unsupported, and missing-version initialize responses.

## Commands Run

- `npm run lint` - passed.
- `npm run typecheck` - passed.
- `npm run test:unit` - passed, 275 tests.
- `npm run check:bundle-size` - pending final consolidated run.

## Results

- Compatible `3.0.2` servers resolve to `Connected` with `compat: ok`.
- Supported older `3.0.0` servers resolve to `Connected` with `compat: warn`.
- Unsupported or missing versions resolve to `Incompatible` and block follow-up RPCs.

## Diff Counts

- Main files: `src/mcp/compat.ts`, `src/mcp/mcpClient.ts`, `src/statusbar/kicadStatusBar.ts`, `src/types.ts`, `package.json`, `package-lock.json`.
- Tests: `test/unit/mcpCompat.test.ts`, `test/unit/mcpClient.versionGate.test.ts`, `test/unit/statusBar.test.ts`.

## Deferred Follow-ups

- None for the compatibility gate.
