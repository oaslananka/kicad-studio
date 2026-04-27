# v2.6.0 Implementation Decisions

- MCP remains optional. All new MCP commands are gated by connection state, workspace trust, or both, while KiCad-only commands retain their existing paths.
- `semver` was promoted to a direct runtime dependency because compatibility negotiation runs in production extension code.
- The production bundle uses a narrow fixed-range parser for the documented `>=3.0.0 <4.0.0` and `>=3.0.2 <4.0.0` compatibility ranges because externalizing `semver` caused VSCE to include the production dependency tree and exceed the VSIX budget. The direct dependency remains declared for the release contract.
- Code Actions are emitted only for fix queue items with explicit `path` and `line` metadata. Text-only fixes continue to render in the tree.
- The Quality Gates provider prefers structured `*_report` payloads and falls back to conservative text parsing for 3.x payloads without structured fields.
- Real-server tests vendor benchmark fixtures under `test/fixtures/benchmark_projects` and do not clone or update `kicad-mcp-pro` during CI.
- The checked-in quality gate screenshot is a placeholder copied from the existing DRC screenshot until a dev-host capture with a real MCP server is available.
