import * as vscode from 'vscode';
import { COMMANDS } from '../constants';
import type { DetectedKiCadCli, DiagnosticSummary } from '../types';

export class KiCadStatusBar implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  private readonly mcpItem: vscode.StatusBarItem;
  private cli: DetectedKiCadCli | undefined;
  private drc: DiagnosticSummary | undefined;
  private erc: DiagnosticSummary | undefined;
  private aiConfigured = false;
  private aiHealthy: boolean | undefined;
  private mcpAvailable = false;
  private mcpConnected = false;

  constructor(_context: vscode.ExtensionContext) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.item.command = {
      command: COMMANDS.showStatusMenu,
      title: 'KiCad Studio'
    };
    this.item.show();
    this.mcpItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 95);
    this.mcpItem.command = {
      command: COMMANDS.setupMcpIntegration,
      title: 'KiCad Studio MCP'
    };
    this.mcpItem.show();
    this.render();
  }

  update(update: {
    cli?: DetectedKiCadCli | undefined;
    drc?: DiagnosticSummary | undefined;
    erc?: DiagnosticSummary | undefined;
    aiConfigured?: boolean;
    aiHealthy?: boolean | undefined;
    mcpAvailable?: boolean;
    mcpConnected?: boolean;
  }): void {
    this.cli = update.cli ?? this.cli;
    this.drc = update.drc ?? this.drc;
    this.erc = update.erc ?? this.erc;
    this.aiConfigured = update.aiConfigured ?? this.aiConfigured;
    this.aiHealthy = update.aiHealthy ?? this.aiHealthy;
    this.mcpAvailable = update.mcpAvailable ?? this.mcpAvailable;
    this.mcpConnected = update.mcpConnected ?? this.mcpConnected;
    this.render();
  }

  getSnapshot(): {
    cli: DetectedKiCadCli | undefined;
    drc: DiagnosticSummary | undefined;
    erc: DiagnosticSummary | undefined;
    aiConfigured: boolean;
    aiHealthy: boolean | undefined;
    mcpAvailable: boolean;
    mcpConnected: boolean;
  } {
    return {
      cli: this.cli,
      drc: this.drc,
      erc: this.erc,
      aiConfigured: this.aiConfigured,
      aiHealthy: this.aiHealthy,
      mcpAvailable: this.mcpAvailable,
      mcpConnected: this.mcpConnected
    };
  }

  dispose(): void {
    this.item.dispose();
    this.mcpItem.dispose();
  }

  private render(): void {
    if (!this.cli) {
      this.item.text = '$(warning) KiCad: Not found';
      this.item.tooltip = 'kicad-cli not found. Click to configure.';
      this.renderMcp();
      return;
    }

    const drcText = this.drc
      ? this.drc.errors > 0
        ? `$(error) DRC: ${this.drc.errors}`
        : this.drc.warnings > 0
          ? `$(warning) DRC: ${this.drc.warnings}`
          : '$(pass) DRC'
      : 'DRC: —';
    const ercText = this.erc
      ? this.erc.errors > 0
        ? `$(error) ERC: ${this.erc.errors}`
        : this.erc.warnings > 0
          ? `$(warning) ERC: ${this.erc.warnings}`
          : '$(pass) ERC'
      : 'ERC: —';
    const aiText = !this.aiConfigured
      ? '$(circle-outline) AI'
      : this.aiHealthy === false
        ? '$(warning) AI'
        : '$(pass-filled) AI';

    this.item.text = `$(circuit-board) ${this.cli.versionLabel}  ${drcText}  ${ercText}  ${aiText}`;
    this.item.tooltip = `CLI: ${this.cli.path}\nAI: ${
      !this.aiConfigured ? 'not configured' : this.aiHealthy === false ? 'configured, last check failed' : 'configured'
    }`;
    this.renderMcp();
  }

  private renderMcp(): void {
    if (this.mcpConnected) {
      this.mcpItem.text = '$(plug) MCP Connected';
      this.mcpItem.tooltip = 'kicad-mcp-pro is reachable. Click to re-run MCP setup or diagnostics.';
      return;
    }
    if (this.mcpAvailable) {
      this.mcpItem.text = '$(plug) MCP Available';
      this.mcpItem.tooltip = 'kicad-mcp-pro was detected locally. Click to create or refresh .vscode/mcp.json.';
      return;
    }
    this.mcpItem.text = '$(plug) MCP Setup';
    this.mcpItem.tooltip = 'kicad-mcp-pro was not detected yet. Click for setup guidance.';
  }
}
