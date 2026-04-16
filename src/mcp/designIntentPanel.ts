import * as vscode from 'vscode';
import { McpClient } from './mcpClient';

export class DesignIntentPanel {
  private static currentPanel: vscode.WebviewPanel | undefined;

  static createOrShow(
    context: vscode.ExtensionContext,
    mcpClient: McpClient
  ): void {
    if (DesignIntentPanel.currentPanel) {
      DesignIntentPanel.currentPanel.reveal(vscode.ViewColumn.Beside);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'kicadstudio.designIntent',
      'KiCad Design Intent',
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true
      }
    );

    DesignIntentPanel.currentPanel = panel;
    panel.onDidDispose(() => {
      if (DesignIntentPanel.currentPanel === panel) {
        DesignIntentPanel.currentPanel = undefined;
      }
    });
    panel.webview.html = this.getFormHtml();
    panel.webview.onDidReceiveMessage(async (message) => {
      if (message.type === 'load') {
        const intent = await mcpClient.callTool('project_get_design_intent', {});
        await panel.webview.postMessage({
          type: 'loaded',
          data: intent ?? {}
        });
        return;
      }

      if (message.type === 'save') {
        await mcpClient.callTool('project_set_design_intent', message.data ?? {});
        void vscode.window.showInformationMessage(
          'Design intent saved. AI can now use your project intent as context.'
        );
      }
    });
  }

  private static getFormHtml(): string {
    const nonce = createNonce();
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
  <style nonce="${nonce}">
    :root {
      color-scheme: dark;
      --bg: #020617;
      --panel: #0f172a;
      --border: rgba(148, 163, 184, 0.2);
      --text: #e2e8f0;
      --muted: #94a3b8;
      --accent: #0ea5e9;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 18px;
      font: 13px/1.5 "Segoe UI", system-ui, sans-serif;
      background: linear-gradient(180deg, #020617, #0f172a);
      color: var(--text);
    }
    h1 { margin-top: 0; font-size: 18px; }
    form {
      display: grid;
      gap: 12px;
    }
    label {
      display: grid;
      gap: 6px;
      color: var(--muted);
    }
    textarea, input, select, button {
      font: inherit;
      color: var(--text);
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 10px 12px;
    }
    textarea {
      min-height: 84px;
      resize: vertical;
    }
    button {
      cursor: pointer;
      background: linear-gradient(180deg, #0ea5e9, #0369a1);
      font-weight: 600;
    }
  </style>
</head>
<body>
  <h1>KiCad Design Intent</h1>
  <form id="intent-form">
    <label>Power tree references
      <textarea name="powerTreeRefs" placeholder="U1, U2, L1, FB1"></textarea>
    </label>
    <label>Connector references
      <textarea name="connectorRefs" placeholder="J1, J2"></textarea>
    </label>
    <label>Decoupling pairs
      <textarea name="decouplingPairs" placeholder="U1:C4,C5"></textarea>
    </label>
    <label>Analog / digital partitioning
      <textarea name="partitioning" placeholder="ADC and RF sections isolated from motor power"></textarea>
    </label>
    <label>Fabrication profile
      <select name="fabricationProfile">
        <option value="generic">Generic</option>
        <option value="jlcpcb">JLCPCB</option>
        <option value="pcbway">PCBWay</option>
      </select>
    </label>
    <label>Additional notes
      <textarea name="notes" placeholder="Sensor clustering, RF keepouts, review constraints..."></textarea>
    </label>
    <button type="submit">Save Design Intent</button>
  </form>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const form = document.getElementById('intent-form');

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const formData = new FormData(form);
      const data = Object.fromEntries(formData.entries());
      vscode.postMessage({ type: 'save', data });
    });

    window.addEventListener('message', (event) => {
      const message = event.data;
      if (message.type !== 'loaded' || !message.data) {
        return;
      }
      for (const [key, value] of Object.entries(message.data)) {
        const field = form.elements.namedItem(key);
        if (field && 'value' in field && typeof value === 'string') {
          field.value = value;
        }
      }
    });

    vscode.postMessage({ type: 'load' });
  </script>
</body>
</html>`;
  }
}

function createNonce(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let value = '';
  for (let index = 0; index < 32; index += 1) {
    value += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }
  return value;
}
