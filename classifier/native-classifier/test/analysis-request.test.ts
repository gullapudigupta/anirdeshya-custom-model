import assert from "node:assert/strict";
import test from "node:test";
import { analysisRequestSchema, createAnalysisRequest } from "../src/analysis/analysis-request";

test("builds broad architecture requests with safe defaults", () => {
  const request = createAnalysisRequest("Analyze this codebase");
  assert.equal(request.mode, "architecture");
  assert.deepEqual(request.constraints, ["read_only"]);
  assert.deepEqual(request.scope.excludePatterns, ["node_modules", "dist", "coverage", ".git"]);
});

test("extracts a feature from natural language flow questions", () => {
  for (const question of ["find how save works", "trace the save flow"]) {
    const request = createAnalysisRequest(question);
    assert.equal(request.mode, "feature_flow");
    assert.ok(request.targetTerms.includes("save"));
  }
});

test("preserves quoted symbols as higher-confidence symbol targets", () => {
  const request = createAnalysisRequest('Who calls "persistOrder"?');
  assert.equal(request.mode, "symbol_usage");
  assert.deepEqual(request.targetSymbols, ["persistOrder"]);
  assert.equal(request.entities[0]?.confidence, 0.99);
});

test("rejects invalid modes, blank questions, unsafe paths, and malformed output", () => {
  const valid = createAnalysisRequest("Analyze this codebase");
  assert.equal(analysisRequestSchema.safeParse({ ...valid, mode: "mutate" }).success, false);
  assert.equal(analysisRequestSchema.safeParse({ ...valid, question: "  " }).success, false);
  assert.equal(analysisRequestSchema.safeParse({ ...valid, scope: { ...valid.scope, directories: ["../outside"] } }).success, false);
  assert.equal(analysisRequestSchema.safeParse({ ...valid, output: { ...valid.output, includeCallFlow: "yes" } }).success, false);
});