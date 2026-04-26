# Changelog

## [2.4.5] - 2026-04-26

### Fixed

- Stopped S-expression diagnostics and language services from running on `.kicad_pro` / `.kicad_jobset` JSON project files, preventing false `Unknown KiCad node "{"` warnings on newly created KiCad projects.

## [2.4.4] - 2026-04-26

### Fixed

- Preferred the repository-level `VSCE_PAT` and `OVSX_PAT` secrets for publishing, with Doppler as a fallback, so org CI/CD can publish without depending on a stale Doppler marketplace token.

## [2.4.3] - 2026-04-26

### Fixed

- Disabled automatic setup-node package-manager cache probing so GitHub Actions upgrades npm before `devEngines` validation runs.
- Aligned local and CI quality gates around the pinned Node.js 24.14.1 and npm 11.13.0 toolchain.

## [2.4.2] - 2026-04-18

### Fixed

- Scoped KiCad Studio view-title actions correctly so they no longer leak into unrelated VS Code view headers.
- Fixed the viewer webview bootstrap script generation so PCB and schematic custom editors no longer stall before the render pipeline starts.
- Minimal KiCad 10 schematic and PCB files now attempt KiCanvas and CLI SVG fallback rendering before showing the empty-document overlay.

## [2.4.1] - 2026-04-17

### Changed

- Moved the heavy viewer stylesheet into a bundled media asset so the production extension bundle stays under the release regression gate.

### Fixed

- Schematic and PCB viewers now fall back to CLI-generated SVG when KiCanvas reports success but renders blank or fails to produce a drawable surface.
- Fallback viewers now preserve KiCad-like backgrounds, stable zoom/pan behavior, and persistent tool buttons across schematic and PCB documents.
- Viewer loading no longer briefly flashes transient KiCanvas HUD controls before the final render mode is ready.

## [2.4.0] - 2026-04-16

### Added

- Language Model Tools contributions for DRC/ERC, Gerber export, file opening, component/library search, active-context reads, and variant listing/switching.
- `kicadstudio.manageChatProvider` plus a Claude-backed Language Model Chat Provider contribution for VS Code hosts that support chat-provider registration.
- MCP server definition provider contribution so compatible VS Code builds can discover `kicad-mcp-pro` without requiring `.vscode/mcp.json`.
- Baseline-driven bundle-size regression checks with `scripts/bundle-size-baseline.json`.
- CI dependency auditing via `npm audit --audit-level=moderate`.

### Changed

- Bumped the extension version to `2.4.0`.
- MCP bootstrap now supports explicit profile selection and `pipx` detection fallback.
- MCP HTTP transport now follows Streamable HTTP expectations, including `Accept: application/json, text/event-stream` and `MCP-Session-Id` reuse.
- Viewer and webview message handling now performs stricter runtime validation before acting on inbound payloads.
- Activation logging now emits a warning when startup exceeds 500 ms.
- README and docs were refreshed for LM tools, chat-provider support, Streamable HTTP MCP behavior, and KiCad 10 guidance.

### Fixed

- Hardened the Playwright VS Code smoke-test harness cleanup path for Windows temp directories so release validation no longer fails on transient `EPERM` cleanup locks.
- `kicad-cli` runner now supports cancellation-aware progress flows, typed exit errors, and KiCad text-variable expansion through `--define-var`.
- Component search, variant helpers, and LM/MCP registrations now have unit and integration coverage for the new branches introduced in the 2.4.0 work.
- Webview CSPs now avoid inline/eval allowances while keeping all scripts nonce-gated.

### Removed

- The stale placeholder release-notes section so the changelog maps directly to shipped versions.

## [2.3.3] - 2026-04-16

### Fixed

- Hardened the Playwright VS Code smoke-test harness cleanup path for Windows temp directories so release validation no longer fails on transient `EPERM` cleanup locks.

## [2.3.2] - 2026-04-16

### Changed

- Repackaged the 2.3.1 test-hardening release so the published VSIX, changelog, and GitHub release metadata stay in sync.
- Refreshed the marketplace artifact from the current repository state without changing runtime behavior.

## [2.3.1] - 2026-04-16

### Added

- Real VS Code desktop smoke E2E coverage using Playwright CDP automation and a dedicated test harness.
- Integration coverage for schematic and PCB custom editor opening flows plus `.kicad_dru` language activation.
- Unit coverage for KiCad 10 variants, graphical DRC rules, MCP detection branches, and status bar states.

### Changed

- Expanded the extension command registration integration test to cover the current KiCad 10 and MCP command surface.
- Updated contributing guidance to treat `npm run test:e2e` as part of desktop-facing validation.

## [2.3.0] - 2026-04-16

### Added

- AI streaming responses with real-time token display.
- Multi-turn AI chat panel (`kicadstudio.openAiChat`).
- Local KiCad symbol and footprint library search.
- `ComponentSearchCache` for 24-hour Octopart/LCSC caching.
- CONTRIBUTING, security, code of conduct, and GitHub issue/PR templates.
- JSDoc and architecture documentation updates for the 2.0.0 refactor surface.
- KiCad 10-oriented sidebar features for variants, DRC rules, MCP fix queue, and design intent editing.
- GitHub Copilot and Gemini provider support through the VS Code Language Model API.
- MCP auto-detection, context bridge plumbing, and manual-apply chat tool suggestions.
- KiCad 10 fixtures and E2E scaffolding for viewer coverage expansion.

### Changed

- AI max tokens increased from 1200 to 4096.
- Azure DevOps is now the primary CI/CD system, while GitHub Actions are manual fallback workflows only.
- TypeScript now uses `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, and `noImplicitOverride`.
- Status bar now reflects AI configuration/health in addition to CLI and DRC/ERC state.
- README and docs were updated for KiCad 10, MCP, AI provider options, and Azure pipeline flow.

### Fixed

- KiCad document parsing now coalesces duplicate parse requests.
- `kicad-cli` runner now de-duplicates identical in-flight commands.
- Viewer payloads now cache base64 content by file mtime and refresh more predictably.

## [2.0.1] - 2026-04-14

### Changed

- Updated the default OpenAI model to `gpt-5.4`.

### Fixed

- Repaired the npm lockfile metadata so VSIX packaging installs cleanly.
- Hardened BOM, netlist, and chat webview rendering against raw HTML injection.
- Restricted datasheet links to HTTP(S) URLs before opening externally.
- Added timeouts for Octopart and LCSC component search requests.

## [1.0.2] - 2026-04-13

### Changed

- VSIX packaging scripts now use plain `vsce package`/`vsce publish` without Azure URL overrides so Marketplace README screenshots resolve from GitHub.
- `package:ls` now uses `vsce ls --tree` for compatibility with current vsce CLI.

## [1.0.1] - 2026-04-13

### Changed

- Azure DevOps pipelines now use `UseNode@1` instead of deprecated `NodeTool@0` to remove deprecation warnings in CI and publish jobs.

## [1.0.0] - 2026-04-13

### Added

- Interactive schematic viewer powered by a bundled KiCanvas build (KiCad 6–9 support)
- Interactive PCB viewer with layer summaries and refresh support
- Auto-refresh on file save
- Syntax highlighting for `.kicad_sch`, `.kicad_pcb`, `.kicad_sym`, `.kicad_mod`, `.kicad_pro`
- Document symbols, hover tooltips, and auto-completion for KiCad S-expressions
- `kicad-cli` auto-detection on Windows, macOS, and Linux
- Export commands for Gerbers, drill, PDF, SVG, IPC-2581, ODB++, 3D GLB, BOM, and netlist
- DRC/ERC integration with the VS Code Problems panel
- Bill of Materials table view with sorting, filtering, and export
- Component search via Octopart/Nexar and LCSC
- Visual Git diff viewer for schematics and PCBs
- AI-powered error analysis and circuit explanation (Claude and OpenAI)
- KiCad project tree view
- Status bar with KiCad version and DRC/ERC status
- Task provider for CI/CD integration
- Export presets
- Keyboard shortcuts for DRC, ERC, and Gerber export
- Getting Started walkthrough
- Provider-aware AI defaults with Claude `claude-sonnet-4-6` and OpenAI `gpt-4.1`.
- OpenAI Responses mode plus Chat Completions compatibility mode.
- AI response language setting for English, Turkish, German, Simplified Chinese, and Japanese.
- Real CLI-backed netlist node extraction for the Netlist view.
- KiCad jobset discovery and `kicad-cli jobset run` command.
- KiCad 9+ export commands for BREP, PLY, GenCAD, IPC-D-356, DXF, pick-and-place, footprint SVG, and symbol SVG.
- Manufacturing package export with generic, JLCPCB, and PCBWay ZIP profiles.
- Bundle size regression gate for CI/publish pipelines.
- Expanded KiCad snippets for labels, sheets, tracks, vias, pads, and zones.

### Changed

- Schematic and PCB viewer providers now share a base KiCanvas provider implementation.
- Diff viewer is now a command-driven panel manager instead of an unused custom editor provider.
- Project tree scanning is asynchronous and includes `.kicad_jobset` files.
- `findAllNodes()` uses a lazy tag index for large S-expression documents.
- Viewer theme payload follows `kicadstudio.viewer.theme`.
- Status menu now shows CLI status, DRC/ERC summaries, export shortcuts, and settings navigation.
- BOM CSV export writes a UTF-8 BOM and handles carriage returns correctly.
- README, marketplace metadata, command contributions, and VSIX ignore rules were updated for the new release surface.

### Removed

- Runtime plaintext API key fallback for AI and Octopart/Nexar settings. Deprecated values are migrated to VS Code SecretStorage on activation when found.
- Pseudo-telemetry setting/service.
- Unused VisualDiffProvider code.
- Development `// DONE` banner comments.

### Added
