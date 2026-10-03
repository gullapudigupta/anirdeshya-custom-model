import path from "node:path";
import type { EvidenceSource } from "./evidence-graph";
import { EvidenceGraph } from "./evidence-graph";

function lineEvidence(region: EvidenceSource, lineIndex: number, text: string): EvidenceSource {
  const line = region.startLine + lineIndex;
  return { file: region.file, startLine: line, endLine: line, text: text.slice(0, 1_000) };
}

export function resolveAngularRelationships(regions: readonly EvidenceSource[], graph = new EvidenceGraph()): EvidenceGraph {
  const declarations = new Map<string, { region: EvidenceSource; lineIndex: number; text: string }>();
  for (const region of regions) {
    const lines = region.text.split(/\r?\n/);
    lines.forEach((text, lineIndex) => {
      const method = /(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*[:{]/.exec(text);
      if (method) declarations.set(method[1], { region, lineIndex, text });
    });
  }
  for (const region of regions) {
    const lines = region.text.split(/\r?\n/);
    const isTemplate = /\.(?:html|component\.html)$/i.test(region.file);
    const componentName = path.basename(region.file).replace(/\.component\.html$/i, "").replace(/\.html$/i, "");
    lines.forEach((text, lineIndex) => {
      const source = lineEvidence(region, lineIndex, text);
      if (isTemplate) {
        for (const match of text.matchAll(/\([^)]*(?:click|submit|change|input)[^)]*\)\s*=\s*["']\s*([A-Za-z_$][\w$]*)\s*\(/gi)) {
          const handler = match[1];
          const handlerDefinition = declarations.get(handler);
          const eventId = `event:${region.file}:${handler}`;
          graph.addNode({ id: eventId, kind: "event", label: handler, status: "verified", confidence: 0.9, evidence: [source] });
          if (handlerDefinition) {
            const symbolId = `symbol:${handlerDefinition.region.file}:${handler}`;
            graph.addNode({ id: symbolId, kind: "symbol", label: handler, status: "verified", confidence: 0.98, evidence: [lineEvidence(handlerDefinition.region, handlerDefinition.lineIndex, handlerDefinition.text)] });
            graph.addEdge({ id: `${eventId}->${symbolId}:handles`, from: eventId, to: symbolId, kind: "handles", status: "verified", confidence: 0.95, evidence: [source, lineEvidence(handlerDefinition.region, handlerDefinition.lineIndex, handlerDefinition.text)] });
          } else {
            graph.addUnresolved({ id: `angular-handler:${eventId}`, from: eventId, relation: "handles", targetHint: handler, reason: "Template handler definition was not present in captured source regions", evidence: [source], suggestedTool: "find_symbol", query: handler });
          }
        }
      }
      const className = /\bclass\s+([A-Za-z_$][\w$]*)/.exec(text)?.[1];
      const dependencies = [...text.matchAll(/(?:private|public|protected)?\s*(?:readonly\s+)?([A-Za-z_$][\w$]*)\s*:\s*([A-Za-z_$][\w$]*(?:Service|Store|Facade))/g)];
      if (className && dependencies.length) {
        for (const dependency of dependencies) {
          const from = `symbol:${region.file}:${className}`;
          const to = `symbol:${dependency[2]}`;
          graph.addNode({ id: from, kind: "symbol", label: className, status: "verified", confidence: 0.9, evidence: [source] });
          graph.addNode({ id: to, kind: "symbol", label: dependency[2], status: "inferred", confidence: 0.7, evidence: [source] });
          graph.addEdge({ id: `${from}->${to}:injects`, from, to, kind: "injects", status: "verified", confidence: 0.9, evidence: [source] });
        }
      }
      const emitted = /(?:\.emit\(|dispatch\s*\()/.exec(text);
      if (emitted) {
        const eventName = /([A-Za-z_$][\w$]*)\s*\.(?:emit|dispatch)\s*\(/.exec(text)?.[1] ?? text.slice(emitted.index, emitted.index + 40);
        const eventId = `event:${region.file}:${eventName}`;
        const owner = `symbol:${region.file}:${componentName || "module"}`;
        graph.addNode({ id: owner, kind: "symbol", label: componentName || "module", status: "verified", confidence: 0.85, evidence: [source] });
        graph.addNode({ id: eventId, kind: "event", label: eventName, status: "verified", confidence: 0.85, evidence: [source] });
        graph.addEdge({ id: `${owner}->${eventId}:emits`, from: owner, to: eventId, kind: "emits", status: "verified", confidence: 0.85, evidence: [source] });
      }
      const ngrxAction = /createAction\s*\(\s*["']([^"']+)["']/.exec(text);
      if (ngrxAction) {
        const eventId = `event:${region.file}:${ngrxAction[1]}`;
        graph.addNode({ id: eventId, kind: "event", label: ngrxAction[1], status: "verified", confidence: 0.95, evidence: [source] });
      }
    });
  }
  return graph;
}