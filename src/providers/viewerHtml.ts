import * as vscode from 'vscode';
import type { ViewerMetadata, ViewerState } from '../types';


export interface KiCanvasViewerHtmlOptions {
  title: string;
  fileName: string;
  fileType: 'schematic' | 'board';
  status: string;
  cspSource: string;
  kicanvasUri: string;
  base64: string;
  disabledReason: string;
  theme?: string;
  metadata?: ViewerMetadata;
  restoreState?: ViewerState | undefined;
}

/**
 * Build the WebView HTML for a schematic or PCB viewer.
 *
 * Architecture:
 *  1. KiCanvas bundle is loaded via <script src> — this defines the custom elements
 *  2. A second inline script runs AFTER KiCanvas loads and calls initViewer()
 *  3. initViewer() waits for customElements.whenDefined() to resolve, THEN creates
 *     <kicanvas-embed> + <kicanvas-source> and appends them — this guarantees the
 *     custom element constructor runs on freshly-created elements, not on pre-upgrade
 *     generic HTMLElement instances
 *  4. We poll viewer.loaded (the property, not the attribute) to detect render completion
 *
 * This approach deliberately avoids iframes to eliminate cross-origin and srcdoc
 * script-loading edge cases that caused silent blank renders.
 */
export function createKiCanvasViewerHtml(options: KiCanvasViewerHtmlOptions): string {
  const nonce = createNonce();
  const themeName = options.theme ?? 'kicad';
  const palette = resolveViewerPalette(themeName);
  const hasSidebar = Boolean(
    options.metadata?.layers?.length || options.metadata?.tuningProfiles?.length
  );
  const payload: ViewerPayload = {
    fileName:       options.fileName,
    fileType:       options.fileType,
    base64:         options.base64,
    disabledReason: options.disabledReason,
    theme:          themeName,
    ...(options.metadata ? { metadata: options.metadata } : {}),
    ...(options.restoreState ? { restoreState: options.restoreState } : {})
  };

  return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="
    default-src 'none';
    script-src  'nonce-${nonce}' ${options.cspSource} blob:;
    style-src   'unsafe-inline';
    worker-src  blob: ${options.cspSource};
    connect-src 'self' blob: data: ${options.cspSource};
    img-src     ${options.cspSource} data: blob:;
    font-src    ${options.cspSource} data:;
  ">
  <title>${escapeHtml(options.title)}: ${escapeHtml(options.fileName)}</title>
  <style>
    :root {
      color-scheme: ${palette.colorScheme};
      --bg:      ${palette.bg};
      --panel:   ${palette.panel};
      --border:  ${palette.border};
      --text:    ${palette.text};
      --muted:   ${palette.muted};
      --accent:  ${palette.accent};
      --danger:  ${palette.danger};
      --green:   ${palette.green};
      --viewer-card-bg: ${palette.card};
    }
    *, *::before, *::after { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; height: 100%; overflow: hidden; }
    body {
      display: grid;
      grid-template-rows: auto minmax(0, 1fr);
      height: 100vh;
      background: var(--bg);
      color: var(--text);
      font: 13px/1.5 "Segoe UI", system-ui, sans-serif;
    }

    /* ── Header ── */
    header {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 14px;
      background: #071225;
      border-bottom: 1px solid rgba(56,189,248,.3);
      box-shadow: 0 6px 18px rgba(2,6,23,.35);
      z-index: 10;
      min-width: 0;
    }
    header h1 {
      margin: 0;
      font-size: 13px;
      font-weight: 650;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      flex: 1 1 0;
      min-width: 0;
    }
    .actions { display: flex; gap: 8px; flex: 0 0 auto; }
    .btn {
      border: 1px solid rgba(125,211,252,.9);
      background: linear-gradient(180deg,#0891b2,#0e7490);
      color: #fff;
      border-radius: 8px;
      padding: 5px 11px;
      cursor: pointer;
      font-weight: 700;
      font-size: 12px;
    }
    .btn:hover { background: linear-gradient(180deg,#06b6d4,#0e7490); }
    .btn:focus-visible { outline: 2px solid #bae6fd; outline-offset: 2px; }
    #viewer-status {
      flex: 0 1 auto;
      color: var(--muted);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      font-size: 12px;
    }

    /* ── Main ── */
    main {
      position: relative;
      overflow: hidden;
      background: var(--bg);
      min-width: 0;
      min-height: 0;
      display: grid;
      grid-template-columns: minmax(0, 1fr) ${hasSidebar ? '320px' : '0'};
    }

    /* ── KiCanvas mount (fills main) ── */
    #viewer-mount {
      position: absolute;
      inset: 0 ${hasSidebar ? '320px' : '0'} 0 0;
      display: flex;
    }
    kicanvas-embed {
      display: block !important;
      flex: 1 !important;
      width: 100% !important;
      height: 100% !important;
      min-width: 0 !important;
      min-height: 0 !important;
      max-width: none !important;
      max-height: none !important;
      aspect-ratio: auto !important;
      contain: strict !important;
    }

    aside {
      position: relative;
      z-index: 4;
      border-left: 1px solid var(--border);
      background: linear-gradient(180deg, rgba(2, 6, 23, 0.86), rgba(15, 23, 42, 0.94));
      overflow-y: auto;
      padding: 14px;
      display: ${hasSidebar ? 'block' : 'none'};
    }
    .side-section {
      border: 1px solid var(--border);
      background: var(--viewer-card-bg);
      border-radius: 14px;
      padding: 12px;
      margin-bottom: 12px;
    }
    .side-section h2 {
      margin: 0 0 10px;
      font-size: 12px;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--muted);
    }
    .meta-list {
      display: grid;
      gap: 8px;
    }
    .meta-row {
      padding: 8px 10px;
      border-radius: 10px;
      border: 1px solid var(--border);
      background: rgba(15, 23, 42, 0.44);
    }
    .meta-row strong {
      display: block;
      margin-bottom: 4px;
      font-size: 12px;
    }
    .layer-list {
      display: grid;
      gap: 6px;
    }
    .layer-row {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
      color: var(--text);
    }
    .side-actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin-bottom: 10px;
    }

    /* ── Overlays ── */
    .overlay {
      position: absolute;
      inset: 0;
      display: grid;
      place-items: center;
      padding: 28px;
      z-index: 5;
    }
    .card {
      width: min(640px, calc(100vw - 48px));
      border: 1px solid var(--border);
      border-radius: 18px;
      background: var(--panel);
      box-shadow: 0 24px 70px rgba(0,0,0,.4);
      padding: 22px;
    }
    .card h2 { margin: 0 0 10px; font-size: 17px; }
    .card p  { margin: 0 0 10px; color: var(--muted); }
    .card .actions { margin-top: 14px; }

    /* Loading spinner */
    #loading-overlay { background: rgba(2,6,23,.82); }
    #loading-card { width: min(380px, calc(100vw - 48px)); text-align: center; }
    .spinner {
      width: 36px; height: 36px;
      margin: 0 auto 14px;
      border: 3px solid rgba(148,163,184,.3);
      border-top-color: var(--accent);
      border-radius: 50%;
      animation: spin .75s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    #loading-detail { color: var(--muted); font-size: 12px; margin-top: 6px; }

    /* Error */
    #error-overlay { background: rgba(2,6,23,.88); }
    .error-title { color: var(--danger); font-weight: 700; margin: 0 0 8px; }
    pre.error-detail {
      margin: 12px 0 0;
      max-height: 200px;
      overflow: auto;
      padding: 12px;
      border-radius: 10px;
      border: 1px solid var(--border);
      background: #020617;
      color: #dbeafe;
      font: 12px/1.5 Consolas, "Cascadia Code", monospace;
      white-space: pre-wrap;
      word-break: break-word;
    }

    /* Empty */
    #empty-overlay { background: rgba(2,6,23,.72); }

    [hidden] { display: none !important; }

    /* Source preview (for diagnostics) */
    #safe-preview {
      margin: 14px 0 0;
      max-height: 180px;
      overflow: auto;
      padding: 10px 12px;
      border-radius: 10px;
      border: 1px solid var(--border);
      background: #020617;
      color: #94a3b8;
      font: 11px/1.5 Consolas, "Cascadia Code", monospace;
      white-space: pre-wrap;
      word-break: break-word;
    }
  </style>
</head>
<body>
  <header>
    <h1>${escapeHtml(options.title)}: ${escapeHtml(options.fileName)}</h1>
    <div class="actions">
      <button class="btn" id="reload-btn"    type="button" aria-label="Reload viewer">Reload Viewer</button>
      <button class="btn" id="open-kicad-btn" type="button" aria-label="Open in KiCad">Open in KiCad</button>
      <button class="btn" id="export-png-btn" type="button" aria-label="Export PNG">Export PNG</button>
      <button class="btn" id="export-svg-btn" type="button" aria-label="Export SVG">Export SVG</button>
    </div>
    <span id="viewer-status">${escapeHtml(options.status)}</span>
  </header>

  <main>
    <!-- KiCanvas will be mounted here programmatically -->
    <div id="viewer-mount"></div>

    <!-- Loading overlay (shown while KiCanvas initializes) -->
    <div id="loading-overlay" class="overlay" role="status" aria-label="Loading file...">
      <div id="loading-card" class="card" style="text-align:center">
        <div class="spinner" aria-hidden="true"></div>
        <strong>Loading KiCanvas renderer…</strong>
        <div id="loading-detail">Preparing ${escapeHtml(options.fileType === 'board' ? 'PCB' : 'schematic')} viewer…</div>
      </div>
    </div>

    <!-- Error overlay -->
    <div id="error-overlay" class="overlay" hidden>
      <div class="card">
        <p class="error-title" id="error-title">Viewer error</p>
        <p id="error-message">An unexpected error occurred.</p>
        <p>Try clicking <strong>Reload Viewer</strong>. If the problem persists, open the file in KiCad directly.</p>
        <div class="actions">
          <button class="btn" id="error-reload-btn" type="button">Reload Viewer</button>
          <button class="btn" id="error-open-btn"   type="button">Open in KiCad</button>
        </div>
        <pre class="error-detail" id="error-detail" aria-label="Error detail"></pre>
      </div>
    </div>

    <!-- Empty file overlay -->
    <div id="empty-overlay" class="overlay" hidden>
      <div class="card">
        <h2 id="empty-title">No drawable objects yet</h2>
        <p>
          ${options.fileType === 'board'
            ? 'This PCB file does not contain any footprints, tracks, zones, or graphics that KiCanvas can render.'
            : 'This schematic file does not contain any symbols, wires, labels, or other drawable objects yet.'}
        </p>
        <p>Add components in KiCad, save the file, and the viewer will refresh automatically.</p>
        <div id="safe-preview" aria-label="File source preview (first 3000 chars)"></div>
      </div>
    </div>

    <aside aria-label="Viewer side panel">
      <div class="side-section">
        <h2>Viewer Tools</h2>
        <div class="side-actions">
          <button class="btn" id="fit-btn" type="button">Fit</button>
          <button class="btn" id="all-layers-btn" type="button">All</button>
          <button class="btn" id="none-layers-btn" type="button">None</button>
          <button class="btn" id="copper-layers-btn" type="button">Copper Only</button>
        </div>
        <div id="selection-summary" class="meta-row">No lasso area selected.</div>
      </div>
      <div class="side-section" id="layers-section" hidden>
        <h2>Layer Visibility</h2>
        <div id="layer-list" class="layer-list"></div>
      </div>
      <div class="side-section" id="tuning-section" hidden>
        <h2>Tuning Profiles</h2>
        <div id="tuning-list" class="meta-list"></div>
      </div>
    </aside>
  </main>

  <!-- Payload embedded in HTML so it's available before postMessage -->
  <script id="viewer-payload" nonce="${nonce}" type="application/json">${escapeScriptJson(payload)}</script>

  <!--
    IMPORTANT: KiCanvas script is loaded FIRST.
    The init script below runs AFTER KiCanvas has loaded and defined its custom
    elements.  Creating kicanvas-embed / kicanvas-source BEFORE the definitions
    are registered results in generic HTMLElement instances that are never
    properly upgraded, causing a silent blank render.
  -->
  <script src="${escapeAttr(options.kicanvasUri)}" nonce="${nonce}"></script>

  <script nonce="${nonce}">
  (function () {
    'use strict';

    const vscode = acquireVsCodeApi();

    // ── DOM refs ─────────────────────────────────────────────────────────────
    const statusEl       = document.getElementById('viewer-status');
    const loadingEl      = document.getElementById('loading-overlay');
    const loadingDetail  = document.getElementById('loading-detail');
    const errorEl        = document.getElementById('error-overlay');
    const errorTitle     = document.getElementById('error-title');
    const errorMessage   = document.getElementById('error-message');
    const errorDetail    = document.getElementById('error-detail');
    const emptyEl        = document.getElementById('empty-overlay');
    const emptyTitleEl   = document.getElementById('empty-title');
    const safePreviewEl  = document.getElementById('safe-preview');
    const viewerMount    = document.getElementById('viewer-mount');
    const layerListEl    = document.getElementById('layer-list');
    const layersSection  = document.getElementById('layers-section');
    const tuningListEl   = document.getElementById('tuning-list');
    const tuningSection  = document.getElementById('tuning-section');
    const selectionSummaryEl = document.getElementById('selection-summary');

    // ── Payload ───────────────────────────────────────────────────────────────
    const payload = JSON.parse(
      document.getElementById('viewer-payload').textContent || '{}'
    );
    let keydownHandler = null;
    let localState = payload.restoreState || {
      zoom: 1,
      grid: false,
      theme: payload.theme || 'kicad'
    };

    // ── Button wiring ─────────────────────────────────────────────────────────
    document.getElementById('reload-btn').addEventListener('click', () => initViewer());
    document.getElementById('open-kicad-btn').addEventListener('click', openInKiCad);
    document.getElementById('error-reload-btn').addEventListener('click', () => initViewer());
    document.getElementById('error-open-btn').addEventListener('click', openInKiCad);
    document.getElementById('export-png-btn').addEventListener('click', exportPng);
    document.getElementById('export-svg-btn').addEventListener('click', exportSvg);
    document.getElementById('fit-btn').addEventListener('click', () => {
      const viewer = viewerMount.querySelector('kicanvas-embed');
      viewer?.fitToScreen?.();
      localState = { ...localState, zoom: 1 };
      postViewerState();
    });
    document.getElementById('all-layers-btn').addEventListener('click', () => setAllLayers(true));
    document.getElementById('none-layers-btn').addEventListener('click', () => setAllLayers(false));
    document.getElementById('copper-layers-btn').addEventListener('click', () => setCopperOnly());
    renderSidebar();

    // ── VS Code → WebView messages ────────────────────────────────────────────
    window.addEventListener('message', (event) => {
      const msg = event.data || {};
      if (msg.type === 'load' || msg.type === 'refresh') {
        // Extension re-sent fresh payload (e.g. file saved)
        if (msg.payload && msg.payload.base64 !== undefined) {
          payload.base64         = msg.payload.base64;
          payload.disabledReason = msg.payload.disabledReason || '';
          payload.fileName       = msg.payload.fileName || payload.fileName;
          payload.theme          = msg.payload.theme || payload.theme;
          payload.restoreState   = msg.payload.restoreState || payload.restoreState;
          localState             = payload.restoreState || localState;
        }
        void initViewer();
      }
      if (msg.type === 'setTheme') {
        payload.theme = msg.payload?.theme || payload.theme;
        payload.restoreState = msg.payload?.restoreState || payload.restoreState;
        localState = payload.restoreState || localState;
        void initViewer();
      }
      if (msg.type === 'setMetadata') {
        payload.metadata = msg.payload || payload.metadata;
        renderSidebar();
      }
    });

    // ── Global error guard ────────────────────────────────────────────────────
    window.addEventListener('error', (ev) => {
      showError('Script error', ev.message || 'Unknown error', '');
    });
    window.addEventListener('unhandledrejection', (ev) => {
      const reason = ev.reason instanceof Error ? ev.reason.message : String(ev.reason || 'Unknown');
      showError('Runtime error', reason, '');
    });

    // ── Entry point ───────────────────────────────────────────────────────────
    void initViewer();

    // ─────────────────────────────────────────────────────────────────────────
    async function initViewer() {
      clearKeyboardShortcuts();
      hideAll();
      showLoading('Waiting for KiCanvas…');

      try {
        if (payload.disabledReason) {
          showEmpty(payload.disabledReason, '');
          return;
        }

        if (!payload.base64) {
          showError(
            'No file data',
            'The file content was not embedded in the viewer payload.',
            'This usually means the file is too large for inline rendering.'
          );
          return;
        }

        // ── 1. Decode ─────────────────────────────────────────────────────────
        let text;
        try {
          text = decodeBase64Utf8(payload.base64);
        } catch (err) {
          showError('Decode error', String(err), 'Could not decode the base64 file payload.');
          return;
        }

        if (isUnsupportedLegacyKiCadPcb(text, payload.fileType)) {
          showEmpty(
            'This PCB uses KiCad 5 legacy module format. KiCanvas may render tracks but cannot reliably render legacy footprints and pads. Open the board in KiCad 6 or newer, save it once to convert the file, then reopen it here.',
            text.slice(0, 3000),
            'KiCad 5 PCB format is not supported by KiCanvas'
          );
          return;
        }

        // ── 2. Check drawable ────────────────────────────────────────────────
        if (!hasDrawableObjects(text, payload.fileType)) {
          showEmpty(
            payload.fileType === 'board'
              ? 'This PCB does not contain any drawable objects yet (no footprints, tracks, or graphics).'
              : 'This schematic does not contain any drawable objects yet (no symbols or wires).',
            text.slice(0, 3000)
          );
          return;
        }

        // ── 3. Wait for KiCanvas custom element definitions ──────────────────
        //
        // This is the critical step. If we create <kicanvas-embed> before
        // customElements.define() registers it, the element is just a plain
        // HTMLElement and KiCanvas never processes its children, resulting in a
        // blank white canvas.
        //
        showLoading('Waiting for KiCanvas element definitions…');
        await waitForDefinition('kicanvas-embed', 8000);
        await waitForDefinition('kicanvas-source', 8000);

        // ── 4. Build viewer elements ─────────────────────────────────────────
        showLoading('Mounting viewer…');
        const renderText = normalizeKiCanvasText(text, payload.fileType);

        const viewer = document.createElement('kicanvas-embed');
        viewer.setAttribute('controls',     'basic');
        viewer.setAttribute('controlslist', 'nodownload nooverlay nofullscreen noflipview');
        viewer.setAttribute('theme',        payload.theme || 'kicad');

        const source = document.createElement('kicanvas-source');
        source.setAttribute('name', payload.fileName);
        source.setAttribute('type', payload.fileType === 'board' ? 'board' : 'schematic');
        source.textContent = renderText;

        viewer.appendChild(source);
        viewerMount.replaceChildren(viewer);

        // ── 5. Wait for render ────────────────────────────────────────────────
        showLoading('Rendering ' + escapeHtml(payload.fileName) + '…');
        await waitForViewerLoaded(viewer, 15000);

        // ── 6. Success ────────────────────────────────────────────────────────
        viewer.fitToScreen?.();
        applyLayerVisibility(viewer);
        applyViewerState(viewer);
        installSelectionTracking(viewer);
        hideAll();
        installKeyboardShortcuts(viewer);
        setStatus('Interactive renderer loaded: ' + payload.fileName);
        vscode.postMessage({ type: 'ready', payload: { fileName: payload.fileName } });

      } catch (err) {
        const message = err instanceof Error ? err.message : String(err || 'Unknown error');
        showError('Viewer failed to load', message, '');
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────────────────────────────────

    function waitForDefinition(tagName, timeoutMs) {
      return Promise.race([
        customElements.whenDefined(tagName),
        new Promise((_, reject) =>
          window.setTimeout(
            () => reject(new Error(
              'KiCanvas custom element "' + tagName + '" was not registered within ' +
              (timeoutMs / 1000) + 's. ' +
              'The kicanvas.js bundle may not have loaded correctly — check the browser console.'
            )),
            timeoutMs
          )
        )
      ]);
    }

    function waitForViewerLoaded(viewer, timeoutMs) {
      return new Promise((resolve, reject) => {
        // Immediate check
        if (viewer.loaded === true || viewer.getAttribute('loaded') !== null) {
          resolve(undefined);
          return;
        }

        const deadline = window.setTimeout(() => {
          clearInterval(poll);
          reject(new Error(
            'KiCanvas did not finish rendering "' + payload.fileName + '" within ' +
            (timeoutMs / 1000) + 's. The file may be empty or the renderer failed silently.'
          ));
        }, timeoutMs);

        // Poll both the property and the attribute (different KiCanvas versions
        // use different mechanisms)
        const poll = window.setInterval(() => {
          if (viewer.loaded === true || viewer.getAttribute('loaded') !== null) {
            window.clearInterval(poll);
            window.clearTimeout(deadline);
            resolve(undefined);
          }
        }, 120);
      });
    }

    function hasDrawableObjects(text, fileType) {
      // RegExp constructor used here instead of regex literals.
      // ESLint no-useless-escape fires on backslash sequences inside
      // TypeScript template literals even when they are valid regex syntax.
      if (fileType === 'board') {
        return new RegExp(
          '[(]\\\\s*(?:footprint|segment|via|zone|gr_line|gr_arc|gr_circle|gr_rect|gr_poly|gr_curve|gr_text|dimension|target|rule_area|board_stackup|stackup|embedded_fonts)\\\\b'
        ).test(text);
      }
      return (
        new RegExp(
          '[(]\\\\s*(?:symbol|wire|junction|no_connect|label|global_label|hierarchical_label|sheet|bus|bus_entry|polyline|rectangle|circle|arc|text|image|netclass_flag|directive_label)\\\\b'
        ).test(text) ||
        new RegExp('[(]\\\\s*lib_symbols\\\\b[\\\\s\\\\S]*?[(]\\\\s*symbol\\\\b').test(text)
      );
    }

    function isUnsupportedLegacyKiCadPcb(text, fileType) {
      if (fileType !== 'board') return false;

      const versionMatch = text.match(new RegExp('[(]\\\\s*kicad_pcb\\\\s+[(]\\\\s*version\\\\s+(\\\\d+)'));
      const version = versionMatch ? Number(versionMatch[1]) : 0;

      return version < 20210000 && new RegExp('[(]\\\\s*module\\\\b').test(text);
    }

    function normalizeKiCanvasText(text, fileType) {
      if (fileType !== 'board' || new RegExp('[(]\\\\s*layers\\\\b').test(text)) return text;

      // Some generated/minimal PCB files omit the layer table. KiCanvas expects
      // at least the standard board layers to exist when building UI visibility
      // controls, so provide them only in the inline render copy.
      const fallbackLayers = [
        '  (layers',
        '    (0 "F.Cu" signal)',
        '    (31 "B.Cu" signal)',
        '    (32 "B.Adhes" user "B.Adhesive")',
        '    (33 "F.Adhes" user "F.Adhesive")',
        '    (34 "B.Paste" user)',
        '    (35 "F.Paste" user)',
        '    (36 "B.SilkS" user "B.Silkscreen")',
        '    (37 "F.SilkS" user "F.Silkscreen")',
        '    (38 "B.Mask" user)',
        '    (39 "F.Mask" user)',
        '    (40 "Dwgs.User" user "User.Drawings")',
        '    (41 "Cmts.User" user "User.Comments")',
        '    (42 "Eco1.User" user "User.Eco1")',
        '    (43 "Eco2.User" user "User.Eco2")',
        '    (44 "Edge.Cuts" user)',
        '    (45 "Margin" user)',
        '    (46 "B.CrtYd" user "B.Courtyard")',
        '    (47 "F.CrtYd" user "F.Courtyard")',
        '    (48 "B.Fab" user)',
        '    (49 "F.Fab" user)',
        '    (50 "User.1" user)',
        '    (51 "User.2" user)',
        '    (52 "User.3" user)',
        '    (53 "User.4" user)',
        '    (54 "User.5" user)',
        '    (55 "User.6" user)',
        '    (56 "User.7" user)',
        '    (57 "User.8" user)',
        '    (58 "User.9" user)',
        '  )'
      ].join('\\n');

      return text.replace(
        new RegExp('^\\\\s*[(]\\\\s*kicad_pcb\\\\b'),
        '(kicad_pcb\\n' + fallbackLayers
      );
    }

    function decodeBase64Utf8(value) {
      const binary = atob(value);
      const bytes  = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return new TextDecoder().decode(bytes);
    }

    function escapeHtml(value) {
      return String(value)
        .replace(/&/g,  '&amp;')
        .replace(/</g,  '&lt;')
        .replace(/>/g,  '&gt;')
        .replace(/"/g,  '&quot;')
        .replace(/'/g,  '&#39;');
    }

    function openInKiCad() {
      vscode.postMessage({ type: 'openInKiCad', payload: { selectedArea: localState.selectedArea } });
    }

    function postViewerState() {
      vscode.postMessage({
        type: 'viewerState',
        payload: localState
      });
    }

    function applyViewerState(viewer) {
      if (!payload.restoreState) {
        postViewerState();
        return;
      }
      viewer.setAttribute('theme', payload.restoreState.theme || payload.theme || 'kicad');
      localState = payload.restoreState;
      updateSelectionSummary();
      postViewerState();
    }

    function renderSidebar() {
      const layers = payload.metadata?.layers || [];
      const tuningProfiles = payload.metadata?.tuningProfiles || [];

      layersSection.hidden = layers.length === 0;
      tuningSection.hidden = tuningProfiles.length === 0;
      layerListEl.innerHTML = '';
      tuningListEl.innerHTML = '';

      if (!localState.activeLayers && layers.length) {
        localState.activeLayers = layers.filter((layer) => layer.visible !== false).map((layer) => layer.name);
      }

      for (const layer of layers) {
        const row = document.createElement('label');
        row.className = 'layer-row';
        const checked = (localState.activeLayers || []).includes(layer.name);
        row.innerHTML = '<input type="checkbox"' + (checked ? ' checked' : '') + '> <span></span>';
        row.querySelector('span').textContent = layer.name + (layer.kind ? ' (' + layer.kind + ')' : '');
        row.querySelector('input').addEventListener('change', (event) => {
          const nextChecked = Boolean(event.target.checked);
          const activeLayers = new Set(localState.activeLayers || []);
          if (nextChecked) {
            activeLayers.add(layer.name);
          } else {
            activeLayers.delete(layer.name);
          }
          localState = { ...localState, activeLayers: [...activeLayers] };
          postViewerState();
          applyLayerVisibility(viewerMount.querySelector('kicanvas-embed'));
        });
        layerListEl.appendChild(row);
      }

      for (const profile of tuningProfiles) {
        const row = document.createElement('div');
        row.className = 'meta-row';
        row.innerHTML = '<strong></strong><div></div>';
        row.querySelector('strong').textContent = profile.name || 'Tuning profile';
        row.querySelector('div').textContent = [
          profile.layer ? 'Layer: ' + profile.layer : '',
          profile.impedance ? 'Impedance: ' + profile.impedance : '',
          profile.propagationSpeed ? 'Propagation: ' + profile.propagationSpeed : ''
        ].filter(Boolean).join(' · ') || (profile.raw || '');
        tuningListEl.appendChild(row);
      }

      updateSelectionSummary();
    }

    function applyLayerVisibility(viewer) {
      if (!viewer || !Array.isArray(localState.activeLayers)) {
        return;
      }

      try {
        viewer.setAttribute('layers', localState.activeLayers.join(','));
      } catch {}

      try {
        const internalViewer = viewer.viewer;
        const layerSet = internalViewer?.layers;
        if (!layerSet?.in_order) {
          return;
        }
        for (const layer of Array.from(layerSet.in_order())) {
          layer.visible = localState.activeLayers.includes(layer.name);
        }
        internalViewer.draw?.();
      } catch {}
    }

    function setAllLayers(visible) {
      const layers = payload.metadata?.layers || [];
      localState = {
        ...localState,
        activeLayers: visible ? layers.map((layer) => layer.name) : []
      };
      renderSidebar();
      postViewerState();
      applyLayerVisibility(viewerMount.querySelector('kicanvas-embed'));
    }

    function setCopperOnly() {
      const layers = payload.metadata?.layers || [];
      localState = {
        ...localState,
        activeLayers: layers
          .filter((layer) => /\\.Cu$/i.test(layer.name))
          .map((layer) => layer.name)
      };
      renderSidebar();
      postViewerState();
      applyLayerVisibility(viewerMount.querySelector('kicanvas-embed'));
    }

    function installSelectionTracking(viewer) {
      let dragStart = null;
      viewer.addEventListener('pointerdown', (event) => {
        dragStart = { x: event.clientX, y: event.clientY };
      });
      viewer.addEventListener('pointerup', (event) => {
        if (!dragStart) {
          return;
        }
        const dx = Math.abs(event.clientX - dragStart.x);
        const dy = Math.abs(event.clientY - dragStart.y);
        if (dx < 4 && dy < 4) {
          dragStart = null;
          return;
        }
        localState = {
          ...localState,
          selectedArea: {
            x1: dragStart.x,
            y1: dragStart.y,
            x2: event.clientX,
            y2: event.clientY
          }
        };
        updateSelectionSummary();
        vscode.postMessage({
          type: 'selectionChanged',
          payload: {
            selectedArea: localState.selectedArea
          }
        });
        dragStart = null;
      });
      viewer.addEventListener('dblclick', () => {
        localState = {
          ...localState,
          selectedArea: undefined
        };
        updateSelectionSummary();
        vscode.postMessage({
          type: 'selectionChanged',
          payload: {
            selectedArea: undefined
          }
        });
      });
    }

    function updateSelectionSummary() {
      if (!localState.selectedArea) {
        selectionSummaryEl.textContent = 'No lasso area selected.';
        return;
      }
      const area = localState.selectedArea;
      selectionSummaryEl.textContent =
        'Selected area: (' + area.x1 + ', ' + area.y1 + ') → (' + area.x2 + ', ' + area.y2 + ')';
    }

    function exportPng() {
      const canvas = viewerMount.querySelector('canvas');
      if (!canvas) {
        showError('Export failed', 'No rendered canvas is available for PNG export.', '');
        return;
      }
      const dataUrl = canvas.toDataURL('image/png');
      vscode.postMessage({ type: 'exportPng', payload: { dataUrl } });
    }

    function exportSvg() {
      vscode.postMessage({ type: 'exportSvg' });
    }

    // ── State helpers ─────────────────────────────────────────────────────────

    function hideAll() {
      loadingEl.hidden = true;
      errorEl.hidden   = true;
      emptyEl.hidden   = true;
    }

    function showLoading(detail) {
      hideAll();
      loadingEl.hidden       = false;
      loadingDetail.textContent = detail || '';
      setStatus(detail || 'Loading…');
    }

    function showError(title, message, detail) {
      hideAll();
      errorEl.hidden          = false;
      errorTitle.textContent  = title   || 'Viewer error';
      errorMessage.textContent = message || 'An unexpected error occurred.';
      errorDetail.textContent  = detail  || '';
      setStatus('⚠ ' + (title || 'Error'));
    }

    function showEmpty(message, preview, title) {
      hideAll();
      emptyEl.hidden = false;
      if (emptyTitleEl) emptyTitleEl.textContent = title || 'No drawable objects yet';
      if (safePreviewEl) {
        safePreviewEl.textContent = preview || '';
        safePreviewEl.hidden = !preview;
      }
      setStatus(title || 'No drawable objects');
    }

    function setStatus(text) {
      statusEl.textContent = text || '';
    }

    function clearKeyboardShortcuts() {
      if (keydownHandler) {
        window.removeEventListener('keydown', keydownHandler);
        keydownHandler = null;
      }
    }

    function installKeyboardShortcuts(viewer) {
      clearKeyboardShortcuts();
      keydownHandler = (ev) => {
        if (ev.key === 'f' || ev.key === 'F') {
          viewer.fitToScreen?.();
          localState = { ...localState, zoom: 1 };
          postViewerState();
        }
        if (ev.key === '+' || ev.key === '=') {
          viewer.zoomIn?.();
          localState = { ...localState, zoom: Number((localState.zoom + 0.1).toFixed(2)) };
          postViewerState();
        }
        if (ev.key === '-') {
          viewer.zoomOut?.();
          localState = { ...localState, zoom: Number(Math.max(0.1, localState.zoom - 0.1).toFixed(2)) };
          postViewerState();
        }
        if (ev.key === 'r' || ev.key === 'R') {
          vscode.postMessage({ type: 'requestRefresh' });
        }
      };
      window.addEventListener('keydown', keydownHandler);
    }
  })();
  </script>
</body>
</html>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Error page
// ─────────────────────────────────────────────────────────────────────────────

export function createViewerErrorHtml(fileName: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body  { margin: 0; padding: 24px; background: #0f172a; color: #e2e8f0; font: 13px/1.6 "Segoe UI", sans-serif; }
    .card { max-width: 860px; margin: 0 auto; padding: 22px; border-radius: 16px; background: #111827; border: 1px solid rgba(148,163,184,.22); }
    h1    { margin-top: 0; font-size: 17px; }
    pre   { white-space: pre-wrap; word-break: break-word; background: #020617; padding: 12px; border-radius: 10px; border: 1px solid rgba(148,163,184,.18); }
  </style>
</head>
<body>
  <div class="card">
    <h1>KiCad Studio — Could not open ${escapeHtml(fileName)}</h1>
    <p><strong>What happened:</strong> the viewer failed while preparing the custom editor.</p>
    <p><strong>How to fix:</strong> reload the window and reopen the file. If the error persists, this message will help diagnose the issue quickly.</p>
    <pre>${escapeHtml(message)}</pre>
  </div>
</body>
</html>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

interface ViewerPayload {
  fileName:       string;
  fileType:       string;
  base64:         string;
  disabledReason: string;
  theme:          string;
  metadata?:      ViewerMetadata | undefined;
  restoreState?: ViewerState | undefined;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&#39;');
}

/** Escape a value for use as an HTML attribute (inside double-quotes). */
function escapeAttr(value: string): string {
  return value.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * JSON-encode a value and escape characters that could break out of a
 * <script> block.
 */
function escapeScriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g,  '\\u003c')
    .replace(/>/g,  '\\u003e')
    .replace(/&/g,  '\\u0026')
    .replace(/\//g, '\\u002f');
}

function createNonce(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let value = '';
  for (let i = 0; i < 32; i++) value += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  return value;
}

function resolveViewerPalette(theme: string): {
  colorScheme: 'dark' | 'light';
  bg: string;
  panel: string;
  card: string;
  border: string;
  text: string;
  muted: string;
  accent: string;
  danger: string;
  green: string;
} {
  if (theme === 'light') {
    return {
      colorScheme: 'light',
      bg: '#f8fafc',
      panel: 'rgba(255,255,255,0.92)',
      card: 'rgba(255,255,255,0.78)',
      border: 'rgba(15,23,42,0.12)',
      text: '#0f172a',
      muted: '#475569',
      accent: '#0369a1',
      danger: '#dc2626',
      green: '#15803d'
    };
  }

  return {
    colorScheme: 'dark',
    bg: '#050816',
    panel: 'rgba(15,23,42,.94)',
    card: 'rgba(15,23,42,.72)',
    border: 'rgba(148,163,184,.22)',
    text: '#e2e8f0',
    muted: '#94a3b8',
    accent: '#38bdf8',
    danger: '#fca5a5',
    green: '#86efac'
  };
}

export function kicanvasUri(context: vscode.ExtensionContext, webview: vscode.Webview): string {
  return webview
    .asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'kicanvas', 'kicanvas.js'))
    .toString();
}
