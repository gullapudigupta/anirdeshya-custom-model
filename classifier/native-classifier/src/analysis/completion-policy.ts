import type { AnalysisRequest } from "./analysis-request";
import type { AnalysisStateStatus } from "./analysis-state";
import type { EvidenceGraphData } from "../tracing/evidence-graph";

export interface FlowCoverage { initiation: boolean; sideEffect: boolean; response: boolean }
export interface CompletionDecision { status: AnalysisStateStatus; reason: string }

export function decideCompletion(request: AnalysisRequest, graph: EvidenceGraphData, coverage: FlowCoverage, options: { budgetReason?: string; cancelled?: boolean; ambiguous?: boolean; hasResults?: boolean }): CompletionDecision {
  if (options.cancelled) return { status: "cancelled", reason: "Analysis was cancelled" };
  if (options.ambiguous) return { status: "needs_clarification", reason: "Multiple unrelated candidate flows match the request" };
  if (options.budgetReason) return { status: "incomplete", reason: options.budgetReason };
  if (!options.hasResults && graph.nodes.length === 0) return { status: "incomplete", reason: "No repository evidence matched the request" };
  if (request.mode === "architecture") return { status: "completed", reason: "Bounded repository architecture inventory completed" };
  if (request.mode === "feature_flow" && !(coverage.initiation && coverage.sideEffect && coverage.response)) {
    const missing = [!coverage.initiation && "initiation", !coverage.sideEffect && "side effect", !coverage.response && "response"].filter(Boolean).join(", ");
    return { status: "incomplete", reason: `Feature flow evidence is missing: ${missing}` };
  }
  if (graph.unresolved.length) return { status: "incomplete", reason: `${graph.unresolved.length} relevant relationship(s) remain unresolved` };
  return { status: "completed", reason: "Requested analysis completed with captured evidence" };
}