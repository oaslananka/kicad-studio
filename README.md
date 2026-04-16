# KiCad Studio

[![VS Marketplace](https://img.shields.io/visual-studio-marketplace/v/oaslananka.kicadstudio)](https://marketplace.visualstudio.com/items?itemName=oaslananka.kicadstudio)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/oaslananka.kicadstudio)](https://marketplace.visualstudio.com/items?itemName=oaslananka.kicadstudio)
[![KiCad 10](https://img.shields.io/badge/KiCad-10-success.svg)](https://www.kicad.org)
[![kicad-mcp-pro](https://img.shields.io/badge/kicad--mcp--pro-compatible-blue)](https://github.com/oaslananka/kicad-mcp-pro)
[![GitHub Copilot](https://img.shields.io/badge/GitHub%20Copilot-supported-black)](https://copilot.github.com)
[![Azure DevOps](https://img.shields.io/badge/CI%2FCD-Azure%20DevOps-0078D4)](https://dev.azure.com/oaslananka/open-source/_git/kicad-studio)

KiCad Studio turns VS Code into a practical KiCad workspace: view schematics and PCBs, run DRC/ERC, inspect BOMs and netlists, export manufacturing outputs, compare changes, search components and libraries, and optionally connect AI tooling through `kicad-mcp-pro`.

![KiCad Studio demo](assets/screenshots/ai-assistant.png)

## Repository And CI/CD

- GitHub mirror and Marketplace-facing repository:
  `https://github.com/oaslananka/kicad-studio`
- Primary source of truth and CI/CD:
  `https://dev.azure.com/oaslananka/open-source/_git/kicad-studio`
- GitHub Actions are kept as manual fallback workflows only.
- Azure DevOps runs the main CI pipeline and the approval-gated publish flow.

## What's New For KiCad 10

- KiCad 10-aware viewer metadata for layer summaries, tuning profiles, and selection context.
- KiCad design variants sidebar with active-variant switching and BOM override diffing.
- `.kicad_dru` language support, schema wiring, and DRC rules sidebar.
- 3D PDF export command through `kicad-cli pcb export 3dpdf`.
- Optional MCP bridge for context push, fix queue surfacing, and design intent editing.
- AI prompt updates for KiCad 10 concepts such as variants, graphical DRC rules, hop-over display, and time-domain tuning.

## Feature Highlights

- Interactive schematic and PCB viewing through a bundled KiCanvas build.
- DRC/ERC diagnostics mapped into the VS Code Problems panel.
- Fabrication and documentation exports including Gerber, drill, IPC-2581, ODB++, DXF, GenCAD, IPC-D-356, BOM, netlist, 3D GLB/BREP/PLY, and 3D PDF.
- Variants, DRC rules, and AI fix queue sidebars for KiCad 10-era workflows.
- Optional AI providers: Claude, OpenAI, GitHub Copilot, and Gemini.
- `kicad-mcp-pro` bootstrap, context bridge, and design intent form panel.
- Local KiCad symbol and footprint indexing plus Octopart/Nexar and LCSC component search.
- Azure-first CI/CD with manual GitHub fallback workflows.

## KiCad Support Matrix

| Capability | KiCad 9 | KiCad 10 |
| --- | --- | --- |
| Schematic / PCB viewer | Supported | Supported with improving upstream KiCanvas coverage |
| DRC / ERC via `kicad-cli` | Supported | Supported |
| Design variants sidebar | Limited project fallback | Supported |
| `.kicad_dru` rule discovery | Basic text mode | Supported |
| 3D PDF export | Not available | Supported |
| Time-domain tuning metadata | Not available | Supported |
| MCP-assisted fix workflows | Supported when project context exists | Supported |

## AI And MCP

### AI Providers

- Claude and OpenAI use SecretStorage-backed API keys.
- GitHub Copilot and Gemini use the VS Code Language Model API when available.
- AI features remain opt-in and are disabled when no provider is configured.

### `kicad-mcp-pro` Integration

- Auto-detects `kicad-mcp-pro` from `uvx`, a global executable, or `pip`.
- Offers to create `.vscode/mcp.json` in the active workspace.
- Pushes active file, DRC summary, selection context, and active variant to MCP.
- Surfaces `kicad://project/fix_queue` as the `AI Fix Queue` view.
- Lets users edit project design intent from a dedicated webview form.

See [docs/INTEGRATION.md](docs/INTEGRATION.md) for the detailed MCP workflow.

## Quick Start

1. Install KiCad 10 if you want full variant, tuning, and 3D PDF support.
2. Install the extension from the VS Code Marketplace.
3. Open a folder containing a `.kicad_pro`, `.kicad_sch`, or `.kicad_pcb` file.
4. Run `KiCad: Detect kicad-cli` once to validate your local KiCad installation.
5. Open a schematic or PCB file to use the viewer, project tree, BOM, netlist, and export commands.
6. Optionally run `KiCad: Setup MCP Integration` if `kicad-mcp-pro` is installed locally.

## Installation

### VS Code

```bash
code --install-extension oaslananka.kicadstudio
```

### KiCad CLI

- Windows: KiCad Studio auto-checks common `Program Files` KiCad locations, including KiCad 10.
- macOS: it checks the KiCad app bundle and common Homebrew paths.
- Linux: it checks standard binary locations such as `/usr/bin`, `/usr/local/bin`, and `~/.local/bin`.

If detection fails, set `kicadstudio.kicadCliPath` manually. More detail lives in [docs/installation.md](docs/installation.md).

## Key Commands

- `KiCad: Detect kicad-cli`
- `KiCad: Run Design Rule Check (DRC)`
- `KiCad: Run Electrical Rule Check (ERC)`
- `KiCad: Export 3D PDF`
- `KiCad: Setup MCP Integration`
- `KiCad: Open Design Intent`
- `KiCad: Open AI Chat`
- `KiCad: New Variant`
- `KiCad: Compare Variant BOMs`

## Viewer Notes

- Large board files stay interactive up to 10 MB; above that, the viewer falls back to metadata-first behavior.
- The viewer syncs with the active VS Code theme when enabled.
- PCB viewer panels expose layer visibility presets and tuning profile summaries when metadata is available.
- PNG export is generated from the embedded viewer canvas; SVG export uses the extension export command path.

## Import And Export Notes

- Board import helpers currently wrap the `kicad-cli pcb import` formats exposed by the installed KiCad version.
- Current guided import commands target formats such as PADS, Altium, Eagle, CADSTAR, Fabmaster, P-CAD, and SolidWorks PCB.
- If KiCad adds more CLI import formats later, the wrapper layer can extend without changing the rest of the extension architecture.

## Configuration

Important settings include:

- `kicadstudio.kicadCliPath`
- `kicadstudio.kicadPath`
- `kicadstudio.ai.provider`
- `kicadstudio.ai.model`
- `kicadstudio.ai.language`
- `kicadstudio.mcp.autoDetect`
- `kicadstudio.mcp.endpoint`
- `kicadstudio.mcp.pushContext`
- `kicadstudio.viewer.syncThemeWithVscode`
- `kicadstudio.viewer.enableLayerPanel`
- `kicadstudio.viewer.enableSnapshotExport`

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- [docs/INTEGRATION.md](docs/INTEGRATION.md)
- [docs/KICAD10_MIGRATION.md](docs/KICAD10_MIGRATION.md)
- [docs/AI_PROVIDERS.md](docs/AI_PROVIDERS.md)
- [docs/installation.md](docs/installation.md)
- [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md)

## Troubleshooting

### `kicad-cli` not found

- Run `KiCad: Detect kicad-cli`.
- Set `kicadstudio.kicadCliPath` if KiCad lives in a custom location.
- Check [docs/installation.md](docs/installation.md) for per-platform setup notes.

### MCP not connected

- Confirm `kicad-mcp-pro --version` or `uvx kicad-mcp-pro --version` works locally.
- Verify `.vscode/mcp.json` exists in the workspace.
- Check that `kicadstudio.mcp.endpoint` matches your HTTP-mode MCP server when using the context bridge.

### Viewer looks incomplete on KiCad 10 content

- Save the file and refresh the viewer.
- Confirm the bundled KiCanvas build refreshed successfully.
- If a new KiCad 10 entity is not yet rendered upstream, use `Open in KiCad` as the source of truth and file an issue with a fixture.

## Development

### Local Commands

- `npm run lint`
- `npm run test:unit`
- `npm test`
- `npm run build`
- `npm run build:prod`
- `npm run package`

### CI/CD Layout

- `azure-pipelines-ci.yml` is the primary CI definition.
- `azure-pipelines-publish.yml` is the approval-gated Marketplace publish pipeline.
- `.github/workflows/ci.yml` and `.github/workflows/publish.yml` are manual fallback workflows only.

## Contributing

Contribution guidance lives in [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md).

## License

MIT
