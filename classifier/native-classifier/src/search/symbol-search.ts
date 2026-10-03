import { readFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import { listFiles } from "./file-search";

export type SymbolKind = "function" | "method" | "class" | "interface" | "variable" | "property" | "type" | "enum";
export interface SymbolLocation {
  name: string;
  kind: SymbolKind;
  file: string;
  line: number;
  column: number;
  isDefinition: boolean;
}

export interface TypeScriptSymbolProvider {
  findSymbol(root: string, symbol: string, limit?: number): Promise<SymbolLocation[]>;
  findReferences(root: string, symbol: string, includeDefinition?: boolean, limit?: number): Promise<SymbolLocation[]>;
  findImplementations(root: string, symbol: string, limit?: number): Promise<SymbolLocation[]>;
}

function declarationKind(node: ts.Node): SymbolKind | undefined {
  if (ts.isFunctionDeclaration(node)) return "function";
  if (ts.isMethodDeclaration(node)) return "method";
  if (ts.isClassDeclaration(node)) return "class";
  if (ts.isInterfaceDeclaration(node)) return "interface";
  if (ts.isVariableDeclaration(node)) return "variable";
  if (ts.isPropertyDeclaration(node) || ts.isPropertySignature(node)) return "property";
  if (ts.isTypeAliasDeclaration(node)) return "type";
  if (ts.isEnumDeclaration(node)) return "enum";
  return undefined;
}

function isDeclarationName(node: ts.Identifier): boolean {
  const parent = node.parent;
  return Boolean(("name" in parent && parent.name === node && declarationKind(parent))
    || (ts.isParameter(parent) && parent.name === node)
    || (ts.isImportSpecifier(parent) && parent.name === node)
    || (ts.isExportSpecifier(parent) && parent.name === node));
}

async function sourceFiles(root: string, limit = 2_000): Promise<Array<{ file: string; source: ts.SourceFile }>> {
  const files = await listFiles(root, { include: ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"], limit });
  const output: Array<{ file: string; source: ts.SourceFile }> = [];
  for (const file of files) {
    try {
      const text = await readFile(path.join(root, file), "utf8");
      if (Buffer.byteLength(text) <= 2_000_000 && !text.includes("\0")) output.push({ file, source: ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true) });
    } catch { /* Files can disappear while a bounded scan is running. */ }
  }
  return output;
}

export class TypeScriptAstSymbolProvider implements TypeScriptSymbolProvider {
  async findSymbol(root: string, symbol: string, limit = 100): Promise<SymbolLocation[]> {
    const results: SymbolLocation[] = [];
    for (const { file, source } of await sourceFiles(root)) {
      const visit = (node: ts.Node): void => {
        const kind = declarationKind(node);
        const declarationName = (node as ts.Node & { name?: ts.Node }).name;
        const name = declarationName && ts.isIdentifier(declarationName) ? declarationName : undefined;
        if (kind && name?.text === symbol) {
          const location = source.getLineAndCharacterOfPosition(name.getStart(source));
          results.push({ name: symbol, kind, file, line: location.line + 1, column: location.character + 1, isDefinition: true });
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
      if (results.length >= limit) return results.slice(0, limit);
    }
    return results;
  }

  async findReferences(root: string, symbol: string, includeDefinition = false, limit = 500): Promise<SymbolLocation[]> {
    const definitions = await this.findSymbol(root, symbol, limit);
    const definitionLocations = new Set(definitions.map((item) => `${item.file}:${item.line}:${item.column}`));
    const results = includeDefinition ? [...definitions] : [];
    for (const { file, source } of await sourceFiles(root)) {
      const visit = (node: ts.Node): void => {
        if (ts.isIdentifier(node) && node.text === symbol && !isDeclarationName(node)) {
          const location = source.getLineAndCharacterOfPosition(node.getStart(source));
          const reference = { name: symbol, kind: "variable" as const, file, line: location.line + 1, column: location.character + 1, isDefinition: false };
          if (!definitionLocations.has(`${file}:${reference.line}:${reference.column}`)) results.push(reference);
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
      if (results.length >= limit) break;
    }
    return results.slice(0, limit).sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column);
  }

  async findImplementations(root: string, symbol: string, limit = 100): Promise<SymbolLocation[]> {
    const output: SymbolLocation[] = [];
    for (const { file, source } of await sourceFiles(root)) {
      const visit = (node: ts.Node): void => {
        if (ts.isClassDeclaration(node) && node.heritageClauses?.some((clause) => clause.token === ts.SyntaxKind.ImplementsKeyword
          && clause.types.some((type) => type.expression.getText(source).split(".").at(-1) === symbol))) {
          for (const member of node.members) {
            if (!("name" in member) || !member.name || !ts.isIdentifier(member.name)) continue;
            const location = source.getLineAndCharacterOfPosition(member.name.getStart(source));
            output.push({ name: member.name.text, kind: declarationKind(member) ?? "method", file, line: location.line + 1, column: location.character + 1, isDefinition: true });
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
      if (output.length >= limit) break;
    }
    return output.slice(0, limit);
  }
}