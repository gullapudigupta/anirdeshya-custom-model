import ts from "typescript";
import { readWorkspaceFile, type ReadFileResult } from "../repository/read-file";
import type { EvidenceSource } from "../tracing/evidence-graph";

export interface FocusedEvidence extends EvidenceSource {
  symbol?: string;
  inputs: string[];
  outputs: string[];
  dependencies: string[];
  sideEffects: string[];
  asynchronous: boolean;
  errors: string[];
}

export async function captureFocusedEvidence(root: string, file: string, startLine: number, endLine: number, symbolName?: string): Promise<FocusedEvidence> {
  const read = await readWorkspaceFile(root, file, { startLine, endLine, maxLines: 300 });
  return analyzeReadRegion(read, symbolName);
}

export function analyzeReadRegion(read: ReadFileResult, symbolName?: string): FocusedEvidence {
  const source = ts.createSourceFile(read.file, read.text, ts.ScriptTarget.Latest, true);
  let focused: ts.Node = source;
  if (symbolName) {
    const declarations: ts.Node[] = [];
    const visit = (node: ts.Node): void => {
      if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isClassDeclaration(node))
        && node.name?.getText(source) === symbolName) declarations.push(node);
      ts.forEachChild(node, visit);
    };
    visit(source);
    if (declarations.length) focused = declarations[0];
  }
  const start = focused === source ? 0 : focused.getStart(source);
  const end = focused === source ? read.text.length : focused.getEnd();
  const text = read.text.slice(start, end);
  const inputs = new Set<string>();
  const outputs = new Set<string>();
  const dependencies = new Set<string>();
  const sideEffects = new Set<string>();
  const errors = new Set<string>();
  let asynchronous = false;
  const visit = (node: ts.Node): void => {
    if (ts.isParameter(node) && ts.isIdentifier(node.name)) inputs.add(node.name.text);
    if (ts.isReturnStatement(node)) outputs.add(node.expression?.getText(source) ?? "return");
    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText(source);
      dependencies.add(callee);
      if (/^(save|write|insert|update|delete|remove|emit|publish|send|dispatch|commit)/i.test(callee.split(".").at(-1) ?? "")) sideEffects.add(callee);
    }
    if (ts.isAwaitExpression(node)) asynchronous = true;
    if (ts.isThrowStatement(node) || ts.isCatchClause(node)) errors.add(node.getText(source));
    ts.forEachChild(node, visit);
  };
  visit(focused);
  const startLine = read.startLine + source.getLineAndCharacterOfPosition(start).line;
  const endLine = read.startLine + source.getLineAndCharacterOfPosition(Math.max(start, end - 1)).line;
  return {
    file: read.file,
    startLine,
    endLine,
    text,
    ...(symbolName && focused !== source ? { symbol: symbolName } : {}),
    inputs: [...inputs].sort(),
    outputs: [...outputs].sort(),
    dependencies: [...dependencies].sort(),
    sideEffects: [...sideEffects].sort(),
    asynchronous,
    errors: [...errors].sort(),
  };
}