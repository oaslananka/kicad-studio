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

## Status Model And Compatibility

The extension tracks MCP as an optional capability with these states:

- `NotInstalled`: no local `kicad-mcp-pro` install was detected.
- `Disconnected`: the install or cached server metadata exists, but the HTTP endpoint is not reachable.
- `Connecting`: an initialize handshake is in progress.
- `Connected`: the server initialized and its version satisfies `>=3.0.0 <4.0.0`.
- `Incompatible`: the server initialized but reported a version outside `>=3.0.0 <4.0.0`.

KiCad Studio 2.6.0 recommends `kicad-mcp-pro >=3.0.2 <4.0.0` and was tested against `3.0.2`. Connected servers in the required range but below the recommended range show `Connected (older than recommended)`. Incompatible servers do not receive context pushes, fix queue calls, quality gate calls, or manufacturing release calls.

The extension persists the last observed server card in `globalState` under `kicadstudio.mcp.lastServerCard`, including `serverInfo.version`, tool capability names, resource capability names, prompt capability names, compatibility status, and capture time. This lets the UI render a useful status while a new connection attempt is still pending.

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

Fixes that include `path` and `line` metadata also appear as VS Code Code Actions at matching diagnostics. Text-only fix queue items continue to render in the tree and remain manually applicable from that view.

## Quality Gates

The `Quality Gates` sidebar appears when MCP is connected and the workspace contains a KiCad project. It renders cached gate results immediately, then refreshes from MCP when the user runs gates.

KiCad Studio calls these MCP tools when available:

- `project_quality_gate_report`
- `pcb_placement_quality_report`
- `pcb_transfer_quality_gate`
- `manufacturing_quality_gate`

Structured payloads are preferred. Text payloads are parsed conservatively so older 3.x server responses still produce useful pass, warning, fail, blocked, or pending rows. A fresh DRC run schedules a debounced refresh of placement and transfer gates only; the full project gate remains user-triggered.

Gate payloads are cached in workspace state under `kicadstudio.qualityGate.<projectKey>`. Violations with `path` and `line` can be opened directly from the tree.

## Manufacturing Release Wizard

`KiCad: Manufacturing Release Wizard` wraps `export_manufacturing_package` with a guarded flow:

1. Select or infer a design variant.
2. Run project quality gates and block continuation on `FAIL` or `BLOCKED`.
3. Confirm the intended release output location.
4. Invoke MCP manufacturing export with progress notification support when the server provides progress.
5. Reveal the output folder or surface the structured MCP error code and hint.

The wizard emits only local opt-in telemetry hooks: `wizard.start`, `wizard.blocked`, `wizard.success`, and `wizard.failure(code)`. It does not send project paths, project names, or network telemetry.

## MCP Profile Picker

`KiCad: Pick MCP Profile` exposes the documented `kicad-mcp-pro` profiles:

- `full`
- `minimal`
- `schematic_only`
- `pcb_only`
- `manufacturing`
- `high_speed`
- `power`
- `simulation`
- `analysis`
- `agent_full`

When `.vscode/mcp.json` exists, the picker writes `servers.*.env.KICAD_MCP_PROFILE` there. Otherwise it writes `kicadstudio.mcp.profile` in user settings. After a change, the extension can restart the MCP connection.

## `.vscode/mcp.json` Schema

KiCad Studio contributes `schemas/vscode-mcp.kicad.json` for `**/.vscode/mcp.json`. The schema validates common KiCad MCP fields:

- `servers.*.command` should be `uvx`, `kicad-mcp-pro`, or an absolute path.
- `servers.*.env.KICAD_MCP_PROFILE` is validated against the current profile catalog.
- `servers.*.env.KICAD_MCP_TRANSPORT` is validated against `stdio`, `http`, `sse`, and `streamable-http`.
- `KICAD_MCP_PROJECT_DIR` descriptions recommend absolute paths.
- Legacy aliases `pcb` and `schematic` remain accepted and marked deprecated in schema metadata.

## MCP Log Viewer

`KiCad: Open MCP Log` opens a redacted in-memory log of recent MCP request/response traffic. The log viewer is additive to the existing `KiCad Studio MCP` output channel.

The ring buffer keeps 200 entries by default and can be configured up to 1000 through `kicadstudio.mcp.logSize`. It redacts authorization headers, replaces paths under the user home directory with `~`, and truncates payload bodies above 8 KB.

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
4. Pick a focused profile if `full` is broader than the task.
5. Open a KiCad project and run DRC/ERC.
6. Use `Quality Gates`, `AI Fix Queue`, `Design Intent`, `Open AI Chat`, or the manufacturing release wizard for assisted workflows.
