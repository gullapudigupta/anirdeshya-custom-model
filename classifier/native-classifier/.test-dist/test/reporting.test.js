"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const analysis_request_1 = require("../src/analysis/analysis-request");
const analysis_report_1 = require("../src/reporting/analysis-report");
const secret_redactor_1 = require("../src/reporting/secret-redactor");
const evidence_graph_1 = require("../src/tracing/evidence-graph");
(0, node_test_1.default)("redacts credential assignments, tokens, private keys, connection strings, and URL secrets", () => {
    const input = [
        'api_key="long-secret-value-123"',
        "Authorization: Bearer abcdefghijklmnop.qrstuvwxyz123456",
        "mongodb://user:password@db.example.test/app",
        "https://example.test/api?access_token=verylongtokenvalue",
        "-----BEGIN PRIVATE KEY-----\nprivate-data\n-----END PRIVATE KEY-----",
    ].join("\n");
    const redacted = (0, secret_redactor_1.redactSecrets)(input);
    strict_1.default.doesNotMatch(redacted, /long-secret-value|abcdefghijklmnop|user:password|verylongtokenvalue|private-data/);
    strict_1.default.match(redacted, /REDACTED/);
});
(0, node_test_1.default)("creates only evidence-backed claims and reports unresolved uncertainty", () => {
    const request = (0, analysis_request_1.createAnalysisRequest)("trace save flow", { requestId: "report-1" });
    const graph = new evidence_graph_1.EvidenceGraph();
    const source = { file: "src/save.ts", startLine: 2, endLine: 2, text: "await store.save(input);" };
    graph.addNode({ id: "symbol:save", kind: "symbol", label: "save", status: "verified", confidence: 1, evidence: [source] });
    graph.addUnresolved({ id: "gap:result", from: "symbol:save", relation: "calls", targetHint: "externalStore", reason: "External adapter definition unavailable", evidence: [source], suggestedTool: "find_symbol", query: "externalStore" });
    const report = (0, analysis_report_1.buildAnalysisReport)(request, { status: "incomplete", reason: "External relationship unresolved" }, graph.toJSON());
    strict_1.default.equal(report.status, "incomplete");
    strict_1.default.ok(report.claims.every((claim) => claim.evidenceIds.length > 0));
    strict_1.default.equal(report.unresolvedGaps[0]?.target, "externalStore");
    strict_1.default.throws(() => (0, analysis_report_1.assertReportEvidence)({ ...report, claims: [{ text: "unsupported", evidenceIds: ["missing"], status: "verified" }] }, new Set(["symbol:save"])), /lacks graph evidence/);
});
