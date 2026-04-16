# Phase 7 Summary

## What changed

- Retained KiCad 10 native variant parsing with sidecar fallback support.
- Added helper APIs for listing variants and resolving variants by name so LM tools and export/viewer integrations can share the same source of truth.

## Files touched

- `src/variants/variantProvider.ts`
- `src/types.ts`
- `test/unit/variantProvider.test.ts`

## Tests added

- Unit coverage for variant helper APIs and KiCad 10/legacy shapes.

## Coverage delta

- `src/variants/variantProvider.ts` reports `86.45%` statement coverage in the final unit run.

## New risks

- Graphical variant diff behavior still needs live fixture review in a real VS Code session before marketplace screenshots are refreshed.
