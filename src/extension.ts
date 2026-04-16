import { spawn, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { ErrorAnalyzer } from './ai/errorAnalyzer';
import { AIProviderRegistry } from './ai/aiProvider';
import { KiCadChatPanel } from './ai/chatPanel';
import { formatDiagnosticSummary, getActiveAiContext } from './ai/context';
import { CircuitExplainer } from './ai/circuitExplainer';
import { buildProactiveDRCPrompt } from './ai/prompts';
import { BomExporter } from './bom/bomExporter';
import { BomParser } from './bom/bomParser';
import { KiCadCheckService } from './cli/checkCommands';
import { KiCadCliDetector } from './cli/kicadCliDetector';
import { KiCadCliRunner } from './cli/kicadCliRunner';
import { ExportPresetStore } from './cli/exportPresets';
import { KiCadExportService } from './cli/exportCommands';
import { KiCadImportService } from './cli/importCommands';
import { ComponentSearchService } from './components/componentSearch';
import { ComponentSearchCache } from './components/componentSearchCache';
import { LcscClient } from './components/lcscClient';
import { OctopartClient } from './components/octopartClient';
import {
  BOM_VIEW_ID,
  COMMANDS,
  CONTEXT_KEYS,
  DIAGNOSTIC_COLLECTION_NAME,
  DOCUMENT_SELECTOR,
  DRC_RULES_VIEW_ID,
  EXTENSION_ID,
  FIX_QUEUE_VIEW_ID,
  NETLIST_VIEW_ID,
  PCB_EDITOR_VIEW_TYPE,
  SCHEMATIC_EDITOR_VIEW_TYPE,
  SETTINGS,
  TREE_VIEW_ID,
  VARIANTS_VIEW_ID,
  AI_SECRET_KEY,
  OCTOPART_SECRET_KEY
} from './constants';
import { GitDiffDetector } from './git/gitDiffDetector';
import { KiCadLibraryIndexer } from './library/libraryIndexer';
import { LibrarySearchProvider } from './library/librarySearchProvider';
import { registerLanguageModelChatProvider } from './lm/languageModelChatProvider';
import { registerLanguageModelTools } from './lm/languageModelTools';
import { registerMcpServerDefinitionProvider } from './lm/mcpServerDefinitionProvider';
import { DesignIntentPanel } from './mcp/designIntentPanel';
import { ContextBridge } from './mcp/contextBridge';
import { McpClient } from './mcp/mcpClient';
import { McpDetector } from './mcp/mcpDetector';
import { FixQueueProvider } from './mcp/fixQueueProvider';
import { KiCadCompletionProvider } from './language/completionProvider';
import { KiCadDiagnosticsProvider } from './language/diagnosticsProvider';
import { KiCadHoverProvider } from './language/hoverProvider';
import { KiCadDocumentStore } from './language/kicadDocumentStore';
import { SExpressionParser } from './language/sExpressionParser';
import { KiCadSymbolProvider } from './language/symbolProvider';
import { DrcRulesProvider, type DrcRuleItem } from './drc/drcRulesProvider';
import { BomViewProvider } from './providers/bomViewProvider';
import { DiffEditorProvider } from './providers/diffEditorProvider';
import { NetlistViewProvider } from './providers/netlistViewProvider';
import { PcbEditorProvider } from './providers/pcbEditorProvider';
import { KiCadProjectTreeProvider } from './providers/projectTreeProvider';
import { SchematicEditorProvider } from './providers/schematicEditorProvider';
import { KiCadStatusBar } from './statusbar/kicadStatusBar';
import { KiCadTaskProvider } from './tasks/kicadTaskProvider';
import { VariantProvider } from './variants/variantProvider';
import { Logger } from './utils/logger';
import { findFirstWorkspaceFile } from './utils/pathUtils';
import type { DiagnosticSummary, McpInstallStatus } from './types';

let extensionLogger: Logger | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const activationStartedAt = Date.now();
  const logger = new Logger('KiCad Studio');
  extensionLogger = logger;
  logger.info('Activating KiCad Studio...');
  await migrateDeprecatedSecretSettings(context, logger);
  let latestDrcRun:
    | {
        file: string;
        diagnostics: vscode.Diagnostic[];
        summary: DiagnosticSummary;
      }
    | undefined;
  let aiHealthy: boolean | undefined;

  const parser = new SExpressionParser();
  const languageServer = new KiCadDocumentStore(parser);
  const cliDetector = new KiCadCliDetector();
  const cliRunner = new KiCadCliRunner(cliDetector, logger);
  const importService = new KiCadImportService(cliRunner, logger);
  const statusBar = new KiCadStatusBar(context);
  const bomParser = new BomParser(parser);
  const bomExporter = new BomExporter();
  const presetStore = new ExportPresetStore(context);
  const exportService = new KiCadExportService(
    cliRunner,
    cliDetector,
    bomParser,
    bomExporter,
    presetStore,
    logger
  );
  const diagnosticsCollection = vscode.languages.createDiagnosticCollection(
    DIAGNOSTIC_COLLECTION_NAME
  );
  const diagnosticsProvider = new KiCadDiagnosticsProvider(parser, diagnosticsCollection);
  const checkService = new KiCadCheckService(cliRunner, parser, logger);
  const treeProvider = new KiCadProjectTreeProvider();
  const bomViewProvider = new BomViewProvider(context, parser);
  const netlistViewProvider = new NetlistViewProvider(context, parser, cliRunner, logger);
  const schematicEditorProvider = new SchematicEditorProvider(context);
  const pcbEditorProvider = new PcbEditorProvider(context);
  const gitDiffDetector = new GitDiffDetector(parser);
  const diffEditorProvider = new DiffEditorProvider(context, gitDiffDetector);
  const aiProviders = new AIProviderRegistry(context);
  const mcpDetector = new McpDetector();
  const mcpClient = new McpClient(mcpDetector, logger);
  const contextBridge = new ContextBridge(mcpClient);
  const variantProvider = new VariantProvider();
  const fixQueueProvider = new FixQueueProvider(mcpClient);
  const drcRulesProvider = new DrcRulesProvider(parser);
  const errorAnalyzer = new ErrorAnalyzer(aiProviders, logger);
  const circuitExplainer = new CircuitExplainer(aiProviders, logger);
  const componentSearch = new ComponentSearchService(
    new OctopartClient(context.secrets),
    new LcscClient(),
    new ComponentSearchCache(context.globalState)
  );
  const libraryIndexer = new KiCadLibraryIndexer(context);
  const librarySearch = new LibrarySearchProvider(
    libraryIndexer,
    logger,
    cliDetector,
    cliRunner,
    context.extensionUri
  );

  context.subscriptions.push(
    logger,
    statusBar,
    diagnosticsCollection,
    libraryIndexer,
    schematicEditorProvider,
    pcbEditorProvider,
    bomViewProvider,
    netlistViewProvider,
    vscode.window.registerCustomEditorProvider(
      SCHEMATIC_EDITOR_VIEW_TYPE,
      schematicEditorProvider,
      {
        supportsMultipleEditorsPerDocument: true,
        webviewOptions: { retainContextWhenHidden: true }
      }
    ),
    vscode.window.registerCustomEditorProvider(PCB_EDITOR_VIEW_TYPE, pcbEditorProvider, {
      supportsMultipleEditorsPerDocument: true,
      webviewOptions: { retainContextWhenHidden: true }
    }),
    vscode.languages.registerHoverProvider(
      DOCUMENT_SELECTOR,
      new KiCadHoverProvider(parser)
    ),
    vscode.languages.registerDocumentSymbolProvider(
      DOCUMENT_SELECTOR,
      new KiCadSymbolProvider(parser)
    ),
    vscode.languages.registerCompletionItemProvider(
      DOCUMENT_SELECTOR,
      new KiCadCompletionProvider(parser),
      '('
    ),
    vscode.window.registerTreeDataProvider(TREE_VIEW_ID, treeProvider),
    vscode.window.registerTreeDataProvider(VARIANTS_VIEW_ID, variantProvider),
    vscode.window.registerTreeDataProvider(FIX_QUEUE_VIEW_ID, fixQueueProvider),
    vscode.window.registerTreeDataProvider(DRC_RULES_VIEW_ID, drcRulesProvider),
    vscode.window.registerWebviewViewProvider(BOM_VIEW_ID, bomViewProvider),
    vscode.window.registerWebviewViewProvider(NETLIST_VIEW_ID, netlistViewProvider),
    vscode.tasks.registerTaskProvider('kicad', new KiCadTaskProvider())
  );

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((document) => {
      if (!document.languageId.startsWith('kicad-')) {
        return;
      }
      languageServer.invalidate(document.uri);
      void languageServer.parseDocument(document);
      diagnosticsProvider.update(document);
    }),
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (!event.document.languageId.startsWith('kicad-')) {
        return;
      }
      languageServer.scheduleParse(event.document);
    }),
    vscode.workspace.onDidSaveTextDocument((document) => {
      if (!document.languageId.startsWith('kicad-')) {
        return;
      }
      languageServer.invalidate(document.uri);
      void languageServer.parseDocument(document);
      diagnosticsProvider.update(document);
      treeProvider.refresh();
      variantProvider.refresh();
      drcRulesProvider.refresh();
      void refreshContexts();
      void runConfiguredSaveChecks(document);
      void pushStudioContext();
    }),
    vscode.workspace.onDidCloseTextDocument((document) => {
      diagnosticsCollection.delete(document.uri);
      languageServer.invalidate(document.uri);
    }),
    vscode.window.onDidChangeActiveTextEditor(() => {
      void refreshContexts();
      variantProvider.refresh();
      drcRulesProvider.refresh();
      void pushStudioContext();
    }),
    vscode.window.tabGroups.onDidChangeTabs(() => {
      void refreshContexts();
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (
        event.affectsConfiguration(SETTINGS.cliPath) ||
        event.affectsConfiguration(SETTINGS.aiProvider) ||
        event.affectsConfiguration(SETTINGS.aiLanguage) ||
        event.affectsConfiguration(SETTINGS.aiOpenAIApiMode) ||
        event.affectsConfiguration(SETTINGS.mcpEndpoint) ||
        event.affectsConfiguration(SETTINGS.mcpAutoDetect)
      ) {
        cliDetector.clearCache();
        aiHealthy = undefined;
        void refreshContexts();
        void refreshMcpState();
      }
      if (event.affectsConfiguration(SETTINGS.logLevel)) {
        logger.refreshLevel();
      }
      if (event.affectsConfiguration(SETTINGS.viewerTheme)) {
        const theme = vscode.workspace.getConfiguration().get<string>(SETTINGS.viewerTheme, 'kicad');
        schematicEditorProvider.setTheme(theme);
        pcbEditorProvider.setTheme(theme);
      }
    })
  );

  context.subscriptions.push(
    vscode.window.onDidChangeActiveColorTheme((theme) => {
      const isDark =
        theme.kind === vscode.ColorThemeKind.Dark ||
        theme.kind === vscode.ColorThemeKind.HighContrast;
      const nextTheme = isDark ? 'dark' : 'light';
      schematicEditorProvider.setTheme(nextTheme);
      pcbEditorProvider.setTheme(nextTheme);
    })
  );

  registerCommands(context, {
    cliDetector,
    exportService,
    checkService,
    diffEditorProvider,
    fixQueueProvider,
    diagnosticsCollection,
    statusBar,
    componentSearch,
    aiProviders,
    errorAnalyzer,
    circuitExplainer,
    importService,
    libraryIndexer,
    librarySearch,
    mcpClient,
    variantProvider,
    drcRulesProvider,
    treeProvider,
    context,
    logger,
    getLatestDrcRun: () => latestDrcRun,
    setLatestDrcRun: (value) => {
      latestDrcRun = value;
    },
    setAiHealthy: (value) => {
      aiHealthy = value;
    },
    pushStudioContext,
    refreshContexts,
    refreshMcpState
  });

  context.subscriptions.push(
    registerLanguageModelTools(context, {
      logger,
      checkService,
      cliDetector,
      cliRunner,
      componentSearch,
      libraryIndexer,
      variantProvider,
      diagnosticsCollection,
      getStudioContext: buildStudioContext,
      setLatestDrcRun: (value) => {
        latestDrcRun = value;
      }
    })
  );
  registerMcpServerDefinitionProvider(context, mcpDetector, logger);
  registerLanguageModelChatProvider(context, logger, buildStudioContext);

  void cliDetector.detect().then((cli) => {
    statusBar.update({ cli });
  });
  void refreshMcpState();
  variantProvider.refresh();
  drcRulesProvider.refresh();

  await refreshContexts();

  const isFirstInstall = !context.globalState.get<boolean>('kicadstudio.installed');
  if (isFirstInstall) {
    await context.globalState.update('kicadstudio.installed', true);
    await vscode.commands.executeCommand(
      'workbench.action.openWalkthrough',
      `${EXTENSION_ID}#kicadstudio.gettingStarted`
    );
  }

  logger.info('KiCad Studio activated successfully.');
  const activationDurationMs = Date.now() - activationStartedAt;
  logger.info(`KiCad Studio activated in ${activationDurationMs}ms`);
  if (activationDurationMs > 500) {
    logger.warn(`Activation exceeded 500ms (${activationDurationMs}ms).`);
  }

  async function refreshContexts(): Promise<void> {
    const activeUri = getActiveResourceUri();
    const hasProject =
      (await vscode.workspace.findFiles('**/*.kicad_pro', '**/node_modules/**', 1)).length > 0 ||
      (await vscode.workspace.findFiles('**/*.kicad_sch', '**/node_modules/**', 1)).length > 0 ||
      (await vscode.workspace.findFiles('**/*.kicad_pcb', '**/node_modules/**', 1)).length > 0;
    const provider = await aiProviders.getProvider();
    const cli = await cliDetector.detect();
    const kicadVersionMajor = Number(cli?.version.split('.')[0] ?? '0');
    const hasVariants = await workspaceHasVariants();
    await vscode.commands.executeCommand('setContext', CONTEXT_KEYS.hasProject, hasProject);
    await vscode.commands.executeCommand(
      'setContext',
      CONTEXT_KEYS.schematicOpen,
      activeUri?.fsPath.endsWith('.kicad_sch') ?? false
    );
    await vscode.commands.executeCommand(
      'setContext',
      CONTEXT_KEYS.pcbOpen,
      activeUri?.fsPath.endsWith('.kicad_pcb') ?? false
    );
    await vscode.commands.executeCommand(
      'setContext',
      CONTEXT_KEYS.aiEnabled,
      Boolean(provider?.isConfigured())
    );
    await vscode.commands.executeCommand(
      'setContext',
      CONTEXT_KEYS.aiHealthy,
      Boolean(provider?.isConfigured() && aiHealthy !== false)
    );
    await vscode.commands.executeCommand(
      'setContext',
      CONTEXT_KEYS.kicad10Plus,
      kicadVersionMajor >= 10
    );
    await vscode.commands.executeCommand(
      'setContext',
      CONTEXT_KEYS.hasVariants,
      hasVariants
    );
    statusBar.update({
      aiConfigured: Boolean(provider?.isConfigured()),
      aiHealthy
    });
  }

  async function runConfiguredSaveChecks(document: vscode.TextDocument): Promise<void> {
    const config = vscode.workspace.getConfiguration();
    const shouldRunDrc =
      document.fileName.endsWith('.kicad_pcb') &&
      config.get<boolean>(SETTINGS.autoRunDRC, false);
    const shouldRunErc =
      document.fileName.endsWith('.kicad_sch') &&
      config.get<boolean>(SETTINGS.autoRunERC, false);

    if (!shouldRunDrc && !shouldRunErc) {
      return;
    }

    try {
      const result = shouldRunDrc
        ? await checkService.runDRC(document.fileName)
        : await checkService.runERC(document.fileName);
      diagnosticsCollection.set(vscode.Uri.file(document.fileName), result.diagnostics);
      statusBar.update(shouldRunDrc ? { drc: result.summary } : { erc: result.summary });
      if (shouldRunDrc) {
        latestDrcRun = {
          file: document.fileName,
          diagnostics: result.diagnostics,
          summary: result.summary
        };
        await maybeOfferProactiveDrc(result.summary, result.diagnostics.length);
        await pushStudioContext();
      }
      if (result.diagnostics.length > 0) {
        await vscode.commands.executeCommand('workbench.actions.view.problems');
      }
    } catch (error) {
      logger.error('Auto DRC/ERC on save failed', error);
      void vscode.window.showErrorMessage(
        error instanceof Error
          ? `KiCad Studio auto-check failed: ${error.message}`
          : 'KiCad Studio auto-check failed. Confirm kicad-cli is configured and the file is valid.'
      );
    }
  }

  async function maybeOfferProactiveDrc(
    summary: DiagnosticSummary,
    diagnosticCount: number
  ): Promise<void> {
    const provider = await aiProviders.getProvider();
    if (!provider?.isConfigured() || diagnosticCount <= 0) {
      return;
    }
    const choice = await vscode.window.showInformationMessage(
      `DRC: ${summary.errors} errors found. Start AI analysis?`,
      'Yes, analyze',
      'No'
    );
    if (choice === 'Yes, analyze') {
      await vscode.commands.executeCommand(COMMANDS.aiProactiveDRC);
    }
  }

  async function refreshMcpState(): Promise<void> {
    const state = await mcpClient.testConnection();
    await vscode.commands.executeCommand(
      'setContext',
      CONTEXT_KEYS.mcpAvailable,
      state.available
    );
    await vscode.commands.executeCommand(
      'setContext',
      CONTEXT_KEYS.mcpConnected,
      state.connected
    );
    statusBar.update({
      mcpAvailable: state.available,
      mcpConnected: state.connected
    });

    if (
      state.available &&
      !state.connected &&
      vscode.workspace.getConfiguration().get<boolean>(SETTINGS.mcpAutoDetect, true)
    ) {
      await maybeOfferMcpBootstrap(state.install);
    }
  }

  async function maybeOfferMcpBootstrap(
    installStatus: McpInstallStatus | undefined
  ): Promise<void> {
    if (!installStatus?.found) {
      return;
    }

    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) {
      return;
    }

    const mcpJsonPath = path.join(root, '.vscode', 'mcp.json');
    if (fs.existsSync(mcpJsonPath)) {
      return;
    }

    const choice = await vscode.window.showInformationMessage(
      'kicad-mcp-pro was detected. Create .vscode/mcp.json for this project?',
      'Setup MCP',
      'Later'
    );
    if (choice === 'Setup MCP') {
      await mcpDetector.generateMcpJson(root, installStatus);
      await refreshMcpState();
    }
  }

  async function buildStudioContext(): Promise<{
    activeFile: string | undefined;
    fileType: 'schematic' | 'pcb' | 'other';
    drcErrors: string[];
    selectedNet?: string | undefined;
    selectedReference?: string | undefined;
    selectedArea?:
      | {
          x1: number;
          y1: number;
          x2: number;
          y2: number;
        }
      | undefined;
    activeVariant?: string | undefined;
    mcpConnected?: boolean | undefined;
    cursorPosition?:
      | {
          line: number;
          character: number;
        }
      | undefined;
    activeSheetPath?: string | undefined;
    visibleLayers?: string[] | undefined;
  }> {
    const activeUri = getActiveResourceUri();
    const activeEditor = vscode.window.activeTextEditor;
    const fileType =
      activeUri?.fsPath.endsWith('.kicad_sch')
        ? 'schematic'
        : activeUri?.fsPath.endsWith('.kicad_pcb')
          ? 'pcb'
          : 'other';
    const viewerState =
      fileType === 'pcb' && activeUri
        ? pcbEditorProvider.getViewerState(activeUri)
        : fileType === 'schematic' && activeUri
          ? schematicEditorProvider.getViewerState(activeUri)
          : undefined;
    const mcpState = await mcpClient.testConnection();
    return {
      activeFile: activeUri?.fsPath,
      fileType,
      drcErrors:
        latestDrcRun?.diagnostics.map((diagnostic) => diagnostic.message).slice(0, 20) ?? [],
      selectedReference: viewerState?.selectedReference,
      selectedArea: viewerState?.selectedArea,
      cursorPosition: activeEditor
        ? {
            line: activeEditor.selection.active.line,
            character: activeEditor.selection.active.character
          }
        : undefined,
      activeSheetPath:
        fileType === 'schematic' && activeUri
          ? path.relative(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '', activeUri.fsPath)
          : undefined,
      visibleLayers: viewerState?.activeLayers,
      activeVariant: await variantProvider.getActiveVariantName(),
      mcpConnected: mcpState.connected
    };
  }

  async function pushStudioContext(): Promise<void> {
    await contextBridge.pushContext(await buildStudioContext());
  }
}

export function deactivate(): void {
  extensionLogger?.info('Deactivating KiCad Studio...');
}

async function migrateDeprecatedSecretSettings(
  context: vscode.ExtensionContext,
  logger: Logger
): Promise<void> {
  await migrateDeprecatedSecretSetting({
    context,
    logger,
    settingKey: SETTINGS.aiApiKey,
    secretKey: AI_SECRET_KEY,
    label: 'AI'
  });
  await migrateDeprecatedSecretSetting({
    context,
    logger,
    settingKey: SETTINGS.octopartApiKey,
    secretKey: OCTOPART_SECRET_KEY,
    label: 'Octopart/Nexar'
  });
}

async function migrateDeprecatedSecretSetting(args: {
  context: vscode.ExtensionContext;
  logger: Logger;
  settingKey: string;
  secretKey: string;
  label: string;
}): Promise<void> {
  const config = vscode.workspace.getConfiguration();
  const plaintextValue = config.get<string>(args.settingKey, '').trim();
  if (!plaintextValue) {
    return;
  }

  const existingSecret = await args.context.secrets.get(args.secretKey);
  if (!existingSecret) {
    await args.context.secrets.store(args.secretKey, plaintextValue);
  }

  await clearDeprecatedSetting(config, args.settingKey, args.logger);
  args.logger.warn(`${args.label} API key was migrated from deprecated plaintext settings to VS Code SecretStorage.`);
  void vscode.window.showInformationMessage(
    `${args.label} API key was moved from deprecated settings to VS Code SecretStorage. Plaintext runtime fallback is disabled in KiCad Studio v2.`
  );
}

async function clearDeprecatedSetting(
  config: vscode.WorkspaceConfiguration,
  settingKey: string,
  logger: Logger
): Promise<void> {
  for (const target of [
    vscode.ConfigurationTarget.Global,
    vscode.ConfigurationTarget.Workspace,
    vscode.ConfigurationTarget.WorkspaceFolder
  ]) {
    try {
      await config.update(settingKey, undefined, target);
    } catch (error) {
      logger.debug(
        `Could not clear deprecated setting ${settingKey} at target ${String(target)}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
}

function registerCommands(
  extensionContext: vscode.ExtensionContext,
  services: {
    cliDetector: KiCadCliDetector;
    exportService: KiCadExportService;
    importService: KiCadImportService;
    checkService: KiCadCheckService;
    diffEditorProvider: DiffEditorProvider;
    fixQueueProvider: FixQueueProvider;
    diagnosticsCollection: vscode.DiagnosticCollection;
    statusBar: KiCadStatusBar;
    componentSearch: ComponentSearchService;
    aiProviders: AIProviderRegistry;
    errorAnalyzer: ErrorAnalyzer;
    circuitExplainer: CircuitExplainer;
    mcpClient: McpClient;
    libraryIndexer: KiCadLibraryIndexer;
    librarySearch: LibrarySearchProvider;
    variantProvider: VariantProvider;
    drcRulesProvider: DrcRulesProvider;
    treeProvider: KiCadProjectTreeProvider;
    context: vscode.ExtensionContext;
    logger: Logger;
    getLatestDrcRun: () =>
      | {
          file: string;
          diagnostics: vscode.Diagnostic[];
          summary: DiagnosticSummary;
        }
      | undefined;
    setLatestDrcRun: (value: {
      file: string;
      diagnostics: vscode.Diagnostic[];
      summary: DiagnosticSummary;
    }) => void;
    setAiHealthy: (value: boolean | undefined) => void;
    pushStudioContext: () => Promise<void>;
    refreshContexts: () => Promise<void>;
    refreshMcpState: () => Promise<void>;
  }
): void {
  const registrations: vscode.Disposable[] = [];

  registrations.push(
    vscode.commands.registerCommand(COMMANDS.showStatusMenu, async () => {
      const cli = await services.cliDetector.detect(false);
      if (cli) {
        services.statusBar.update({ cli });
      }
      const snapshot = services.statusBar.getSnapshot();
      const drcDetail = snapshot.drc
        ? `${snapshot.drc.errors} errors, ${snapshot.drc.warnings} warnings, ${snapshot.drc.infos} info`
        : 'No DRC result yet';
      const ercDetail = snapshot.erc
        ? `${snapshot.erc.errors} errors, ${snapshot.erc.warnings} warnings, ${snapshot.erc.infos} info`
        : 'No ERC result yet';
      const picked = await vscode.window.showQuickPick(
        [
          {
            label: cli ? `$(check) ${cli.versionLabel}` : '$(warning) kicad-cli not found',
            description: cli?.source ?? 'configure',
            detail: cli?.path ?? 'Install KiCad or configure kicadstudio.kicadCliPath.',
            command: cli ? COMMANDS.detectCli : 'workbench.action.openSettings',
            args: cli ? [] : [SETTINGS.cliPath]
          },
          { label: '$(beaker) Run DRC', description: drcDetail, command: COMMANDS.runDRC },
          { label: '$(pulse) Run ERC', description: ercDetail, command: COMMANDS.runERC },
          { label: '$(package) Export Gerbers', command: COMMANDS.exportGerbers },
          { label: '$(archive) Export Manufacturing Package', command: COMMANDS.exportManufacturingPackage },
          { label: '$(file-pdf) Export PDF', command: COMMANDS.exportPDF },
          { label: '$(plug) Setup MCP Integration', command: COMMANDS.setupMcpIntegration },
          { label: '$(search) Search Component', command: COMMANDS.searchComponent },
          { label: '$(comment-discussion) Open AI Chat', command: COMMANDS.openAiChat },
          { label: '$(search) Search Library Symbol', command: COMMANDS.searchLibrarySymbol },
          { label: '$(git-compare) Show Visual Diff', command: COMMANDS.showDiff },
          {
            label: '$(settings-gear) Open KiCad Studio Settings',
            command: 'workbench.action.openSettings',
            args: ['@ext:oaslananka.kicadstudio']
          }
        ],
        { title: 'KiCad Studio Commands' }
      );
      if (picked) {
        await vscode.commands.executeCommand(picked.command, ...(picked.args ?? []));
      }
    }),
    vscode.commands.registerCommand(COMMANDS.openSchematic, async (resource?: vscode.Uri) => {
      const uri = resource ?? getActiveResourceUri();
      if (uri) {
        await vscode.commands.executeCommand('vscode.openWith', uri, SCHEMATIC_EDITOR_VIEW_TYPE);
      }
    }),
    vscode.commands.registerCommand(COMMANDS.openPCB, async (resource?: vscode.Uri) => {
      const uri = resource ?? getActiveResourceUri();
      if (uri) {
        await vscode.commands.executeCommand('vscode.openWith', uri, PCB_EDITOR_VIEW_TYPE);
      }
    }),
    vscode.commands.registerCommand(COMMANDS.openInKiCad, async (resource?: vscode.Uri) => {
      try {
        const uri = resource ?? getActiveResourceUri();
        if (!uri) {
          return;
        }
        const executable = resolveKiCadExecutable(uri.fsPath);
        await launchDetached(executable.command, [...executable.args, uri.fsPath]);
      } catch (error) {
        services.logger.error('Open in KiCad failed', error);
        void vscode.window.showErrorMessage(
          error instanceof Error
            ? `Unable to open KiCad.\nWhat happened: ${error.message}\nHow to fix: install KiCad or configure kicadstudio.kicadPath.`
            : 'Unable to open KiCad.\nWhat happened: KiCad executable was not found.\nHow to fix: install KiCad or configure kicadstudio.kicadPath.'
        );
      }
    }),
    vscode.commands.registerCommand(COMMANDS.detectCli, async () => {
      const cli = await services.cliDetector.detect(true);
      services.statusBar.update({ cli });
    }),
    vscode.commands.registerCommand(COMMANDS.exportGerbers, (resource?: vscode.Uri) =>
      services.exportService.exportGerbers(resource)
    ),
    vscode.commands.registerCommand(COMMANDS.exportGerbersWithDrill, (resource?: vscode.Uri) =>
      services.exportService.exportGerbersWithDrill(resource)
    ),
    vscode.commands.registerCommand(COMMANDS.exportPDF, (resource?: vscode.Uri) =>
      services.exportService.exportPDF(resource)
    ),
    vscode.commands.registerCommand(COMMANDS.exportPCBPDF, (resource?: vscode.Uri) =>
      services.exportService.exportPCBPDF(resource)
    ),
    vscode.commands.registerCommand(COMMANDS.export3DPdf, (resource?: vscode.Uri) =>
      services.exportService.export3DPdf(resource)
    ),
    vscode.commands.registerCommand(COMMANDS.exportSVG, (resource?: vscode.Uri) =>
      services.exportService.exportSVG(resource)
    ),
    vscode.commands.registerCommand(COMMANDS.exportIPC2581, (resource?: vscode.Uri) =>
      services.exportService.exportIPC2581(resource)
    ),
    vscode.commands.registerCommand(COMMANDS.exportODB, (resource?: vscode.Uri) =>
      services.exportService.exportODB(resource)
    ),
    vscode.commands.registerCommand(COMMANDS.export3DGLB, (resource?: vscode.Uri) =>
      services.exportService.export3DGLB(resource)
    ),
    vscode.commands.registerCommand(COMMANDS.export3DBREP, (resource?: vscode.Uri) =>
      services.exportService.export3DBREP(resource)
    ),
    vscode.commands.registerCommand(COMMANDS.export3DPLY, (resource?: vscode.Uri) =>
      services.exportService.export3DPLY(resource)
    ),
    vscode.commands.registerCommand(COMMANDS.exportGenCAD, (resource?: vscode.Uri) =>
      services.exportService.exportGenCAD(resource)
    ),
    vscode.commands.registerCommand(COMMANDS.exportIPCD356, (resource?: vscode.Uri) =>
      services.exportService.exportIPCD356(resource)
    ),
    vscode.commands.registerCommand(COMMANDS.exportDXF, (resource?: vscode.Uri) =>
      services.exportService.exportDXF(resource)
    ),
    vscode.commands.registerCommand(COMMANDS.exportPickAndPlace, (resource?: vscode.Uri) =>
      services.exportService.exportPickAndPlace(resource)
    ),
    vscode.commands.registerCommand(COMMANDS.exportFootprintSVG, (resource?: vscode.Uri) =>
      services.exportService.exportFootprintSVG(resource)
    ),
    vscode.commands.registerCommand(COMMANDS.exportSymbolSVG, (resource?: vscode.Uri) =>
      services.exportService.exportSymbolSVG(resource)
    ),
    vscode.commands.registerCommand(COMMANDS.exportManufacturingPackage, (resource?: vscode.Uri) =>
      services.exportService.exportManufacturingPackage(resource)
    ),
    vscode.commands.registerCommand(COMMANDS.exportBOMCSV, (resource?: vscode.Uri) =>
      services.exportService.exportBOMCSV(resource)
    ),
    vscode.commands.registerCommand(COMMANDS.exportBOMXLSX, (resource?: vscode.Uri) =>
      services.exportService.exportBOMXLSX(resource)
    ),
    vscode.commands.registerCommand(COMMANDS.exportNetlist, (resource?: vscode.Uri) =>
      services.exportService.exportNetlist(resource)
    ),
    vscode.commands.registerCommand(COMMANDS.runJobset, (resource?: vscode.Uri) =>
      services.exportService.runJobset(resource)
    ),
    vscode.commands.registerCommand(COMMANDS.exportInteractiveBOM, (resource?: vscode.Uri) =>
      services.exportService.exportInteractiveBOM(resource)
    ),
    vscode.commands.registerCommand(COMMANDS.runDRC, async (resource?: vscode.Uri) => {
      const file = await resolveTargetFile(resource, '.kicad_pcb');
      if (!file) {
        return;
      }
      try {
        const result = await services.checkService.runDRC(file);
        services.diagnosticsCollection.set(vscode.Uri.file(file), result.diagnostics);
        services.statusBar.update({ drc: result.summary });
        services.setLatestDrcRun({
          file,
          diagnostics: result.diagnostics,
          summary: result.summary
        });
        void services.fixQueueProvider.refresh().catch(() => undefined);
        if (result.diagnostics.length > 0) {
          await vscode.commands.executeCommand('workbench.actions.view.problems');
          const provider = await services.aiProviders.getProvider();
          if (provider?.isConfigured()) {
            const choice = await vscode.window.showInformationMessage(
              `DRC: ${result.summary.errors} errors found. Start AI analysis?`,
              'Yes, analyze',
              'No'
            );
            if (choice === 'Yes, analyze') {
              await vscode.commands.executeCommand(COMMANDS.aiProactiveDRC);
            }
          }
        }
        await services.pushStudioContext();
      } catch (error) {
        void vscode.window.showErrorMessage(
          error instanceof Error
            ? error.message
            : 'DRC failed. Confirm kicad-cli is installed and your PCB file is valid.'
        );
      }
    }),
    vscode.commands.registerCommand(COMMANDS.runERC, async (resource?: vscode.Uri) => {
      const file = await resolveTargetFile(resource, '.kicad_sch');
      if (!file) {
        return;
      }
      try {
        const result = await services.checkService.runERC(file);
        services.diagnosticsCollection.set(vscode.Uri.file(file), result.diagnostics);
        services.statusBar.update({ erc: result.summary });
        if (result.diagnostics.length > 0) {
          await vscode.commands.executeCommand('workbench.actions.view.problems');
        }
      } catch (error) {
        void vscode.window.showErrorMessage(
          error instanceof Error
            ? error.message
            : 'ERC failed. Confirm kicad-cli is installed and your schematic file is valid.'
        );
      }
    }),
    vscode.commands.registerCommand(COMMANDS.searchComponent, () =>
      services.componentSearch.search()
    ),
    vscode.commands.registerCommand(COMMANDS.showDiff, (resource?: vscode.Uri) =>
      services.diffEditorProvider.show(resource)
    ),
    vscode.commands.registerCommand(COMMANDS.aiAnalyzeError, () =>
      services.errorAnalyzer.analyzeSelectedError()
    ),
    vscode.commands.registerCommand(COMMANDS.aiProactiveDRC, async () => {
      const latest = services.getLatestDrcRun();
      const provider = await services.aiProviders.getProvider();
      if (!provider?.isConfigured()) {
        void vscode.window.showWarningMessage('AI provider is not configured. Choose a provider and store an API key first.');
        return;
      }
      let drcRun = latest;
      if (!drcRun) {
        const file = await resolveTargetFile(undefined, '.kicad_pcb');
        if (!file) {
          return;
        }
        const result = await services.checkService.runDRC(file);
        drcRun = {
          file,
          diagnostics: result.diagnostics,
          summary: result.summary
        };
        services.setLatestDrcRun(drcRun);
      }
      const rankedDiagnostics = [...drcRun.diagnostics].sort((left, right) => right.severity - left.severity);
      const prompt = buildProactiveDRCPrompt(
        rankedDiagnostics.slice(0, 5).map((diagnostic) => `${diagnostic.code ?? 'rule'}: ${diagnostic.message}`),
        [formatDiagnosticSummary(drcRun.summary), getActiveAiContext().description].filter(Boolean).join('\n')
      );
      const panel = KiCadChatPanel.createOrShow(
        extensionContext,
        services.aiProviders,
        services.logger,
        services.mcpClient
      );
      await panel.submitPrompt('Analyze the latest DRC results and prioritize fixes.', prompt);
    }),
    vscode.commands.registerCommand(COMMANDS.aiExplainCircuit, () =>
      services.circuitExplainer.explainSelection()
    ),
    vscode.commands.registerCommand(COMMANDS.openAiChat, () => {
      KiCadChatPanel.createOrShow(
        extensionContext,
        services.aiProviders,
        services.logger,
        services.mcpClient
      );
    }),
    vscode.commands.registerCommand(COMMANDS.testAiConnection, async () => {
      const provider = await services.aiProviders.getProvider();
      if (!provider?.isConfigured()) {
        services.setAiHealthy(undefined);
        services.statusBar.update({ aiConfigured: false, aiHealthy: undefined });
        void vscode.window.showWarningMessage('AI provider is not configured. Choose a provider and store an API key first.');
        return;
      }
      const result = await provider.testConnection();
      services.setAiHealthy(result.ok);
      services.statusBar.update({ aiConfigured: true, aiHealthy: result.ok });
      if (result.ok) {
        void vscode.window.showInformationMessage(
          `${provider.name} connection OK (${result.latencyMs} ms).`
        );
      } else {
        void vscode.window.showErrorMessage(
          `${provider.name} connection failed after ${result.latencyMs} ms. ${result.error ?? ''}`.trim()
        );
      }
    }),
    vscode.commands.registerCommand(COMMANDS.refreshProjectTree, () =>
      services.treeProvider.refresh()
    ),
    vscode.commands.registerCommand(COMMANDS.searchLibrarySymbol, () =>
      services.librarySearch.searchSymbols()
    ),
    vscode.commands.registerCommand(COMMANDS.searchLibraryFootprint, () =>
      services.librarySearch.searchFootprints()
    ),
    vscode.commands.registerCommand(COMMANDS.reindexLibraries, async () => {
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'KiCad libraries are being reindexed...' },
        (progress) => services.libraryIndexer.indexAll(progress)
      );
      void vscode.window.showInformationMessage('Library index updated.');
    }),
    vscode.commands.registerCommand(COMMANDS.saveExportPreset, () =>
      services.exportService.savePreset()
    ),
    vscode.commands.registerCommand(COMMANDS.runExportPreset, () =>
      services.exportService.runPreset()
    ),
    vscode.commands.registerCommand(COMMANDS.setOctopartApiKey, async () => {
      const value = await vscode.window.showInputBox({
        title: 'Store Octopart/Nexar API key',
        password: true,
        ignoreFocusOut: true
      });
      if (!value) {
        return;
      }
      await services.context.secrets.store(OCTOPART_SECRET_KEY, value);
      void vscode.window.showInformationMessage('Octopart/Nexar API key stored securely.');
    }),
    vscode.commands.registerCommand(COMMANDS.setAiApiKey, async () => {
      const value = await vscode.window.showInputBox({
        title: 'Store AI API key',
        password: true,
        ignoreFocusOut: true
      });
      if (!value) {
        return;
      }
      await services.context.secrets.store(AI_SECRET_KEY, value);
      void vscode.window.showInformationMessage('AI API key stored securely.');
    }),
    vscode.commands.registerCommand(COMMANDS.clearSecrets, async () => {
      await services.context.secrets.delete(AI_SECRET_KEY);
      await services.context.secrets.delete(OCTOPART_SECRET_KEY);
      void vscode.window.showInformationMessage('Stored KiCad Studio secrets cleared.');
    }),
    vscode.commands.registerCommand(COMMANDS.showStoredSecrets, async () => {
      const aiSecret = await services.context.secrets.get(AI_SECRET_KEY);
      const octopartSecret = await services.context.secrets.get(OCTOPART_SECRET_KEY);
      const configured = [
        aiSecret ? 'AI provider key' : undefined,
        octopartSecret ? 'Octopart/Nexar key' : undefined
      ].filter(Boolean);
      void vscode.window.showInformationMessage(
        configured.length
          ? `Stored secrets: ${configured.join(', ')}`
          : 'No KiCad Studio secrets are currently stored.'
      );
    }),
    vscode.commands.registerCommand(COMMANDS.manageChatProvider, async () => {
      const picked = await vscode.window.showQuickPick(
        [
          {
            label: 'Set Claude API key',
            description: 'Store the API key used by the KiCad Studio chat provider.',
            action: 'set-key'
          },
          {
            label: 'Pick Claude model',
            description: 'Choose the model string exposed by the KiCad Studio chat provider.',
            action: 'pick-model'
          },
          {
            label: 'Test chat provider',
            description: 'Verify the configured Claude-backed provider can answer a test request.',
            action: 'test'
          }
        ],
        {
          title: 'Manage KiCad Studio chat provider',
          placeHolder: 'Choose a KiCad Studio Claude provider action'
        }
      );
      if (!picked) {
        return;
      }

      if (picked.action === 'set-key') {
        await vscode.commands.executeCommand(COMMANDS.setAiApiKey);
        return;
      }

      if (picked.action === 'pick-model') {
        const currentModel = vscode.workspace
          .getConfiguration()
          .get<string>(SETTINGS.aiModel, '');
        const model = await vscode.window.showInputBox({
          title: 'Claude model for KiCad Studio chat provider',
          value: currentModel,
          placeHolder: 'claude-sonnet-4-6',
          prompt: 'Leave empty to use the default Claude model.'
        });
        if (typeof model !== 'string') {
          return;
        }

        await vscode.workspace
          .getConfiguration()
          .update(SETTINGS.aiProvider, 'claude', vscode.ConfigurationTarget.Global);
        await vscode.workspace
          .getConfiguration()
          .update(SETTINGS.aiModel, model.trim(), vscode.ConfigurationTarget.Global);
        void vscode.window.showInformationMessage('KiCad Studio chat provider settings updated.');
        return;
      }

      if (picked.action === 'test') {
        await vscode.workspace
          .getConfiguration()
          .update(SETTINGS.aiProvider, 'claude', vscode.ConfigurationTarget.Global);
        await vscode.commands.executeCommand(COMMANDS.testAiConnection);
      }
    }),
    vscode.commands.registerCommand(COMMANDS.setupMcpIntegration, async () => {
      const install = await services.mcpClient.detectInstall();
      if (!install.found) {
        const choice = await vscode.window.showWarningMessage(
          'kicad-mcp-pro could not be detected. Install it first, then rerun setup.',
          'Open Repository'
        );
        if (choice === 'Open Repository') {
          await vscode.env.openExternal(
            vscode.Uri.parse('https://github.com/oaslananka/kicad-mcp-pro')
          );
        }
        return;
      }
      const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!root) {
        void vscode.window.showWarningMessage('Open a workspace folder before configuring MCP integration.');
        return;
      }
      const detector = new McpDetector();
      const profile = await vscode.window.showQuickPick(
        [
          'full',
          'minimal',
          'pcb_only',
          'schematic_only',
          'manufacturing',
          'high_speed',
          'power',
          'simulation',
          'analysis',
          'agent_full'
        ],
        {
          title: 'Select kicad-mcp-pro profile',
          placeHolder: 'Choose the MCP profile to write into .vscode/mcp.json'
        }
      );
      if (!profile) {
        return;
      }
      await detector.generateMcpJson(root, install, profile);
      await services.refreshMcpState();
    }),
    vscode.commands.registerCommand(COMMANDS.openDesignIntent, () => {
      DesignIntentPanel.createOrShow(extensionContext, services.mcpClient);
    }),
    vscode.commands.registerCommand(COMMANDS.refreshFixQueue, () =>
      services.fixQueueProvider.refresh()
    ),
    vscode.commands.registerCommand(COMMANDS.applyFixQueueItem, (item) =>
      services.fixQueueProvider.applyFix(item)
    ),
    vscode.commands.registerCommand(COMMANDS.createVariant, async () => {
      await services.variantProvider.createVariant();
      await services.refreshContexts();
      await services.pushStudioContext();
    }),
    vscode.commands.registerCommand(COMMANDS.setActiveVariant, async (variant) => {
      await services.variantProvider.setActive(variant);
      await services.refreshContexts();
      await services.pushStudioContext();
    }),
    vscode.commands.registerCommand(COMMANDS.diffVariantBom, () =>
      services.variantProvider.diffBom()
    ),
    vscode.commands.registerCommand(COMMANDS.refreshVariants, () =>
      services.variantProvider.refresh()
    ),
    vscode.commands.registerCommand(COMMANDS.revealDrcRule, (item: DrcRuleItem) =>
      services.drcRulesProvider.reveal(item)
    ),
    vscode.commands.registerCommand(COMMANDS.addDrcRuleWithMcp, async () => {
      const state = await services.mcpClient.testConnection();
      if (!state.connected) {
        await vscode.commands.executeCommand(COMMANDS.setupMcpIntegration);
        return;
      }
      await vscode.commands.executeCommand(COMMANDS.openDesignIntent);
    }),
    vscode.commands.registerCommand(COMMANDS.exportViewerSvg, (resource?: vscode.Uri) =>
      services.exportService.exportSVG(resource)
    ),
    vscode.commands.registerCommand(COMMANDS.importPads, () =>
      services.importService.importBoard('pads')
    ),
    vscode.commands.registerCommand(COMMANDS.importAltium, () =>
      services.importService.importBoard('altium')
    ),
    vscode.commands.registerCommand(COMMANDS.importEagle, () =>
      services.importService.importBoard('eagle')
    ),
    vscode.commands.registerCommand(COMMANDS.importCadstar, () =>
      services.importService.importBoard('cadstar')
    ),
    vscode.commands.registerCommand(COMMANDS.importFabmaster, () =>
      services.importService.importBoard('fabmaster')
    ),
    vscode.commands.registerCommand(COMMANDS.importPcad, () =>
      services.importService.importBoard('pcad')
    ),
    vscode.commands.registerCommand(COMMANDS.importSolidworks, () =>
      services.importService.importBoard('solidworks')
    )
  );

  extensionContext.subscriptions.push(...registrations);
}

function getActiveResourceUri(): vscode.Uri | undefined {
  const editorUri = vscode.window.activeTextEditor?.document.uri;
  if (editorUri) {
    return editorUri;
  }

  const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab?.input as
    | { uri?: vscode.Uri }
    | undefined;
  return activeTab?.uri;
}

function resolveKiCadExecutable(filePath: string): { command: string; args: string[] } {
  const configured = vscode.workspace.getConfiguration().get<string>(SETTINGS.kicadPath, '').trim();

  const candidates = getKiCadExecutableCandidates(filePath, configured);
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return { command: candidate, args: [] };
    }
  }

  for (const name of getPreferredKiCadExecutableNames(filePath)) {
    const fromPath = findExecutableOnPath(name);
    if (fromPath) {
      return { command: fromPath, args: [] };
    }
  }

  throw new Error(
    `No KiCad executable was found for ${path.basename(filePath)}. Checked common KiCad install paths and PATH.`
  );
}

function getKiCadExecutableCandidates(filePath: string, configured: string): string[] {
  const names = getPreferredKiCadExecutableNames(filePath);
  const candidates: string[] = [];
  if (configured) {
    candidates.push(...expandConfiguredKiCadPath(configured, names));
  }

  if (process.platform === 'win32') {
    const programFiles = process.env['PROGRAMFILES'] ?? 'C:\\Program Files';
    const programFilesX86 = process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)';
    for (const root of [programFiles, programFilesX86]) {
      for (const version of ['10.0', '10', '9.0', '9', '8.0', '8', '7.0', '7', '6.0', '6']) {
        for (const name of names) {
          candidates.push(path.join(root, 'KiCad', version, 'bin', name));
        }
      }
    }
  } else if (process.platform === 'darwin') {
    candidates.push(
      '/Applications/KiCad/KiCad.app/Contents/MacOS/kicad',
      '/usr/local/bin/kicad',
      '/opt/homebrew/bin/kicad'
    );
  } else {
    for (const name of names) {
      candidates.push(
        path.join('/usr/bin', name),
        path.join('/usr/local/bin', name),
        path.join('/snap/bin', name)
      );
    }
  }

  return [...new Set(candidates)];
}

function expandConfiguredKiCadPath(configured: string, names: string[]): string[] {
  if (!fs.existsSync(configured)) {
    return [configured];
  }
  const stat = fs.statSync(configured);
  if (!stat.isDirectory()) {
    return [configured];
  }
  if (process.platform === 'darwin' && configured.endsWith('.app')) {
    return [path.join(configured, 'Contents', 'MacOS', 'kicad')];
  }
  return names.flatMap((name) => [path.join(configured, name), path.join(configured, 'bin', name)]);
}

function getPreferredKiCadExecutableNames(filePath: string): string[] {
  const extension = path.extname(filePath).toLowerCase();
  if (process.platform === 'win32') {
    if (extension === '.kicad_sch') {
      return ['eeschema.exe', 'kicad.exe'];
    }
    if (extension === '.kicad_pcb') {
      return ['pcbnew.exe', 'kicad.exe'];
    }
    return ['kicad.exe'];
  }
  if (process.platform === 'darwin') {
    return ['kicad'];
  }
  if (extension === '.kicad_sch') {
    return ['eeschema', 'kicad'];
  }
  if (extension === '.kicad_pcb') {
    return ['pcbnew', 'kicad'];
  }
  return ['kicad'];
}

function findExecutableOnPath(name: string): string | undefined {
  const finder = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(finder, [name], { encoding: 'utf8' });
  if (result.status !== 0) {
    return undefined;
  }
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
}

function launchDetached(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: 'ignore'
    });
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
    child.once('error', reject);
  });
}

async function resolveTargetFile(resource: vscode.Uri | undefined, extname: string): Promise<string | undefined> {
  if (resource?.fsPath.endsWith(extname)) {
    return resource.fsPath;
  }
  const active = getActiveResourceUri();
  if (active?.fsPath.endsWith(extname)) {
    return active.fsPath;
  }
  const files = await vscode.workspace.findFiles(`**/*${extname}`, '**/node_modules/**', 1);
  return files[0]?.fsPath;
}

async function workspaceHasVariants(): Promise<boolean> {
  const projectFile = await findFirstWorkspaceFile('**/*.kicad_pro');
  if (!projectFile) {
    return false;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(projectFile, 'utf8')) as {
      variants?: unknown[];
      design_variants?: unknown[];
    };
    return (
      (Array.isArray(parsed.variants) && parsed.variants.length > 0) ||
      (Array.isArray(parsed.design_variants) && parsed.design_variants.length > 0)
    );
  } catch {
    return false;
  }
}
