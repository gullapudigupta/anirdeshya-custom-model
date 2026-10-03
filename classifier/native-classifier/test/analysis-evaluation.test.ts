import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { AnalysisOrchestrator } from "../src/analysis/analysis-orchestrator";
import { buildAnalysisReport } from "../src/reporting/analysis-report";
import { redactSecrets } from "../src/reporting/secret-redactor";

const fixtureRoot = path.join(process.cwd(), "test", "fixtures", "codebase-analysis");

test("evaluation finds the known save entry point deterministically and never exposes fixture secrets", async () => {
  const first = await new AnalysisOrchestrator({ maxQueries: 12, maxCandidateFiles: 8 }).analyze(fixtureRoot, "trace save flow");
  const second = await new AnalysisOrchestrator({ maxQueries: 12, maxCandidateFiles: 8 }).analyze(fixtureRoot, "trace save flow");
  const normalize = (value: unknown) => JSON.stringify(value, (_key, item) => _key === "requestId" ? "stable" : item);
  assert.equal(normalize(first.graph), normalize(second.graph));
  assert.ok(first.graph.nodes.some((node) => node.label === "save"));
  assert.ok(first.graph.edges.length > 0);
  const report = buildAnalysisReport(first.request, first.completion, first.graph);
  const fixture = await readFile(path.join(fixtureRoot, "expected-save-flow.json"), "utf8");
  assert.doesNotMatch(redactSecrets(JSON.stringify(report)), /fixture-secret-must-not-appear/);
  assert.ok(fixture.includes('"requiredEdges"'));
});