import ts from "typescript";
import { z } from "zod";
import type { EvidenceSource } from "./evidence-graph";

export const traceBudgetSchema = z.object({ maxDepth: z.number().int().min(0).max(20), maxNodes: z.number().int().min(1).max(5_000), maxFiles: z.number().int().min(1).max(2_000), maxLines: z.number().int().min(1).max(20_000) }).strict();
export const traceStepSchema = z.object({
  from: z.string(), to: z.string(), arguments: z.array(z.string()), asynchronous: z.boolean(),
  status: z.enum(["verified", "inferred", "unresolved"]), evidence: z.object({ file: z.string(), startLine: z.number(), endLine: z.number(), text: z.string() }).strict(),
}).strict();
export type TraceBudget = z.infer<typeof traceBudgetSchema>;
export type CallTraceStep = z.infer<typeof traceStepSchema>;
export const defaultTraceBudget: TraceBudget = { maxDepth: 5, maxNodes: 200, maxFiles: 50, maxLines: 2_000 };

export function traceCalls(regions: readonly EvidenceSource[], knownSymbols: ReadonlySet<string>, budget: TraceBudget = defaultTraceBudget): CallTraceStep[] {
  const steps: CallTraceStep[] = [];
  let visitedLines = 0;
  for (const region of regions.slice(0, budget.maxFiles)) {
    const source = ts.createSourceFile(region.file, region.text, ts.ScriptTarget.Latest, true);
    const containingName = region.text.match(/\b(?:function|class)\s+([A-Za-z_$][\w$]*)/)?.[1] ?? region.file;
    const visit = (node: ts.Node): void => {
      if (steps.length >= budget.maxNodes || visitedLines >= budget.maxLines) return;
      visitedLines += Math.max(1, source.getLineAndCharacterOfPosition(node.getEnd()).line - source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1);
      if (ts.isCallExpression(node)) {
        const to = node.expression.getText(source);
        const lineOffset = source.getLineAndCharacterOfPosition(node.getStart(source)).line;
        const line = region.startLine + lineOffset;
        const awaitCall = ts.isAwaitExpression(node.parent);
        const target = to.split(".").at(-1) ?? to;
        steps.push(traceStepSchema.parse({
          from: containingName, to, arguments: node.arguments.map((argument) => argument.getText(source)), asynchronous: awaitCall,
          status: knownSymbols.has(target) ? "verified" : (to.includes(".") ? "inferred" : "unresolved"),
          evidence: { file: region.file, startLine: line, endLine: line, text: node.getText(source).slice(0, 1_000) },
        }));
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    if (steps.length >= budget.maxNodes || visitedLines >= budget.maxLines) break;
  }
  return steps;
}