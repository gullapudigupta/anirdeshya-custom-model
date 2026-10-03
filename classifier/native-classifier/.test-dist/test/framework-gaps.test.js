"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const evidence_graph_1 = require("../src/tracing/evidence-graph");
const framework_resolvers_1 = require("../src/tracing/framework-resolvers");
const gap_detector_1 = require("../src/tracing/gap-detector");
(0, node_test_1.default)("resolves Angular template handlers and Node route prefixes from captured evidence", () => {
    const evidence = [
        { file: "src/save.component.html", startLine: 1, endLine: 1, text: "<button (click)=\"save()\">Save</button>" },
        { file: "src/save.component.ts", startLine: 1, endLine: 3, text: "export class SaveComponent {\n  save() { this.api.persist(); }\n}" },
        { file: "src/routes.ts", startLine: 1, endLine: 2, text: "app.use('/api', router);\nrouter.post('/save', controller.save);" },
    ];
    const graph = (0, framework_resolvers_1.resolveFrameworkRelationships)(evidence);
    const result = graph.toJSON();
    strict_1.default.ok(result.edges.some((edge) => edge.kind === "handles" && edge.status === "verified"));
    strict_1.default.ok(result.nodes.some((node) => node.kind === "route" && node.label === "POST /api/save"));
});
(0, node_test_1.default)("deduplicates unresolved links into actionable targeted gaps", () => {
    const graph = new evidence_graph_1.EvidenceGraph();
    const evidence = { file: "src/a.ts", startLine: 1, endLine: 1, text: "save()" };
    for (const id of ["a", "b"])
        graph.addUnresolved({ id, from: "event:save", relation: "handles", targetHint: "save", reason: "Template handler definition missing", evidence: [evidence], suggestedTool: "find_symbol", query: "save" });
    const gaps = (0, gap_detector_1.detectGaps)(graph);
    strict_1.default.equal(gaps.length, 1);
    strict_1.default.equal(gaps[0]?.kind, "event_handler");
    strict_1.default.equal(gaps[0]?.query, "save");
});
