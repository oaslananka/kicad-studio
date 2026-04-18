import * as vscode from 'vscode';
import { COMMANDS } from '../constants';
import type { CommandServices } from './types';

/**
 * Register all export and import related commands.
 */
export function registerExportCommands(services: CommandServices): vscode.Disposable[] {
  return [
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
    vscode.commands.registerCommand(COMMANDS.exportViewerSvg, (resource?: vscode.Uri) =>
      services.exportService.exportSVG(resource)
    ),
    vscode.commands.registerCommand(COMMANDS.saveExportPreset, () =>
      services.exportService.savePreset()
    ),
    vscode.commands.registerCommand(COMMANDS.runExportPreset, () =>
      services.exportService.runPreset()
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
  ];
}
