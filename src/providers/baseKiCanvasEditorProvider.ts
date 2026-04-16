import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  COMMANDS,
  SETTINGS,
  VIEWER_DEFAULT_LARGE_FILE_THRESHOLD_BYTES,
  VIEWER_HIDDEN_CACHE_RELEASE_MS,
  WEBVIEW_MESSAGE_DEBOUNCE_MS
} from '../constants';
import type { ViewerMetadata, ViewerState } from '../types';
import { bufferToBase64 } from '../utils/fileUtils';
import { asNumber, asRecord, asString, hasType, isRecord } from '../utils/webviewMessages';
import { createKiCanvasViewerHtml, createViewerErrorHtml, kicanvasUri } from './viewerHtml';

const PROGRESS_INLINE_WARNING_BYTES = 1 * 1024 * 1024;

interface ViewerPayload {
  fileName: string;
  base64: string;
  disabledReason: string;
  theme: string;
  metadata?: ViewerMetadata | undefined;
  restoreState?: ViewerState;
}

interface CachedFilePayload {
  base64: string;
  disabledReason: string;
  mtimeMs: number;
  metadata?: ViewerMetadata | undefined;
}

interface PanelInfo {
  uri: vscode.Uri;
  pendingRefresh: boolean;
  state?: ViewerState | undefined;
  releaseTimer?: NodeJS.Timeout | undefined;
}

/**
 * Shared custom editor provider for KiCanvas-backed viewers.
 */
export abstract class BaseKiCanvasEditorProvider
  implements vscode.CustomReadonlyEditorProvider, vscode.Disposable
{
  protected abstract readonly fileExtension: string;
  protected abstract readonly fileType: 'schematic' | 'board';
  protected abstract readonly viewerTitle: string;

  private readonly panels = new Map<string, Set<vscode.WebviewPanel>>();
  private readonly panelInfo = new Map<vscode.WebviewPanel, PanelInfo>();
  private readonly disposables: vscode.Disposable[] = [];
  private readonly refreshDebounce = new Map<string, NodeJS.Timeout>();
  private readonly fileCache = new Map<string, CachedFilePayload>();
  private readonly stateByUri = new Map<string, ViewerState>();
  private theme = vscode.workspace.getConfiguration().get<string>(SETTINGS.viewerTheme, 'kicad');

  constructor(protected readonly context: vscode.ExtensionContext) {
    this.disposables.push(
      vscode.workspace.onDidSaveTextDocument((document) => {
        if (!document.fileName.endsWith(this.fileExtension)) {
          return;
        }
        this.invalidateFileCache(document.uri);
        if (!vscode.workspace.getConfiguration().get<boolean>(SETTINGS.viewerAutoRefresh, true)) {
          return;
        }
        this.scheduleRefresh(document.uri);
      })
    );
  }

  dispose(): void {
    for (const timeout of this.refreshDebounce.values()) {
      clearTimeout(timeout);
    }
    for (const info of this.panelInfo.values()) {
      if (info.releaseTimer) {
        clearTimeout(info.releaseTimer);
      }
    }
    this.disposables.forEach((item) => item.dispose());
  }

  setTheme(theme: string): void {
    this.theme = theme;
    for (const [panel, info] of this.panelInfo) {
      void panel.webview.postMessage({
        type: 'setTheme',
        payload: {
          theme,
          restoreState: info.state ?? this.stateByUri.get(info.uri.toString())
        }
      });
    }
  }

  getViewerState(uri: vscode.Uri): ViewerState | undefined {
    return this.stateByUri.get(uri.toString());
  }

  protected buildViewerMetadata(_uri: vscode.Uri, _text: string): ViewerMetadata | undefined {
    return undefined;
  }

  async openCustomDocument(uri: vscode.Uri): Promise<vscode.CustomDocument> {
    return {
      uri,
      dispose() {}
    };
  }

  async resolveCustomEditor(
    document: vscode.CustomDocument,
    webviewPanel: vscode.WebviewPanel
  ): Promise<void> {
    try {
      webviewPanel.webview.options = {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')]
      };
      this.trackPanel(document.uri, webviewPanel);
      this.disposables.push(
        webviewPanel.onDidDispose(() => this.untrackPanel(document.uri, webviewPanel)),
        webviewPanel.onDidChangeViewState((event) => {
          const info = this.panelInfo.get(event.webviewPanel);
          if (!info) {
            return;
          }
          if (event.webviewPanel.visible) {
            if (info.releaseTimer) {
              clearTimeout(info.releaseTimer);
              info.releaseTimer = undefined;
            }
            if (info.pendingRefresh) {
              info.pendingRefresh = false;
              void this.refreshDocument(info.uri);
            }
          } else {
            info.releaseTimer = setTimeout(() => {
              this.invalidateFileCache(info.uri);
            }, VIEWER_HIDDEN_CACHE_RELEASE_MS);
          }
        }),
        webviewPanel.webview.onDidReceiveMessage(async (message: unknown) => {
          if (!hasType(message, VIEWER_OUTBOUND_MESSAGE_TYPES)) {
            return;
          }
          if (message.type === 'openInKiCad') {
            await vscode.commands.executeCommand(COMMANDS.openInKiCad, document.uri);
          }
          if (message.type === 'requestRefresh') {
            await this.refreshDocument(document.uri);
          }
          if (message.type === 'viewerState') {
            const info = this.panelInfo.get(webviewPanel);
            const nextState = readViewerState(message.payload);
            if (info && nextState) {
              info.state = nextState;
              this.stateByUri.set(document.uri.toString(), info.state);
            }
          }
          if (message.type === 'selectionChanged') {
            const info = this.panelInfo.get(webviewPanel);
            const payload = readViewerSelection(message.payload);
            if (info) {
              info.state = {
                ...(info.state ?? { zoom: 1, grid: false, theme: this.theme }),
                ...payload
              };
              this.stateByUri.set(document.uri.toString(), info.state);
            }
          }
          if (message.type === 'exportPng') {
            const payload = asRecord(message.payload);
            const dataUrl = asString(payload?.['dataUrl']);
            if (dataUrl) {
              await this.exportPngSnapshot(document.uri, dataUrl);
            }
          }
          if (message.type === 'exportSvg') {
            await vscode.commands.executeCommand(COMMANDS.exportViewerSvg, document.uri);
          }
          if (message.type === 'componentSelected') {
            const info = this.panelInfo.get(webviewPanel);
            const payload = asRecord(message.payload);
            const reference = asString(payload?.['reference']);
            if (info) {
              info.state = {
                ...(info.state ?? { zoom: 1, grid: false, theme: this.theme }),
                selectedReference: reference ?? info.state?.selectedReference
              };
              this.stateByUri.set(document.uri.toString(), info.state);
            }
          }
        })
      );
      await this.postFile(webviewPanel, document.uri);
    } catch (error) {
      webviewPanel.webview.html = createViewerErrorHtml(
        path.basename(document.uri.fsPath),
        error,
        webviewPanel.webview.cspSource
      );
    }
  }

  protected async refreshDocument(uri: vscode.Uri): Promise<void> {
    const payload = await this.buildViewerPayload(uri);
    for (const panel of this.panels.get(uri.toString()) ?? []) {
      if (!panel.visible) {
        const info = this.panelInfo.get(panel);
        if (info) {
          info.pendingRefresh = true;
        }
        continue;
      }
      await panel.webview.postMessage({
        type: 'refresh',
        payload: {
          ...payload,
          restoreState: this.panelInfo.get(panel)?.state
        }
      });
    }
  }

  private scheduleRefresh(uri: vscode.Uri): void {
    const key = uri.toString();
    const existing = this.refreshDebounce.get(key);
    if (existing) {
      clearTimeout(existing);
    }
    this.refreshDebounce.set(
      key,
      setTimeout(() => {
        this.refreshDebounce.delete(key);
        void this.refreshDocument(uri);
      }, WEBVIEW_MESSAGE_DEBOUNCE_MS)
    );
  }

  private async postFile(panel: vscode.WebviewPanel, uri: vscode.Uri): Promise<void> {
    const payload = await this.buildViewerPayload(uri);
    panel.webview.html = createKiCanvasViewerHtml({
      title: this.viewerTitle,
      fileName: payload.fileName,
      fileType: this.fileType,
      status: 'Opening interactive renderer...',
      cspSource: panel.webview.cspSource,
      kicanvasUri: kicanvasUri(this.context, panel.webview),
      base64: payload.base64,
      disabledReason: payload.disabledReason,
      theme: payload.theme,
      ...(payload.metadata ? { metadata: payload.metadata } : {}),
      ...(payload.restoreState ? { restoreState: payload.restoreState } : {})
    });
  }

  private async buildViewerPayload(uri: vscode.Uri): Promise<ViewerPayload> {
    const cacheKey = uri.toString();
    const fileName = path.basename(uri.fsPath);
    const stat = fs.statSync(uri.fsPath);
    const cached = this.fileCache.get(cacheKey);
    if (cached && cached.mtimeMs === stat.mtimeMs) {
      const restoreState = this.stateByUri.get(cacheKey);
      return {
        fileName,
        base64: cached.base64,
        disabledReason: cached.disabledReason,
        theme: this.theme,
        ...(cached.metadata ? { metadata: cached.metadata } : {}),
        ...(restoreState ? { restoreState } : {})
      };
    }

    const bytes =
      stat.size > PROGRESS_INLINE_WARNING_BYTES
        ? await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: `Loading ${fileName}`
            },
            async () => vscode.workspace.fs.readFile(uri)
          )
        : await vscode.workspace.fs.readFile(uri);
    const text = Buffer.from(bytes).toString('utf8');
    const largeFileThresholdBytes = Math.max(
      1,
      vscode.workspace
        .getConfiguration()
        .get<number>(
          SETTINGS.viewerLargeFileThresholdBytes,
          VIEWER_DEFAULT_LARGE_FILE_THRESHOLD_BYTES
        )
    );
    const canInline = bytes.byteLength <= largeFileThresholdBytes;
    const nextPayload: CachedFilePayload = {
      base64: canInline ? bufferToBase64(bytes) : '',
      disabledReason: canInline
        ? ''
        : `Interactive render is disabled for files larger than ${(largeFileThresholdBytes / 1024 / 1024).toFixed(0)} MB. Metadata is still available in the side panel.`,
      mtimeMs: stat.mtimeMs,
      metadata: this.buildViewerMetadata(uri, text)
    };
    this.fileCache.set(cacheKey, nextPayload);

    return {
      fileName,
      base64: nextPayload.base64,
      disabledReason: nextPayload.disabledReason,
      theme: this.theme,
      ...(nextPayload.metadata ? { metadata: nextPayload.metadata } : {}),
      ...(() => {
        const restoreState = this.stateByUri.get(cacheKey);
        return restoreState ? { restoreState } : {};
      })()
    };
  }

  private invalidateFileCache(uri: vscode.Uri): void {
    this.fileCache.delete(uri.toString());
  }

  private trackPanel(uri: vscode.Uri, panel: vscode.WebviewPanel): void {
    const key = uri.toString();
    const set = this.panels.get(key) ?? new Set<vscode.WebviewPanel>();
    set.add(panel);
    this.panels.set(key, set);
    this.panelInfo.set(panel, {
      uri,
      pendingRefresh: false,
      state: this.stateByUri.get(uri.toString())
    });
  }

  private untrackPanel(uri: vscode.Uri, panel: vscode.WebviewPanel): void {
    const key = uri.toString();
    const set = this.panels.get(key);
    if (set) {
      set.delete(panel);
      if (!set.size) {
        this.panels.delete(key);
      }
    }
    const info = this.panelInfo.get(panel);
    if (info?.releaseTimer) {
      clearTimeout(info.releaseTimer);
    }
    this.panelInfo.delete(panel);
  }

  private async exportPngSnapshot(uri: vscode.Uri, dataUrl: string): Promise<void> {
    const saveUri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(
        path.join(path.dirname(uri.fsPath), `${path.parse(uri.fsPath).name}-viewer.png`)
      ),
      filters: {
        PNG: ['png']
      }
    });
    if (!saveUri) {
      return;
    }

    const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
    await vscode.workspace.fs.writeFile(saveUri, Buffer.from(base64, 'base64'));
    void vscode.window.showInformationMessage(`Saved viewer snapshot to ${path.basename(saveUri.fsPath)}.`);
  }
}

const VIEWER_OUTBOUND_MESSAGE_TYPES = [
  'openInKiCad',
  'requestRefresh',
  'viewerState',
  'selectionChanged',
  'exportPng',
  'exportSvg',
  'componentSelected'
];

function readViewerState(value: unknown): ViewerState | undefined {
  const payload = asRecord(value);
  if (!payload) {
    return undefined;
  }
  const zoom = asNumber(payload?.['zoom']);
  const grid = payload?.['grid'];
  const theme = asString(payload?.['theme']);
  if (zoom === undefined || typeof grid !== 'boolean' || !theme) {
    return undefined;
  }

  const selectedArea = readSelectedArea(payload['selectedArea']);
  const activeLayers = readStringArray(payload['activeLayers']);
  return {
    zoom,
    grid,
    theme,
    ...(typeof payload['selectedReference'] === 'string'
      ? { selectedReference: payload['selectedReference'] }
      : {}),
    ...(selectedArea ? { selectedArea } : {}),
    ...(activeLayers ? { activeLayers } : {})
  };
}

function readViewerSelection(value: unknown): Partial<ViewerState> {
  const payload = asRecord(value);
  if (!payload) {
    return {};
  }

  const selectedArea = readSelectedArea(payload['selectedArea']);
  const activeLayers = readStringArray(payload['activeLayers']);
  return {
    ...(typeof payload['selectedReference'] === 'string'
      ? { selectedReference: payload['selectedReference'] }
      : {}),
    ...(selectedArea ? { selectedArea } : {}),
    ...(activeLayers ? { activeLayers } : {})
  };
}

function readSelectedArea(value: unknown):
  | {
      x1: number;
      y1: number;
      x2: number;
      y2: number;
    }
  | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const x1 = asNumber(value['x1']);
  const y1 = asNumber(value['y1']);
  const x2 = asNumber(value['x2']);
  const y2 = asNumber(value['y2']);
  if (x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined) {
    return undefined;
  }
  return { x1, y1, x2, y2 };
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.filter((entry): entry is string => typeof entry === 'string');
}
