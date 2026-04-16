# Migrating From KiCad 9 To KiCad 10

## What Changed

KiCad 10 introduces workflow changes that matter to extension users:

- design variants
- graphical DRC rule files (`.kicad_dru`)
- time-domain tuning metadata
- newer viewer entities such as hop-over display and grouping features
- 3D PDF export support in `kicad-cli`

## Recommended Upgrade Path

1. Update your local KiCad installation to KiCad 10.
2. Re-run `KiCad: Detect kicad-cli` so the extension refreshes CLI capability detection.
3. Open the project in KiCad 10 once and save it before testing in VS Code.
4. Confirm that your `.kicad_pro` contains the expected variant data if you plan to use the Variants sidebar.
5. Add or open any `.kicad_dru` file so KiCad Studio can expose it through the DRC Rules view.

## Extension Features To Verify After Migration

- schematic viewer loads `.kicad_sch`
- PCB viewer shows layer metadata
- DRC/ERC commands still run
- 3D PDF export appears only when KiCad 10 is available
- active design variants can be switched
- tuning profiles are visible in the PCB metadata sidebar

## Known Caveats

- Upstream KiCanvas support for newer KiCad 10 entities may continue to improve over time.
- If an entity renders incompletely in the embedded viewer, use `Open in KiCad` as the source of truth.
- CLI import/export capabilities still depend on the exact `kicad-cli` shipped with the installed KiCad build.
