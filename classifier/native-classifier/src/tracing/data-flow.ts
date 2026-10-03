import ts from "typescript";
import { z } from "zod";
import type { EvidenceSource } from "./evidence-graph";

export const dataFlowStepSchema = z.object({
  kind: z.enum(["mapping", "validation", "default", "generated_field", "serialization", "dropped_field", "side_effect", "error"]),
  expression: z.string().min(1),
  source: z.string().optional(),
  target: z.string().optional(),
  evidence: z.object({ file: z.string(), startLine: z.number(), endLine: z.number(), text: z.string() }).strict(),
  status: z.enum(["verified", "inferred"]),
}).strict();
export type DataFlowStep = z.infer<typeof dataFlowStepSchema>;

export function traceDataFlow(regions: readonly EvidenceSource[], maxSteps = 500): DataFlowStep[] {
  const steps: DataFlowStep[] = [];
  for (const region of regions) {
    const source = ts.createSourceFile(region.file, region.text, ts.ScriptTarget.Latest, true);
    const push = (kind: DataFlowStep["kind"], node: ts.Node, expression: string, from?: string, to?: string) => {
      const line = region.startLine + source.getLineAndCharacterOfPosition(node.getStart(source)).line;
      steps.push({ kind, expression: expression.slice(0, 1_000), ...(from ? { source: from } : {}), ...(to ? { target: to } : {}), status: "verified", evidence: { file: region.file, startLine: line, endLine: line, text: node.getText(source).slice(0, 1_000) } });
    };
    const visit = (node: ts.Node): void => {
      if (steps.length >= maxSteps) return;
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
        push("mapping", node, node.getText(source), node.right.getText(source), node.left.getText(source));
      } else if (ts.isCallExpression(node)) {
        const name = node.expression.getText(source).split(".").at(-1)?.toLowerCase() ?? "";
        const kind = /valid|parse|schema|assert/.test(name) ? "validation"
          : /serializ|stringify|encode|json/.test(name) ? "serialization"
            : /save|write|insert|update|delete|commit|dispatch|emit/.test(name) ? "side_effect" : undefined;
        if (kind) push(kind, node, node.getText(source));
      } else if (ts.isThrowStatement(node) || ts.isCatchClause(node)) {
        push("error", node, node.getText(source));
      } else if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && /^(id|createdAt|updatedAt|timestamp)$/i.test(node.name.text)) {
        push("generated_field", node, node.getText(source), undefined, node.name.text);
      } else if (ts.isPropertyAssignment(node) && ts.isBinaryExpression(node.initializer) && node.initializer.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
        push("default", node, node.getText(source), node.initializer.left.getText(source), node.name.getText(source));
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    if (steps.length >= maxSteps) break;
  }
  return steps;
}