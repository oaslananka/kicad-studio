import { createKiCanvasViewerHtml } from '../../src/providers/viewerHtml';

describe('createKiCanvasViewerHtml', () => {
  it('includes hard timeout messaging instead of soft resolve text', () => {
    const html = createKiCanvasViewerHtml({
      title: 'Viewer',
      fileName: 'sample.kicad_sch',
      fileType: 'schematic',
      status: 'Opening interactive renderer...',
      cspSource: 'vscode-resource:',
      kicanvasUri: 'vscode-resource:/media/kicanvas/kicanvas.js',
      base64: 'Zm9v',
      disabledReason: ''
    });

    expect(html).toContain('The file may be empty or the renderer failed silently.');
    expect(html).not.toContain("still resolve — the user can see whatever rendered");
  });

  it('fits to screen before showing the success status', () => {
    const html = createKiCanvasViewerHtml({
      title: 'Viewer',
      fileName: 'sample.kicad_pcb',
      fileType: 'board',
      status: 'Opening interactive renderer...',
      cspSource: 'vscode-resource:',
      kicanvasUri: 'vscode-resource:/media/kicanvas/kicanvas.js',
      base64: 'Zm9v',
      disabledReason: ''
    });

    const successSection = html.slice(html.indexOf('// ── 6. Success'));
    expect(successSection.indexOf('viewer.fitToScreen?.();')).toBeGreaterThan(-1);
    expect(successSection.indexOf('viewer.fitToScreen?.();')).toBeLessThan(
      successSection.indexOf('hideAll();')
    );
    expect(successSection.indexOf('viewer.fitToScreen?.();')).toBeLessThan(
      successSection.indexOf("setStatus('Interactive renderer loaded: ' + payload.fileName);")
    );
  });

  it('includes worker-safe CSP and typed inline sources', () => {
    const html = createKiCanvasViewerHtml({
      title: 'Viewer',
      fileName: 'sample.kicad_sch',
      fileType: 'schematic',
      status: 'Opening interactive renderer...',
      cspSource: 'vscode-resource:',
      kicanvasUri: 'vscode-resource:/media/kicanvas/kicanvas.js',
      base64: 'Zm9v',
      disabledReason: ''
    });

    expect(html).toContain("script-src  'nonce-");
    expect(html).toContain("style-src   'nonce-");
    expect(html).toContain('blob:;');
    expect(html).toContain('worker-src  blob: vscode-resource:;');
    expect(html).not.toContain('unsafe-inline');
    expect(html).not.toContain('unsafe-eval');
    expect(html).toContain('<style nonce="');
    expect(html).toContain("source.setAttribute('name', payload.fileName);");
    expect(html).toContain(
      "source.setAttribute('type', payload.fileType === 'board' ? 'board' : 'schematic');"
    );
  });

  it('normalizes minimal PCB inline text with fallback layer definitions', () => {
    const html = createKiCanvasViewerHtml({
      title: 'Viewer',
      fileName: 'sample.kicad_pcb',
      fileType: 'board',
      status: 'Opening interactive renderer...',
      cspSource: 'vscode-resource:',
      kicanvasUri: 'vscode-resource:/media/kicanvas/kicanvas.js',
      base64: 'Zm9v',
      disabledReason: ''
    });

    expect(html).toContain('const renderText = normalizeKiCanvasText(text, payload.fileType);');
    expect(html).toContain('source.textContent = renderText;');
    expect(html).toContain('function normalizeKiCanvasText(text, fileType)');
    expect(html).toContain('(0 "F.Cu" signal)');
    expect(html).toContain('(31 "B.Cu" signal)');
    expect(html).toContain('(44 "Edge.Cuts" user)');
  });

  it('detects legacy KiCad 5 PCB files before attempting interactive render', () => {
    const html = createKiCanvasViewerHtml({
      title: 'Viewer',
      fileName: 'legacy.kicad_pcb',
      fileType: 'board',
      status: 'Opening interactive renderer...',
      cspSource: 'vscode-resource:',
      kicanvasUri: 'vscode-resource:/media/kicanvas/kicanvas.js',
      base64: 'Zm9v',
      disabledReason: ''
    });

    expect(html).toContain('function isUnsupportedLegacyKiCadPcb(text, fileType)');
    expect(html).toContain('KiCad 5 legacy module format');
    expect(html).toContain('KiCad 5 PCB format is not supported by KiCanvas');
    expect(html).toContain("new RegExp('[(]\\\\s*module\\\\b').test(text)");
  });
});
