"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const evidence_capture_1 = require("../src/analysis/evidence-capture");
const evidence_graph_1 = require("../src/tracing/evidence-graph");
const call_graph_1 = require("../src/tracing/call-graph");
const data_flow_1 = require("../src/tracing/data-flow");
(0, node_test_1.default)("merges duplicate graph evidence deterministically without losing provenance", () => {
    const graph = new evidence_graph_1.EvidenceGraph();
    const evidence = { file: "src/a.ts", startLine: 1, endLine: 2, text: "save()" };
    graph.addNode({ id: "symbol:save", kind: "symbol", label: "save", status: "inferred", confidence: 0.5, evidence: [evidence] });
    graph.addNode({ id: "symbol:save", kind: "symbol", label: "save", status: "verified", confidence: 0.9, evidence: [{ ...evidence, file: "src/b.ts" }] });
    const result = graph.toJSON();
    strict_1.default.equal(result.nodes[0]?.status, "verified");
    strict_1.default.equal(result.nodes[0]?.evidence.length, 2);
});
(0, node_test_1.default)("captures only the returned source region and traces calls, data, async, and errors", () => {
    const source = "async function save(input: Input) {\n const payload = input ?? {};\n validate(payload);\n await store.save(payload);\n return payload;\n}\n";
    const capture = (0, evidence_capture_1.analyzeReadRegion)({ file: "src/save.ts", startLine: 20, endLine: 25, text: source }, "save");
    strict_1.default.equal(capture.startLine, 20);
    strict_1.default.ok(capture.inputs.includes("input"));
    strict_1.default.equal(capture.asynchronous, true);
    strict_1.default.ok(capture.sideEffects.includes("store.save"));
    const calls = (0, call_graph_1.traceCalls)([capture], new Set(["validate"]));
    strict_1.default.ok(calls.some((step) => step.asynchronous && step.to === "store.save"));
    strict_1.default.ok(calls.some((step) => step.status === "verified" && step.to === "validate"));
    strict_1.default.ok((0, data_flow_1.traceDataFlow)([capture]).some((step) => step.kind === "validation"));
});
