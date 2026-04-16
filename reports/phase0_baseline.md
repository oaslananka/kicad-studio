# Phase 0 Baseline

Date: 2026-04-16
Workspace: `c:\Users\Admin\Desktop\files\kicad-studio`

## Commands

### `npm ci`

- Result: success
- Notes: a parallel attempt hit a transient Windows `EPERM` file-lock while unlinking a native module; rerunning serially completed successfully.

### `npm run audit:ci`

- Result: success
- Output summary: `found 0 vulnerabilities`

### `npm run lint`

- Result: success

### `npx tsc -p tsconfig.json --noEmit`

- Result: success

### `npm run test:unit`

- Result: success
- Coverage summary:
  - Statements: `91.27%`
  - Branches: `70.26%`
  - Functions: `93%`
  - Lines: `91.41%`

### `npm run build`

- Result: success
- Output summary:
  - `dist/extension.js`: about `219 KiB`
  - `dist/exceljs.js`: about `971 KiB`

### `npm test`

- Result: success
- Output summary:
  - Unit tests: `194 passed`
  - Integration tests: `0` extension-host failures

### `npm run test:e2e`

- Result: success
- Output summary:
  - Playwright smoke tests: `1 passed`

### `npm run package`

- Result: success
- Output summary:
  - Produced `kicadstudio-2.4.0.vsix`
  - VSIX size: approximately `1.54 MB`

### `npm run check:bundle-size`

- Result: success
- Output summary: all tracked artifacts stayed within the committed `+10%` baseline envelope.

### `Get-ChildItem *.vsix`

- Latest artifact:
  - `kicadstudio-2.4.0.vsix` — approximately `1.54 MB`

## Baseline Verdict

The current repository state is green for lint, type-checking, unit tests, integration tests, E2E smoke tests, packaging, audit, and bundle-size checks.
