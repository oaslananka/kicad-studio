# Phase v2.6.0-6 Summary

## Scope

- Added `KICAD_MCP_PROFILES`.
- Added profile picker command.
- Updated the single MCP status entry to show connected profile text and profile-picker action.

## Commands Run

- `npm run lint` - passed.
- `npm run typecheck` - passed.
- `npm run test:unit` - passed, 275 tests.

## Results

- Profile writes target `.vscode/mcp.json` when present and user settings otherwise.
- Status bar remains a single MCP entry and switches actions by state.

## Diff Counts

- Main files: `src/mcp/profileCatalog.ts`, `src/commands/mcpProfilePicker.ts`, `src/statusbar/kicadStatusBar.ts`, `src/extension.ts`, `package.json`.

## Deferred Follow-ups

- None.
