import { z } from "zod";

export const evidenceSourceSchema = z.object({ file: z.string().min(1), startLine: z.number().int().min(1), endLine: z.number().int().min(1), text: z.string().max(20_000) }).strict();
export const evidenceNodeSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["file", "symbol", "route", "event", "database", "external_api"]),
  label: z.string().min(1),
  status: z.enum(["verified", "inferred"]),
  confidence: z.number().min(0).max(1),
  evidence: z.array(evidenceSourceSchema).min(1),
}).strict();
export const evidenceEdgeSchema = z.object({
  id: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
  kind: z.enum(["calls", "imports", "emits", "handles", "reads", "writes", "routes_to", "injects"]),
  status: z.enum(["verified", "inferred"]),
  confidence: z.number().min(0).max(1),
  evidence: z.array(evidenceSourceSchema).min(1),
}).strict();
export const unresolvedLinkSchema = z.object({
  id: z.string().min(1),
  from: z.string().min(1),
  relation: z.string().min(1),
  targetHint: z.string().min(1),
  reason: z.string().min(1),
  evidence: z.array(evidenceSourceSchema).min(1),
  suggestedTool: z.string().min(1),
  query: z.string().min(1),
}).strict();
export const evidenceGraphSchema = z.object({
  nodes: z.array(evidenceNodeSchema),
  edges: z.array(evidenceEdgeSchema),
  unresolved: z.array(unresolvedLinkSchema),
}).strict();

export type EvidenceSource = z.infer<typeof evidenceSourceSchema>;
export type EvidenceNode = z.infer<typeof evidenceNodeSchema>;
export type EvidenceEdge = z.infer<typeof evidenceEdgeSchema>;
export type UnresolvedLink = z.infer<typeof unresolvedLinkSchema>;
export type EvidenceGraphData = z.infer<typeof evidenceGraphSchema>;

function mergeSources(first: EvidenceSource[], second: EvidenceSource[]): EvidenceSource[] {
  const map = new Map<string, EvidenceSource>();
  for (const source of [...first, ...second]) map.set(`${source.file}:${source.startLine}:${source.endLine}`, source);
  return [...map.values()].sort((a, b) => a.file.localeCompare(b.file) || a.startLine - b.startLine || a.endLine - b.endLine);
}

export class EvidenceGraph {
  private readonly nodes = new Map<string, EvidenceNode>();
  private readonly edges = new Map<string, EvidenceEdge>();
  private readonly unresolved = new Map<string, UnresolvedLink>();

  addNode(node: EvidenceNode): void {
    const valid = evidenceNodeSchema.parse(node);
    const existing = this.nodes.get(valid.id);
    this.nodes.set(valid.id, existing ? {
      ...existing,
      status: existing.status === "verified" || valid.status === "verified" ? "verified" : "inferred",
      confidence: Math.max(existing.confidence, valid.confidence),
      evidence: mergeSources(existing.evidence, valid.evidence),
    } : valid);
  }

  addEdge(edge: EvidenceEdge): void {
    const valid = evidenceEdgeSchema.parse(edge);
    const existing = this.edges.get(valid.id);
    this.edges.set(valid.id, existing ? {
      ...existing,
      status: existing.status === "verified" || valid.status === "verified" ? "verified" : "inferred",
      confidence: Math.max(existing.confidence, valid.confidence),
      evidence: mergeSources(existing.evidence, valid.evidence),
    } : valid);
  }

  addUnresolved(link: UnresolvedLink): void {
    const valid = unresolvedLinkSchema.parse(link);
    const existing = this.unresolved.get(valid.id);
    this.unresolved.set(valid.id, existing ? { ...existing, evidence: mergeSources(existing.evidence, valid.evidence) } : valid);
  }

  toJSON(): EvidenceGraphData {
    return evidenceGraphSchema.parse({
      nodes: [...this.nodes.values()].sort((a, b) => a.id.localeCompare(b.id)),
      edges: [...this.edges.values()].sort((a, b) => a.id.localeCompare(b.id)),
      unresolved: [...this.unresolved.values()].sort((a, b) => a.id.localeCompare(b.id)),
    });
  }
}