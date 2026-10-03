import assert from "node:assert/strict";
import test from "node:test";
import { createAnalysisRequest } from "../src/analysis/analysis-request";
import { buildAnalysisReport, assertReportEvidence } from "../src/reporting/analysis-report";
import { redactSecrets } from "../src/reporting/secret-redactor";
import { EvidenceGraph } from "../src/tracing/evidence-graph";

test("redacts credential assignments, tokens, private keys, connection strings, and URL secrets", () => {
  const input = [
    'api_key="long-secret-value-123"',
    "Authorization: Bearer abcdefghijklmnop.qrstuvwxyz123456",
    "mongodb://user:password@db.example.test/app",
    "https://example.test/api?access_token=verylongtokenvalue",
    "-----BEGIN PRIVATE KEY-----\nprivate-data\n-----END PRIVATE KEY-----",
  ].join("\n");
  const redacted = redactSecrets(input);
  assert.doesNotMatch(redacted, /long-secret-value|abcdefghijklmnop|user:password|verylongtokenvalue|private-data/);
  assert.match(redacted, /REDACTED/);
});

test("creates only evidence-backed claims and reports unresolved uncertainty", () => {
  const request = createAnalysisRequest("trace save flow", { requestId: "report-1" });
  const graph = new EvidenceGraph();
  const source = { file: "src/save.ts", startLine: 2, endLine: 2, text: "await store.save(input);" };
  graph.addNode({ id: "symbol:save", kind: "symbol", label: "save", status: "verified", confidence: 1, evidence: [source] });
  graph.addUnresolved({ id: "gap:result", from: "symbol:save", relation: "calls", targetHint: "externalStore", reason: "External adapter definition unavailable", evidence: [source], suggestedTool: "find_symbol", query: "externalStore" });
  const report = buildAnalysisReport(request, { status: "incomplete", reason: "External relationship unresolved" }, graph.toJSON());
  assert.equal(report.status, "incomplete");
  assert.ok(report.claims.every((claim) => claim.evidenceIds.length > 0));
  assert.equal(report.unresolvedGaps[0]?.target, "externalStore");
  assert.throws(() => assertReportEvidence({ ...report, claims: [{ text: "unsupported", evidenceIds: ["missing"], status: "verified" }] }, new Set(["symbol:save"])), /lacks graph evidence/);
});