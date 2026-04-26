import * as vscode from 'vscode';
import { KICAD_S_EXPRESSION_LANGUAGES } from '../constants';
import { KEYWORD_DESCRIPTIONS } from './kicadSchemas';
import { SExpressionParser, type SNode } from './sExpressionParser';

const S_EXPRESSION_LANGUAGE_IDS = new Set<string>(KICAD_S_EXPRESSION_LANGUAGES);

export class KiCadDiagnosticsProvider {
  constructor(
    private readonly parser: SExpressionParser,
    private readonly diagnostics: vscode.DiagnosticCollection
  ) {}

  update(document: vscode.TextDocument): void {
    if (!S_EXPRESSION_LANGUAGE_IDS.has(document.languageId)) {
      return;
    }

    try {
      const ast = this.parser.parse(document.getText());
      const issues: vscode.Diagnostic[] = [];
      for (const error of this.parser.getErrors(ast)) {
        issues.push(
          new vscode.Diagnostic(
            new vscode.Range(
              error.line,
              error.col,
              error.endLine,
              error.endCol
            ),
            error.message,
            vscode.DiagnosticSeverity.Error
          )
        );
      }

      const schema = new Set(
        (KEYWORD_DESCRIPTIONS[document.languageId] ?? new Map()).keys()
      );
      this.collectUnknownTags(ast, issues, schema);
      this.diagnostics.set(document.uri, issues);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unable to analyze this KiCad file. Try saving again or checking the file for malformed S-expressions.';
      const range = new vscode.Range(0, 0, 0, 1);
      this.diagnostics.set(document.uri, [
        new vscode.Diagnostic(range, message, vscode.DiagnosticSeverity.Warning)
      ]);
    }
  }

  private collectUnknownTags(
    node: SNode,
    issues: vscode.Diagnostic[],
    schema: Set<string>
  ): void {
    const tag = this.getTag(node);
    if (tag && !schema.has(tag) && !this.isSafeTag(tag)) {
      const range = this.parser.getPosition(node);
      issues.push(
        new vscode.Diagnostic(
          range,
          `Unknown KiCad node "${tag}". Check for typos or version-specific syntax.`,
          vscode.DiagnosticSeverity.Information
        )
      );
    }
    node.children?.forEach((child) =>
      this.collectUnknownTags(child, issues, schema)
    );
  }

  private getTag(node: SNode): string | undefined {
    if (node.type !== 'list' || !node.children?.length) {
      return undefined;
    }
    const first = node.children[0];
    if (!first) {
      return undefined;
    }
    return first.type === 'atom' || first.type === 'string'
      ? String(first.value ?? '')
      : undefined;
  }

  private isSafeTag(tag: string): boolean {
    return (
      /^[0-9.-]+$/.test(tag) ||
      /^[FB]\.[A-Za-z0-9_.]+$/.test(tag) ||
      /^In\d+\.Cu$/.test(tag) ||
      tag.startsWith('${')
    );
  }
}
