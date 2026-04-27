# Phase v2.6.0-2 Summary

## Scope

- Added MCP retry/retry-now command wiring and installer candidate detection.
- Added `KiCad: Install kicad-mcp-pro` with `uvx`, `pipx`, and `pip` task execution paths.
- Added async extension deactivate cleanup through `McpClient.deactivate()`.

## Commands Run

- `npm run lint` - passed.
- `npm run typecheck` - passed.
- `npm run test:unit` - passed, 275 tests.
- `npm run check:bundle-size` - pending final consolidated run.

## Results

- Installer candidate priority is covered by unit tests.
- Retry command clears pending reconnect timers and re-runs connection state detection.
- Deactivate now awaits MCP cleanup instead of fire-and-forget disposal.

## Diff Counts

- Main files: `src/mcp/mcpClient.ts`, `src/mcp/mcpDetector.ts`, `src/commands/mcpCommands.ts`, `src/extension.ts`, `package.json`.
- Tests: `test/unit/mcpDetector.test.ts`, `test/unit/mcpClient.versionGate.test.ts`.

## Deferred Follow-ups

- Full owned-stdio process lifecycle remains future-proofed but not exercised by the current HTTP-oriented extension client.
