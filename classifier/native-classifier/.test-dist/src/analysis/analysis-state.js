"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.analysisStateSchema = exports.defaultAnalysisLimits = exports.analysisLimitsSchema = void 0;
exports.createAnalysisState = createAnalysisState;
exports.transitionAnalysisState = transitionAnalysisState;
exports.checkAnalysisBudget = checkAnalysisBudget;
exports.withInventory = withInventory;
const zod_1 = require("zod");
const analysis_request_1 = require("./analysis-request");
const repository_inventory_1 = require("../repository/repository-inventory");
const result_ranker_1 = require("../search/result-ranker");
const evidence_graph_1 = require("../tracing/evidence-graph");
exports.analysisLimitsSchema = zod_1.z.object({
    iterations: zod_1.z.number().int().min(1).max(50), searches: zod_1.z.number().int().min(1).max(500), files: zod_1.z.number().int().min(1).max(500),
    lines: zod_1.z.number().int().min(1).max(50_000), results: zod_1.z.number().int().min(1).max(10_000), durationMs: zod_1.z.number().int().min(100).max(600_000), graphNodes: zod_1.z.number().int().min(1).max(20_000),
}).strict();
exports.defaultAnalysisLimits = { iterations: 5, searches: 40, files: 30, lines: 3_000, results: 500, durationMs: 60_000, graphNodes: 2_000 };
exports.analysisStateSchema = zod_1.z.object({
    request: analysis_request_1.analysisRequestSchema,
    inventory: repository_inventory_1.repositoryInventorySchema.optional(),
    pendingQueries: zod_1.z.array(zod_1.z.string()),
    executedQueries: zod_1.z.array(zod_1.z.string()),
    candidates: zod_1.z.array(result_ranker_1.searchCandidateSchema),
    graph: evidence_graph_1.evidenceGraphSchema,
    filesRead: zod_1.z.array(zod_1.z.string()),
    iteration: zod_1.z.number().int().min(0),
    status: zod_1.z.enum(["running", "completed", "incomplete", "needs_clarification", "cancelled"]),
    limits: exports.analysisLimitsSchema,
    consumed: zod_1.z.object({ searches: zod_1.z.number().int().min(0), lines: zod_1.z.number().int().min(0), startedAt: zod_1.z.number().finite() }).strict(),
    reason: zod_1.z.string().optional(),
}).strict();
function createAnalysisState(request, limits = {}, now = Date.now()) {
    return exports.analysisStateSchema.parse({
        request,
        pendingQueries: [], executedQueries: [], candidates: [], graph: { nodes: [], edges: [], unresolved: [] }, filesRead: [],
        iteration: 0, status: "running", limits: { ...exports.defaultAnalysisLimits, ...limits },
        consumed: { searches: 0, lines: 0, startedAt: now },
    });
}
function transitionAnalysisState(state, update) {
    if (state.status !== "running" && update.status === undefined)
        throw new Error("Only running analysis state can be updated");
    if (update.status && state.status !== "running")
        throw new Error(`Invalid analysis transition from ${state.status}`);
    return exports.analysisStateSchema.parse({ ...state, ...update });
}
function checkAnalysisBudget(state, now = Date.now()) {
    if (state.consumed.searches >= state.limits.searches)
        return "search budget exhausted";
    if (state.filesRead.length >= state.limits.files)
        return "file budget exhausted";
    if (state.consumed.lines >= state.limits.lines)
        return "line budget exhausted";
    if (state.iteration >= state.limits.iterations)
        return "iteration budget exhausted";
    if (now - state.consumed.startedAt >= state.limits.durationMs)
        return "duration budget exhausted";
    if (state.graph.nodes.length >= state.limits.graphNodes)
        return "graph size budget exhausted";
    return undefined;
}
function withInventory(state, inventory) {
    return transitionAnalysisState(state, { inventory });
}
