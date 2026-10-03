import { z } from "zod";
import { EvidenceGraph, type UnresolvedLink } from "./evidence-graph";

export const analysisGapSchema = z.object({
  id: z.string(),
  kind: z.enum(["implementation", "route_prefix", "event_handler", "dependency_injection", "external_repository", "dynamic_dispatch", "external_api", "other"]),
  whyItMatters: z.string(),
  evidence: z.array(z.object({ file: z.string(), startLine: z.number(), endLine: z.number(), text: z.string() }).strict()),
  query: z.string(),
  tool: z.string(),
}).strict();
export type AnalysisGap = z.infer<typeof analysisGapSchema>;

function classify(link: UnresolvedLink): AnalysisGap["kind"] {
  const value = `${link.relation} ${link.targetHint} ${link.reason}`.toLowerCase();
  if (value.includes("implement")) return "implementation";
  if (value.includes("prefix") || value.includes("route")) return "route_prefix";
  if (value.includes("event") || value.includes("handler")) return "event_handler";
  if (value.includes("inject") || value.includes("binding")) return "dependency_injection";
  if (value.includes("repository") || value.includes("database")) return "external_repository";
  if (value.includes("dynamic") || value.includes("dispatch")) return "dynamic_dispatch";
  if (value.includes("external api") || value.includes("external_api")) return "external_api";
  return "other";
}

export function detectGaps(graph: EvidenceGraph): AnalysisGap[] {
  const gaps = new Map<string, AnalysisGap>();
  for (const link of graph.toJSON().unresolved) {
    const kind = classify(link);
    const gap = analysisGapSchema.parse({
      id: link.id,
      kind,
      whyItMatters: link.reason,
      evidence: link.evidence,
      query: link.query,
      tool: link.suggestedTool,
    });
    const key = `${gap.kind}:${gap.query.toLowerCase()}:${gap.tool}`;
    if (!gaps.has(key)) gaps.set(key, gap);
  }
  return [...gaps.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.query.localeCompare(b.query));
}