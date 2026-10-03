import type { EvidenceGraphData } from "../tracing/evidence-graph";
import { redactSecrets } from "./secret-redactor";

export interface EvidenceCitation {
  id: string;
  file: string;
  startLine: number;
  endLine: number;
  text: string;
  status: "verified" | "inferred";
}

export function buildEvidenceCitations(graph: EvidenceGraphData): EvidenceCitation[] {
  const citations: EvidenceCitation[] = [];
  for (const node of graph.nodes) {
    for (const evidence of node.evidence) citations.push({ id: node.id, file: evidence.file, startLine: evidence.startLine, endLine: evidence.endLine, text: redactSecrets(evidence.text), status: node.status });
  }
  for (const edge of graph.edges) {
    for (const evidence of edge.evidence) citations.push({ id: edge.id, file: evidence.file, startLine: evidence.startLine, endLine: evidence.endLine, text: redactSecrets(evidence.text), status: edge.status });
  }
  const unique = new Map<string, EvidenceCitation>();
  for (const citation of citations) unique.set(`${citation.id}:${citation.file}:${citation.startLine}:${citation.endLine}`, citation);
  return [...unique.values()].sort((a, b) => a.file.localeCompare(b.file) || a.startLine - b.startLine || a.id.localeCompare(b.id));
}