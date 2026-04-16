import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { SchematicEditorProvider } from '../../src/providers/schematicEditorProvider';
import { PcbEditorProvider } from '../../src/providers/pcbEditorProvider';
import { __setConfiguration, workspace } from './vscodeMock';

type ProviderCtor = new (context: vscode.ExtensionContext) => {
  resolveCustomEditor(document: vscode.CustomDocument, webviewPanel: vscode.WebviewPanel): Promise<void>;
  dispose(): void;
};

function createPanel() {
  const webview = {
    html: '',
    cspSource: 'vscode-resource:',
    options: undefined,
    postMessage: jest.fn().mockResolvedValue(true),
    onDidReceiveMessage: jest.fn(() => ({ dispose: jest.fn() })),
    asWebviewUri: jest.fn((value) => value)
  };

  let disposeCallback: (() => void) | undefined;
  let viewStateCallback: ((event: { webviewPanel: unknown }) => void) | undefined;
  const panel = {
    webview,
    onDidDispose: jest.fn((callback: () => void) => {
      disposeCallback = callback;
      return { dispose: jest.fn() };
    }),
    onDidChangeViewState: jest.fn((callback: (event: { webviewPanel: unknown }) => void) => {
      viewStateCallback = callback;
      return { dispose: jest.fn() };
    }),
    visible: true,
    reveal: jest.fn(),
    fireViewState: () => viewStateCallback?.({ webviewPanel: panel }),
    fireDispose: () => disposeCallback?.()
  };

  return panel;
}

describe.each([
  ['schematic', SchematicEditorProvider, '.kicad_sch', '(kicad_sch (symbol "R1"))'],
  ['pcb', PcbEditorProvider, '.kicad_pcb', '(kicad_pcb (footprint "R1"))']
])('%s viewer provider', (_label, Provider, extension, sourceText) => {
  const ContextProvider = Provider as ProviderCtor;
  let tempFile: string;

  beforeEach(() => {
    __setConfiguration({
      'kicadstudio.viewer.autoRefresh': true
    });
    tempFile = path.join(os.tmpdir(), `kicadstudio-${Date.now()}${extension}`);
    fs.writeFileSync(tempFile, sourceText, 'utf8');
    (workspace.fs.readFile as jest.Mock).mockReset();
    (workspace.fs.readFile as jest.Mock).mockResolvedValue(Buffer.from(sourceText, 'utf8'));
    (workspace.onDidSaveTextDocument as jest.Mock).mockClear();
  });

  afterEach(() => {
    fs.rmSync(tempFile, { force: true });
  });

  it('writes HTML on initial load', async () => {
    const provider = new ContextProvider({
      extensionUri: vscode.Uri.file('/extension')
    } as vscode.ExtensionContext);
    const panel = createPanel();
    const document = {
      uri: vscode.Uri.file(tempFile)
    } as vscode.CustomDocument;

    await provider.resolveCustomEditor(document, panel as unknown as vscode.WebviewPanel);

    expect(panel.webview.html).toContain('Opening interactive renderer...');
    expect(panel.webview.html).toContain('kicanvas-source');
  });

  it('refreshes via postMessage without replacing HTML', async () => {
    const provider = new ContextProvider({
      extensionUri: vscode.Uri.file('/extension')
    } as vscode.ExtensionContext);
    const panel = createPanel();
    const document = {
      uri: vscode.Uri.file(tempFile)
    } as vscode.CustomDocument;

    await provider.resolveCustomEditor(document, panel as unknown as vscode.WebviewPanel);
    const initialHtml = panel.webview.html;

    await (provider as any).refreshDocument(document.uri);

    expect(panel.webview.html).toBe(initialHtml);
    expect(panel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'refresh',
        payload: expect.objectContaining({
          fileName: path.basename(tempFile)
        })
      })
    );
  });

  it('untracks panels when the webview is disposed', async () => {
    const provider = new ContextProvider({
      extensionUri: vscode.Uri.file('/extension')
    } as vscode.ExtensionContext);
    const panel = createPanel();
    const document = {
      uri: vscode.Uri.file(tempFile)
    } as vscode.CustomDocument;

    await provider.resolveCustomEditor(document, panel as unknown as vscode.WebviewPanel);

    const panels = (provider as any).panels.get(document.uri.toString());
    expect(panels.size).toBe(1);

    panel.fireDispose();

    expect((provider as any).panels.has(document.uri.toString())).toBe(false);
  });

  it('extracts PCB metadata for layers and tuning profiles', () => {
    if (extension !== '.kicad_pcb') {
      return;
    }

    const provider = new ContextProvider({
      extensionUri: vscode.Uri.file('/extension')
    } as vscode.ExtensionContext) as unknown as PcbEditorProvider;
    const metadata = (provider as any).buildViewerMetadata(
      vscode.Uri.file(tempFile),
      `(kicad_pcb
        (layers
          (0 "F.Cu" signal)
          (31 "B.Cu" signal)
        )
        (tuning_profile
          (name "DDR4")
          (layer "F.Cu")
          (impedance "50")
          (propagation_speed "150")
        )
      )`
    ) as {
      layers?: Array<{ name: string }>;
      tuningProfiles?: Array<{ name: string; layer?: string }>;
    };

    expect(metadata.layers?.map((layer) => layer.name)).toEqual(['F.Cu', 'B.Cu']);
    expect(metadata.tuningProfiles?.[0]).toEqual(
      expect.objectContaining({ name: 'DDR4', layer: 'F.Cu' })
    );
  });
});
