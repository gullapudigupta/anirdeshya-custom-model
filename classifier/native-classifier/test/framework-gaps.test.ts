import assert from "node:assert/strict";
import test from "node:test";
import { EvidenceGraph } from "../src/tracing/evidence-graph";
import { resolveFrameworkRelationships } from "../src/tracing/framework-resolvers";
import { detectGaps } from "../src/tracing/gap-detector";

test("resolves Angular template handlers and Node route prefixes from captured evidence", () => {
  const evidence = [
    { file: "src/save.component.html", startLine: 1, endLine: 1, text: "<button (click)=\"save()\">Save</button>" },
    { file: "src/save.component.ts", startLine: 1, endLine: 3, text: "export class SaveComponent {\n  save() { this.api.persist(); }\n}" },
    { file: "src/routes.ts", startLine: 1, endLine: 2, text: "app.use('/api', router);\nrouter.post('/save', controller.save);" },
  ];
  const graph = resolveFrameworkRelationships(evidence);
  const result = graph.toJSON();
  assert.ok(result.edges.some((edge) => edge.kind === "handles" && edge.status === "verified"));
  assert.ok(result.nodes.some((node) => node.kind === "route" && node.label === "POST /api/save"));
});

test("deduplicates unresolved links into actionable targeted gaps", () => {
  const graph = new EvidenceGraph();
  const evidence = { file: "src/a.ts", startLine: 1, endLine: 1, text: "save()" };
  for (const id of ["a", "b"]) graph.addUnresolved({ id, from: "event:save", relation: "handles", targetHint: "save", reason: "Template handler definition missing", evidence: [evidence], suggestedTool: "find_symbol", query: "save" });
  const gaps = detectGaps(graph);
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0]?.kind, "event_handler");
  assert.equal(gaps[0]?.query, "save");
});