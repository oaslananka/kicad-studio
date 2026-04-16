# MCP Integration

## Goal

KiCad Studio integrates with `kicad-mcp-pro` without forcing it on every user. The extension treats MCP as an optional capability that can enhance AI-assisted design review, rule editing, and project automation.

## Detection

`src/mcp/mcpDetector.ts` checks for:

- `uvx kicad-mcp-pro --version`
- `kicad-mcp-pro --version`
- `pip show kicad-mcp-pro`
- `pipx list`

If the tool is detected and the workspace does not already contain `.vscode/mcp.json`, KiCad Studio can offer to generate that file automatically.

## Generated `.vscode/mcp.json`

The generated config uses a stdio server entry and sets:

- `KICAD_MCP_PROJECT_DIR`
- `KICAD_MCP_PROFILE=full`

This keeps the bootstrap lightweight while remaining compatible with external MCP clients such as Claude Code and Cursor.

On compatible VS Code versions, KiCad Studio also contributes an MCP server definition provider so Copilot agent mode can discover `kicad-mcp-pro` without a checked-in workspace config.

## Status Model

The extension tracks two MCP states:

- Available: the local installation was detected.
- Connected: the configured HTTP endpoint responded to an MCP request.

The status bar reflects these states through `MCP Setup`, `MCP Available`, or `MCP Connected`.

## HTTP Transport

The extension-side MCP client targets Streamable HTTP:

- `POST /mcp`
- `Accept: application/json, text/event-stream`
- `MCP-Session-Id` is captured from the initialize response and sent on subsequent requests

If a server responds with `404` or `405`, KiCad Studio does not silently fall back to legacy `/sse` transport unless `kicadstudio.mcp.allowLegacySse` is explicitly enabled.

## Context Bridge

When enabled, KiCad Studio pushes:

- active file path
- file type
- recent DRC errors
- selected reference
- selected lasso area
- cursor position
- active sheet path
- visible PCB layers
- active variant

This lets external AI tooling understand what the user currently has open in the editor.

## Fix Queue

If the MCP server exposes `kicad://project/fix_queue` or a compatible tool call, the extension renders those items inside the `AI Fix Queue` view. Each item supports:

- previewing the proposed change
- applying the tool-backed fix
- refreshing the list after DRC or manual action

## Design Intent

The Design Intent panel is a friendly wrapper around:

- `project_get_design_intent`
- `project_set_design_intent`

Typical inputs include:

- connector references
- power tree references
- decoupling pairs
- analog/digital partitioning notes
- fabrication profile
- extra design constraints

## AI Tool Calls

When MCP is connected, the AI system prompt allows suggested tool calls inside fenced `mcp` blocks. The chat panel parses these blocks and gives the user an explicit apply/ignore action.

## Recommended User Flow

1. Install `kicad-mcp-pro`.
2. Run `KiCad: Setup MCP Integration`.
3. Start or connect to the MCP server endpoint if HTTP mode is required.
4. Open a KiCad project and run DRC/ERC.
5. Use `AI Fix Queue`, `Design Intent`, or `Open AI Chat` for assisted workflows.
