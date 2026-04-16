import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { VariantProvider } from '../../src/variants/variantProvider';
import { window, workspace } from './vscodeMock';

describe('VariantProvider', () => {
  let tempDir: string;
  let projectFile: string;

  beforeEach(() => {
    jest.clearAllMocks();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kicadstudio-variants-'));
    projectFile = path.join(tempDir, 'variants.kicad_pro');
    fs.writeFileSync(
      projectFile,
      JSON.stringify(
        {
          activeVariant: 'Default',
          variants: [
            {
              name: 'Default',
              isDefault: true,
              componentOverrides: []
            },
            {
              name: 'No-RF',
              isDefault: false,
              componentOverrides: [
                {
                  reference: 'U7',
                  enabled: false,
                  valueOverride: 'DNP'
                }
              ]
            }
          ]
        },
        null,
        2
      ),
      'utf8'
    );

    (workspace.findFiles as jest.Mock).mockResolvedValue([vscode.Uri.file(projectFile)]);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('loads variants from a KiCad 10 project file', async () => {
    const provider = new VariantProvider();
    const variants = await provider.getChildren();

    expect(variants).toHaveLength(2);
    expect(provider.getActiveVariantName()).resolves.toBe('Default');

    const firstVariant = variants[0];
    if (!firstVariant || !('componentOverrides' in firstVariant)) {
      throw new Error('Expected the first item to be a KiCad variant.');
    }
    expect(firstVariant.name).toBe('Default');

    const secondVariant = variants[1];
    if (!secondVariant || !('componentOverrides' in secondVariant)) {
      throw new Error('Expected the second item to be a KiCad variant.');
    }
    expect(secondVariant.componentOverrides).toHaveLength(1);
  });

  it('creates a new variant entry', async () => {
    const provider = new VariantProvider();
    (window.showInputBox as jest.Mock).mockResolvedValue('Assembly-B');

    await provider.createVariant();

    const saved = JSON.parse(fs.readFileSync(projectFile, 'utf8')) as {
      variants: Array<{ name: string }>;
    };
    expect(saved.variants.map((item) => item.name)).toContain('Assembly-B');
  });

  it('updates the active variant in the project file', async () => {
    const provider = new VariantProvider();

    await provider.setActive({
      name: 'No-RF',
      isDefault: false,
      componentOverrides: []
    });

    const saved = JSON.parse(fs.readFileSync(projectFile, 'utf8')) as {
      activeVariant: string;
      variants: Array<{ name: string; isDefault: boolean }>;
    };
    expect(saved.activeVariant).toBe('No-RF');
    expect(saved.variants.find((item) => item.name === 'No-RF')?.isDefault).toBe(true);
    expect(saved.variants.find((item) => item.name === 'Default')?.isDefault).toBe(false);
  });

  it('builds tree items for variants and override rows', async () => {
    const provider = new VariantProvider();
    const [firstVariant] = await provider.getChildren();
    if (!firstVariant || !('componentOverrides' in firstVariant)) {
      throw new Error('Expected a variant item.');
    }

    const variantTreeItem = provider.getTreeItem(firstVariant);
    expect(variantTreeItem.label).toBe('Default');
    expect(variantTreeItem.contextValue).toBe('variant-default');

    const overrides = await provider.getChildren({
      name: 'No-RF',
      isDefault: false,
      componentOverrides: [
        {
          reference: 'U7',
          enabled: false,
          valueOverride: 'DNP',
          footprintOverride: 'Connector:TestPoint'
        }
      ]
    });
    const [override] = overrides;
    if (!override || 'componentOverrides' in override) {
      throw new Error('Expected a variant override item.');
    }

    const overrideTreeItem = provider.getTreeItem(override);
    expect(overrideTreeItem.label).toBe('U7');
    expect(overrideTreeItem.description).toContain('disabled');
    expect(overrideTreeItem.description).toContain('value=DNP');
    expect(overrideTreeItem.description).toContain('footprint=Connector:TestPoint');
  });

  it('shows a helpful message when comparing BOMs without enough variants', async () => {
    fs.writeFileSync(
      projectFile,
      JSON.stringify(
        {
          activeVariant: 'Only',
          variants: [{ name: 'Only', isDefault: true, componentOverrides: [] }]
        },
        null,
        2
      ),
      'utf8'
    );
    const provider = new VariantProvider();

    await provider.diffBom();

    expect(window.showInformationMessage).toHaveBeenCalledWith(
      'At least two variants are required to compare BOM differences.'
    );
  });

  it('compares two variants and reports BOM override differences', async () => {
    const provider = new VariantProvider();
    (window.showQuickPick as jest.Mock)
      .mockResolvedValueOnce('Default')
      .mockResolvedValueOnce('No-RF');

    await provider.diffBom();

    expect(window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('Variant BOM diff'),
      { modal: true }
    );
  });

  it('normalizes design_variants when no explicit default is stored', async () => {
    fs.writeFileSync(
      projectFile,
      JSON.stringify(
        {
          design_variants: [
            {
              name: 'Assembly-A',
              overrides: [
                {
                  reference: 'R1',
                  enabled: true,
                  value: '4k7',
                  footprint: 'Resistor_SMD:R_0603_1608Metric'
                }
              ]
            }
          ]
        },
        null,
        2
      ),
      'utf8'
    );
    const provider = new VariantProvider();

    const [variant] = await provider.getChildren();
    if (!variant || !('componentOverrides' in variant)) {
      throw new Error('Expected a normalized design variant item.');
    }

    expect(variant.isDefault).toBe(true);
    expect(variant.componentOverrides[0]?.valueOverride).toBe('4k7');
    expect(variant.componentOverrides[0]?.footprintOverride).toBe(
      'Resistor_SMD:R_0603_1608Metric'
    );
  });

  it('returns no children for a leaf override item', async () => {
    const provider = new VariantProvider();

    const children = await provider.getChildren({
      reference: 'R1',
      enabled: true
    });

    expect(children).toEqual([]);
  });

  it('lists variants and looks them up by name', async () => {
    const provider = new VariantProvider();

    await expect(provider.listVariants()).resolves.toHaveLength(2);
    await expect(provider.getVariantByName('No-RF')).resolves.toEqual(
      expect.objectContaining({ name: 'No-RF' })
    );
  });

  it('falls back to a synthetic Default variant when the project has none yet', async () => {
    fs.writeFileSync(projectFile, JSON.stringify({}, null, 2), 'utf8');
    const provider = new VariantProvider();

    const [variant] = await provider.getChildren();
    if (!variant || !('componentOverrides' in variant)) {
      throw new Error('Expected a fallback default variant.');
    }

    expect(variant.name).toBe('Default');
    expect(variant.isDefault).toBe(true);
  });

  it('does not create a variant when the input is blank', async () => {
    const provider = new VariantProvider();
    const before = fs.readFileSync(projectFile, 'utf8');
    (window.showInputBox as jest.Mock).mockResolvedValue('   ');

    await provider.createVariant();

    expect(fs.readFileSync(projectFile, 'utf8')).toBe(before);
  });

  it('stops BOM comparison when the user cancels a quick pick', async () => {
    const provider = new VariantProvider();
    (window.showQuickPick as jest.Mock).mockResolvedValue(undefined);

    await provider.diffBom();

    expect(window.showInformationMessage).not.toHaveBeenCalledWith(
      expect.stringContaining('Variant BOM diff'),
      { modal: true }
    );
  });
});
