import type { EvidenceSource } from "./evidence-graph";
import { EvidenceGraph } from "./evidence-graph";
import { resolveAngularRelationships } from "./angular-resolver";
import { resolveNodeRelationships } from "./node-resolver";

export function resolveFrameworkRelationships(regions: readonly EvidenceSource[], graph = new EvidenceGraph()): EvidenceGraph {
  resolveAngularRelationships(regions, graph);
  resolveNodeRelationships(regions, graph);
  return graph;
}