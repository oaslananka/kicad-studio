# Next Release Backlog

- MCP fix queue Code Actions are limited to fix items that include `path` and `line` metadata. Keep text-only queue items in the tree until `kicad-mcp-pro` exposes universal source locations for all fixes.
- Replace the placeholder `assets/screenshots/quality-gates.png` with a fresh dev-host capture once a real project/server pair is available in the screenshot environment.
- Consider MCP-side progress notification plumbing in the manufacturing release wizard once `notifications/progress` support is consistently exposed by the tested server range.
- Track post-release feedback for the `v2.6.x` patch line and keep MCP-side schema requests separate from KiCad Studio-only fixes.
