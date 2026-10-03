"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const analysis_request_1 = require("../src/analysis/analysis-request");
const analysis_state_1 = require("../src/analysis/analysis-state");
const completion_policy_1 = require("../src/analysis/completion-policy");
(0, node_test_1.default)("validates deterministic state transitions, budget exhaustion, and cancellation", () => {
    const state = (0, analysis_state_1.createAnalysisState)((0, analysis_request_1.createAnalysisRequest)("analyze this codebase"), { searches: 1 }, 100);
    strict_1.default.equal((0, analysis_state_1.checkAnalysisBudget)(state, 101), undefined);
    const exhausted = (0, analysis_state_1.transitionAnalysisState)(state, { consumed: { ...state.consumed, searches: 1 } });
    strict_1.default.equal((0, analysis_state_1.checkAnalysisBudget)(exhausted, 101), "search budget exhausted");
    const cancelled = (0, completion_policy_1.decideCompletion)(state.request, state.graph, { initiation: false, sideEffect: false, response: false }, { cancelled: true });
    strict_1.default.equal(cancelled.status, "cancelled");
});
(0, node_test_1.default)("requires supported feature flow segments and clarifies ambiguity", () => {
    const request = (0, analysis_request_1.createAnalysisRequest)("trace save flow");
    const graph = { nodes: [], edges: [], unresolved: [] };
    const incomplete = (0, completion_policy_1.decideCompletion)(request, graph, { initiation: true, sideEffect: false, response: true }, { hasResults: true });
    strict_1.default.equal(incomplete.status, "incomplete");
    strict_1.default.match(incomplete.reason, /side effect/);
    strict_1.default.equal((0, completion_policy_1.decideCompletion)(request, graph, { initiation: true, sideEffect: true, response: true }, { ambiguous: true }).status, "needs_clarification");
});
