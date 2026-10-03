import assert from "node:assert/strict";
import test from "node:test";
import { analyzeReadRegion } from "../src/analysis/evidence-capture";
import { EvidenceGraph } from "../src/tracing/evidence-graph";
import { traceCalls } from "../src/tracing/call-graph";
import { traceDataFlow } from "../src/tracing/data-flow";

test("merges duplicate graph evidence deterministically without losing provenance", () => {
  const graph = new EvidenceGraph();
  const evidence = { file: "src/a.ts", startLine: 1, endLine: 2, text: "save()" };
  graph.addNode({ id: "symbol:save", kind: "symbol", label: "save", status: "inferred", confidence: 0.5, evidence: [evidence] });
  graph.addNode({ id: "symbol:save", kind: "symbol", label: "save", status: "verified", confidence: 0.9, evidence: [{ ...evidence, file: "src/b.ts" }] });
  const result = graph.toJSON();
  assert.equal(result.nodes[0]?.status, "verified");
  assert.equal(result.nodes[0]?.evidence.length, 2);
});

test("captures only the returned source region and traces calls, data, async, and errors", () => {
  const source = "async function save(input: Input) {\n const payload = input ?? {};\n validate(payload);\n await store.save(payload);\n return payload;\n}\n";
  const capture = analyzeReadRegion({ file: "src/save.ts", startLine: 20, endLine: 25, text: source }, "save");
  assert.equal(capture.startLine, 20);
  assert.ok(capture.inputs.includes("input"));
  assert.equal(capture.asynchronous, true);
  assert.ok(capture.sideEffects.includes("store.save"));
  const calls = traceCalls([capture], new Set(["validate"]));
  assert.ok(calls.some((step) => step.asynchronous && step.to === "store.save"));
  assert.ok(calls.some((step) => step.status === "verified" && step.to === "validate"));
  assert.ok(traceDataFlow([capture]).some((step) => step.kind === "validation"));
});