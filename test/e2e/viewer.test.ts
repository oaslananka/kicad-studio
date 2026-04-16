import { test } from '@playwright/test';

test.describe.skip('KiCad Studio VS Code E2E', () => {
  test('opens a KiCad schematic viewer inside the VS Code extension host', async () => {
    // Placeholder scaffold for the future VS Code + Playwright harness.
    // Intended checks:
    // - schematic viewer loads without webview errors
    // - PCB viewer renders the side metadata panel
    // - BOM view opens and lists parsed symbols
    // - AI chat panel can hydrate and show context
  });
});
