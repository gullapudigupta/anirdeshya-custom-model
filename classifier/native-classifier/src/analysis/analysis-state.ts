import { z } from "zod";
import type { AnalysisRequest } from "./analysis-request";
import { analysisRequestSchema } from "./analysis-request";
import type { RepositoryInventory } from "../repository/repository-inventory";
import { repositoryInventorySchema } from "../repository/repository-inventory";
import type { SearchCandidate } from "../search/result-ranker";
import { searchCandidateSchema } from "../search/result-ranker";
import type { EvidenceGraphData } from "../tracing/evidence-graph";
import { evidenceGraphSchema } from "../tracing/evidence-graph";

export const analysisLimitsSchema = z.object({
  iterations: z.number().int().min(1).max(50), searches: z.number().int().min(1).max(500), files: z.number().int().min(1).max(500),
  lines: z.number().int().min(1).max(50_000), results: z.number().int().min(1).max(10_000), durationMs: z.number().int().min(100).max(600_000), graphNodes: z.number().int().min(1).max(20_000),
}).strict();
export const defaultAnalysisLimits = { iterations: 5, searches: 40, files: 30, lines: 3_000, results: 500, durationMs: 60_000, graphNodes: 2_000 };
export const analysisStateSchema = z.object({
  request: analysisRequestSchema,
  inventory: repositoryInventorySchema.optional(),
  pendingQueries: z.array(z.string()),
  executedQueries: z.array(z.string()),
  candidates: z.array(searchCandidateSchema),
  graph: evidenceGraphSchema,
  filesRead: z.array(z.string()),
  iteration: z.number().int().min(0),
  status: z.enum(["running", "completed", "incomplete", "needs_clarification", "cancelled"]),
  limits: analysisLimitsSchema,
  consumed: z.object({ searches: z.number().int().min(0), lines: z.number().int().min(0), startedAt: z.number().finite() }).strict(),
  reason: z.string().optional(),
}).strict();

export type AnalysisLimits = z.infer<typeof analysisLimitsSchema>;
export type AnalysisState = z.infer<typeof analysisStateSchema>;
export type AnalysisStateStatus = AnalysisState["status"];

export function createAnalysisState(request: AnalysisRequest, limits: Partial<AnalysisLimits> = {}, now = Date.now()): AnalysisState {
  return analysisStateSchema.parse({
    request,
    pendingQueries: [], executedQueries: [], candidates: [], graph: { nodes: [], edges: [], unresolved: [] }, filesRead: [],
    iteration: 0, status: "running", limits: { ...defaultAnalysisLimits, ...limits },
    consumed: { searches: 0, lines: 0, startedAt: now },
  });
}

export function transitionAnalysisState(state: AnalysisState, update: Partial<Pick<AnalysisState, "inventory" | "pendingQueries" | "executedQueries" | "candidates" | "graph" | "filesRead" | "iteration" | "status" | "consumed" | "reason">>): AnalysisState {
  if (state.status !== "running" && update.status === undefined) throw new Error("Only running analysis state can be updated");
  if (update.status && state.status !== "running") throw new Error(`Invalid analysis transition from ${state.status}`);
  return analysisStateSchema.parse({ ...state, ...update });
}

export function checkAnalysisBudget(state: AnalysisState, now = Date.now()): string | undefined {
  if (state.consumed.searches >= state.limits.searches) return "search budget exhausted";
  if (state.filesRead.length >= state.limits.files) return "file budget exhausted";
  if (state.consumed.lines >= state.limits.lines) return "line budget exhausted";
  if (state.iteration >= state.limits.iterations) return "iteration budget exhausted";
  if (now - state.consumed.startedAt >= state.limits.durationMs) return "duration budget exhausted";
  if (state.graph.nodes.length >= state.limits.graphNodes) return "graph size budget exhausted";
  return undefined;
}

export function withInventory(state: AnalysisState, inventory: RepositoryInventory): AnalysisState {
  return transitionAnalysisState(state, { inventory });
}