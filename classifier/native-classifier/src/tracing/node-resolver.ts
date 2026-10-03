import type { EvidenceSource } from "./evidence-graph";
import { EvidenceGraph } from "./evidence-graph";

function sourceAt(region: EvidenceSource, lineIndex: number, text: string): EvidenceSource {
  const line = region.startLine + lineIndex;
  return { file: region.file, startLine: line, endLine: line, text: text.slice(0, 1_000) };
}

export function resolveNodeRelationships(regions: readonly EvidenceSource[], graph = new EvidenceGraph()): EvidenceGraph {
  const prefixes = new Map<string, string[]>();
  for (const region of regions) {
    const lines = region.text.split(/\r?\n/);
    lines.forEach((text, index) => {
      for (const match of text.matchAll(/\b([A-Za-z_$][\w$]*)\.use\s*\(\s*["'`]([^"'`]+)["'`]\s*,\s*([A-Za-z_$][\w$]*)\s*\)/g)) {
        const known = prefixes.get(match[3]) ?? [];
        known.push(match[2].replace(/\/$/, ""));
        prefixes.set(match[3], known);
      }
    });
  }
  for (const [router, values] of prefixes) prefixes.set(router, [...new Set(values)].sort());
  for (const region of regions) {
    const lines = region.text.split(/\r?\n/);
    lines.forEach((text, index) => {
      const evidence = sourceAt(region, index, text);
      const route = /\b([A-Za-z_$][\w$]*)\.(get|post|put|patch|delete)\s*\(\s*["'`]([^"'`]+)["'`]\s*,\s*(?:async\s+)?([A-Za-z_$][\w$]*)(?:\.([A-Za-z_$][\w$]*))?\s*\)/i.exec(text);
      if (route) {
        const fullPath = [...(prefixes.get(route[1]) ?? []), route[3]].join("").replace(/\/+/g, "/");
        const routeId = `route:${route[2].toUpperCase()}:${fullPath}`;
        const targetName = route[5] ?? route[4];
        const targetId = `symbol:${targetName}`;
        graph.addNode({ id: routeId, kind: "route", label: `${route[2].toUpperCase()} ${fullPath}`, status: "verified", confidence: 0.95, evidence: [evidence] });
        graph.addNode({ id: targetId, kind: "symbol", label: targetName, status: "inferred", confidence: 0.75, evidence: [evidence] });
        graph.addEdge({ id: `${routeId}->${targetId}:routes_to`, from: routeId, to: targetId, kind: "routes_to", status: route[5] ? "verified" : "inferred", confidence: route[5] ? 0.95 : 0.7, evidence: [evidence] });
      }
      const emitter = /\b([A-Za-z_$][\w$]*)\.emit\s*\(\s*["'`]([^"'`]+)["'`]/.exec(text);
      if (emitter) {
        const eventId = `event:${emitter[2]}`;
        const sourceId = `symbol:${emitter[1]}`;
        graph.addNode({ id: eventId, kind: "event", label: emitter[2], status: "verified", confidence: 0.9, evidence: [evidence] });
        graph.addNode({ id: sourceId, kind: "symbol", label: emitter[1], status: "inferred", confidence: 0.6, evidence: [evidence] });
        graph.addEdge({ id: `${sourceId}->${eventId}:emits`, from: sourceId, to: eventId, kind: "emits", status: "verified", confidence: 0.9, evidence: [evidence] });
      }
      const repositoryCall = /\b(?:await\s+)?([A-Za-z_$][\w$]*(?:Repository|Model|Collection))\.(?:save|insert|create|update|delete|find|findOne|upsert)\s*\(/i.exec(text);
      if (repositoryCall) {
        const databaseId = `database:${repositoryCall[1]}`;
        graph.addNode({ id: databaseId, kind: "database", label: repositoryCall[1], status: "inferred", confidence: 0.7, evidence: [evidence] });
        const operation = /^(?:save|insert|create|update|upsert)$/i.test(text.slice(repositoryCall.index + repositoryCall[0].indexOf(".") + 1).split("(")[0]) ? "writes" : "reads";
        const sourceId = `symbol:${region.file}:${operation}`;
        graph.addNode({ id: sourceId, kind: "symbol", label: operation, status: "inferred", confidence: 0.55, evidence: [evidence] });
        graph.addEdge({ id: `${sourceId}->${databaseId}:${operation}`, from: sourceId, to: databaseId, kind: operation, status: "verified", confidence: 0.85, evidence: [evidence] });
      }
    });
  }
  return graph;
}