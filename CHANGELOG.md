# Changelog

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
