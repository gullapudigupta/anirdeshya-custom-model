import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { AnalysisOrchestrator } from "../src/analysis/analysis-orchestrator";
import { createAnalysisHandlers } from "../src/search/analysis-handlers";

test("analyzes a feature with bounded evidence and read-only handlers", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "native-orchestrator-"));
  try {
    await mkdir(path.join(root, "src"));
    await writeFile(path.join(root, "src", "save.ts"), "export async function save(input: Input) {\n validate(input);\n await repository.save(input);\n return input;\n}\nfunction validate(value: unknown) { return value; }\n");
    const result = await new AnalysisOrchestrator({ maxQueries: 8, maxCandidateFiles: 5 }).analyze(root, "trace save flow");
    assert.ok(result.state.executedQueries.length <= 8);
    assert.ok(result.state.filesRead.length <= 5);
    assert.ok(result.graph.nodes.length > 0);
    const registry = createAnalysisHandlers(root);
    const listing = await registry.invoke("list_repository", {});
    assert.equal(listing.tool, "list_repository");
    await assert.rejects(registry.invoke("run_tests", {}), /not allowed/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("honors an already-aborted signal", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "native-cancel-"));
  try {
    const controller = new AbortController();
    controller.abort(new Error("stop"));
    await assert.rejects(new AnalysisOrchestrator().analyze(root, "trace save flow", {}, controller.signal), /stop|cancel/i);
  } finally { await rm(root, { recursive: true, force: true }); }
});