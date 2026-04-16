# Phase 9 Summary

## What changed

- Extended MCP detection to include `pipx list`.
- Added Streamable HTTP MCP session handling, `Accept: application/json, text/event-stream`, and guarded legacy SSE fallback.
- Added MCP server definition provider registration for supported VS Code builds.
- Improved MCP setup flow to choose a profile before writing `.vscode/mcp.json`.

## Files touched

- `src/mcp/mcpClient.ts`
- `src/mcp/mcpDetector.ts`
- `src/extension.ts`
- `src/lm/mcpServerDefinitionProvider.ts`
- `package.json`
- `docs/INTEGRATION.md`
- `test/unit/mcpDetector.test.ts`
- `test/unit/languageModelMcpProvider.test.ts`

## Tests added

- MCP detector `pipx` coverage
- MCP server definition provider registration and resolution coverage

## Coverage delta

- Improved `src/lm/mcpServerDefinitionProvider.ts` to `100%` statements / `87.5%` branches.

## New risks

- MCP server definition registration depends on newer VS Code LM APIs and is intentionally feature-detected on older hosts.
