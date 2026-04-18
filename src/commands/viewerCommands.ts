import * as vscode from 'vscode';
import { COMMANDS, PCB_EDITOR_VIEW_TYPE, SCHEMATIC_EDITOR_VIEW_TYPE, SETTINGS } from '../constants';
import type { DrcRuleItem } from '../drc/drcRulesProvider';
import { getActiveResourceUri } from '../utils/workspaceUtils';
import { resolveKiCadExecutable, launchDetached } from './kicadLauncher';
import type { CommandServices } from './types';

/**
 * Register viewer, tree, library, variant, and general navigation commands.
 */
export function registerViewerCommands(services: CommandServices): vscode.Disposable[] {
  return [
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
          {
            label: '$(archive) Export Manufacturing Package',
            command: COMMANDS.exportManufacturingPackage
          },
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

    vscode.commands.registerCommand(COMMANDS.searchComponent, () =>
      services.componentSearch.search()
    ),

    vscode.commands.registerCommand(COMMANDS.showDiff, (resource?: vscode.Uri) =>
      services.diffEditorProvider.show(resource)
    ),

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
        {
          location: vscode.ProgressLocation.Notification,
          title: 'KiCad libraries are being reindexed...'
        },
        (progress) => services.libraryIndexer.indexAll(progress)
      );
      void vscode.window.showInformationMessage('Library index updated.');
    }),

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
    )
  ];
}
