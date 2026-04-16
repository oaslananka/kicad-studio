# Phase 18 Summary

## What changed

- Replaced the static bundle-size gate with a baseline-driven size check.
- Added `scripts/bundle-size-baseline.json`.
- Added dependency-audit steps to Azure CI and publish pipelines.
- Added optional Open VSX publish parameter to the Azure publish pipeline.
- Bumped release packaging to `2.4.0`.

## Files touched

- `scripts/check-bundle-size.js`
- `scripts/bundle-size-baseline.json`
- `azure-pipelines-ci.yml`
- `azure-pipelines-publish.yml`
- `package.json`

## Tests added

- No dedicated automated tests were added for pipeline YAML changes.

## Coverage delta

- Not applicable for pipeline-only changes.

## New risks

- Open VSX publishing now assumes `OVSX_PAT` is available when the optional pipeline parameter is enabled.
