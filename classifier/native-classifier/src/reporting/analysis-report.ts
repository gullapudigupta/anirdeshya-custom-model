import { z } from "zod";
import type { AnalysisRequest } from "../analysis/analysis-request";
import type { CompletionDecision } from "../analysis/completion-policy";
import type { EvidenceGraphData } from "../tracing/evidence-graph";
import { buildEvidenceCitations, type EvidenceCitation } from "./evidence-citations";
import { redactSecrets } from "./secret-redactor";

const claimSchema = z.object({ text: z.string().min(1), evidenceIds: z.array(z.string().min(1)).min(1), status: z.enum(["verified", "inferred"]) }).strict();
export const analysisReportSchema = z.object({
  requestId: z.string(),
  mode: z.string(),
  status: z.enum(["completed", "incomplete", "needs_clarification", "cancelled"]),
  summary: z.string(),
  claims: z.array(claimSchema),
  orderedFlow: z.array(claimSchema),
  transformations: z.array(claimSchema),
  relevantFiles: z.array(z.string()),
  uncertainty: z.array(z.string()),
  unresolvedGaps: z.array(z.object({ target: z.string(), reason: z.string(), query: z.string(), tool: z.string() }).strict()),
  citations: z.array(z.object({ id: z.string(), file: z.string(), startLine: z.number(), endLine: z.number(), text: z.string(), status: z.enum(["verified", "inferred"]) }).strict()),
}).strict();
export type AnalysisReport = z.infer<typeof analysisReportSchema>;

export function buildAnalysisReport(request: AnalysisRequest, completion: CompletionDecision, graph: EvidenceGraphData): AnalysisReport {
  const citations = buildEvidenceCitations(graph);
  const ids = new Set([...graph.nodes.map((node) => node.id), ...graph.edges.map((edge) => edge.id), ...graph.unresolved.map((link) => link.id)]);
  const claims: AnalysisReport["claims"] = [];
  const orderedFlow: AnalysisReport["orderedFlow"] = [];
  const transformations: AnalysisReport["transformations"] = [];
  for (const edge of graph.edges) {
    const from = graph.nodes.find((node) => node.id === edge.from)?.label ?? edge.from;
    const to = graph.nodes.find((node) => node.id === edge.to)?.label ?? edge.to;
    const status = edge.status;
    const text = redactSecrets(`${from} ${edge.kind.replace(/_/g, " ")} ${to}`);
    const claim = { text, evidenceIds: [edge.id], status };
    claims.push(claim);
    orderedFlow.push(claim);
  }
  for (const node of graph.nodes) {
    const summary = `${node.kind.replace(/_/g, " ")}: ${node.label}`;
    claims.push({ text: redactSecrets(summary), evidenceIds: [node.id], status: node.status });
  }
  for (const unresolved of graph.unresolved) {
    claims.push({ text: redactSecrets(`Unresolved ${unresolved.relation} relationship to ${unresolved.targetHint}`), evidenceIds: [unresolved.id], status: "inferred" });
  }
  const summaryEvidenceIds = claims.length ? claims.slice(0, Math.min(3, claims.length)).flatMap((claim) => claim.evidenceIds) : [];
  if (summaryEvidenceIds.length) claims.unshift({ text: redactSecrets(completion.reason), evidenceIds: summaryEvidenceIds, status: "verified" });
  const uncertainty = [completion.reason, ...graph.unresolved.map((link) => `${link.targetHint}: ${link.reason}`)].map(redactSecrets);
  const report = analysisReportSchema.parse({
    requestId: request.requestId,
    mode: request.mode,
    status: completion.status,
    summary: redactSecrets(completion.reason),
    claims,
    orderedFlow,
    transformations,
    relevantFiles: [...new Set(citations.map((citation) => citation.file))].sort(),
    uncertainty,
    unresolvedGaps: graph.unresolved.map((link) => ({ target: redactSecrets(link.targetHint), reason: redactSecrets(link.reason), query: redactSecrets(link.query), tool: link.suggestedTool })),
    citations,
  });
  assertReportEvidence(report, ids);
  return report;
}

export function assertReportEvidence(report: AnalysisReport, evidenceIds: ReadonlySet<string>): void {
  const factualClaims = [...report.claims, ...report.orderedFlow, ...report.transformations];
  for (const claim of factualClaims) {
    if (claim.evidenceIds.length === 0 || claim.evidenceIds.some((id) => !evidenceIds.has(id))) throw new Error(`Report claim lacks graph evidence: ${claim.text}`);
  }
}