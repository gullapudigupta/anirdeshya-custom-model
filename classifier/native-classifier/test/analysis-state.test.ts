import assert from "node:assert/strict";
import test from "node:test";
import { createAnalysisRequest } from "../src/analysis/analysis-request";
import { checkAnalysisBudget, createAnalysisState, transitionAnalysisState } from "../src/analysis/analysis-state";
import { decideCompletion } from "../src/analysis/completion-policy";

test("validates deterministic state transitions, budget exhaustion, and cancellation", () => {
  const state = createAnalysisState(createAnalysisRequest("analyze this codebase"), { searches: 1 }, 100);
  assert.equal(checkAnalysisBudget(state, 101), undefined);
  const exhausted = transitionAnalysisState(state, { consumed: { ...state.consumed, searches: 1 } });
  assert.equal(checkAnalysisBudget(exhausted, 101), "search budget exhausted");
  const cancelled = decideCompletion(state.request, state.graph, { initiation: false, sideEffect: false, response: false }, { cancelled: true });
  assert.equal(cancelled.status, "cancelled");
});

test("requires supported feature flow segments and clarifies ambiguity", () => {
  const request = createAnalysisRequest("trace save flow");
  const graph = { nodes: [], edges: [], unresolved: [] };
  const incomplete = decideCompletion(request, graph, { initiation: true, sideEffect: false, response: true }, { hasResults: true });
  assert.equal(incomplete.status, "incomplete");
  assert.match(incomplete.reason, /side effect/);
  assert.equal(decideCompletion(request, graph, { initiation: true, sideEffect: true, response: true }, { ambiguous: true }).status, "needs_clarification");
});