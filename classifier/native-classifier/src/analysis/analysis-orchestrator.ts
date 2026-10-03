import path from "node:path";
import { createAnalysisRequest, type AnalysisRequestOptions } from "./analysis-request";
import { analyzeReadRegion } from "./evidence-capture";
import { decideCompletion } from "./completion-policy";
import { checkAnalysisBudget, createAnalysisState, transitionAnalysisState, type AnalysisLimits, type AnalysisState } from "./analysis-state";
import { LocalRepositoryInventory } from "../repository/repository-inventory";
import { listFiles } from "../search/file-search";
import { searchCode } from "../search/text-search";
import { readWorkspaceFile } from "../repository/read-file";
import { TypeScriptCompilerSymbolProvider } from "../search/compiler-symbol-provider";
import { generateSearchQueries } from "../search/query-generator";
import { rankCandidates } from "../search/result-ranker";
import { EvidenceGraph, type EvidenceSource } from "../tracing/evidence-graph";
import { traceCalls } from "../tracing/call-graph";
import { traceDataFlow } from "../tracing/data-flow";
import { resolveFrameworkRelationships } from "../tracing/framework-resolvers";

export interface AnalysisOrchestratorOptions {
  limits?: Partial<AnalysisLimits>;
  maxInventoryFiles?: number;
  maxInventoryDirectories?: number;
  maxQueries?: number;
  maxCandidateFiles?: number;
}

export interface AnalysisResult {
  request: ReturnType<typeof createAnalysisRequest>;
  state: AnalysisState;
  graph: ReturnType<EvidenceGraph["toJSON"]>;
  completion: ReturnType<typeof decideCompletion>;
  coverage: { initiation: boolean; sideEffect: boolean; response: boolean };
}

function candidateReasons(file: string, text: string, query: string, exactSymbol: boolean): Array<"exact_symbol" | "definition" | "phrase_match" | "comment" | "documentation" | "fixture" | "generated" | "reexport"> {
  const reasons: Array<"exact_symbol" | "definition" | "phrase_match" | "comment" | "documentation" | "fixture" | "generated" | "reexport"> = [];
  const lower = file.toLowerCase();
  if (exactSymbol && new RegExp(`\\b${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(text)) reasons.push("exact_symbol");
  if (new RegExp(`\\b(?:function|class|interface|const|let|var)\\s+${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(text)) reasons.push("definition");
  if (/^\s*(?:\/\/|\*|<!--)/.test(text)) reasons.push("comment");
  if (/\.(?:md|mdx|rst|txt)$/i.test(lower)) reasons.push("documentation");
  if (/(?:^|\/)(?:fixtures?|__tests__|test|tests)(?:\/|$)/i.test(lower)) reasons.push("fixture");
  if (/(?:^|\/)(?:dist|build|generated|coverage)(?:\/|$)/i.test(lower)) reasons.push("generated");
  if (/^\s*export\s+\*\s+from/.test(text)) reasons.push("reexport");
  if (!reasons.length) reasons.push("phrase_match");
  return reasons;
}

function declaredNames(text: string): string[] {
  return [...text.matchAll(/\b(?:function|class|interface|const|let|var)\s+([A-Za-z_$][\w$]*)/g)].map((match) => match[1]);
}

export class AnalysisOrchestrator {
  constructor(private readonly options: AnalysisOrchestratorOptions = {}) {}

  async analyze(root: string, question: string, requestOptions: AnalysisRequestOptions = {}, signal?: AbortSignal): Promise<AnalysisResult> {
    const request = createAnalysisRequest(question, requestOptions);
    const stateLimits = { ...this.options.limits };
    let state = createAnalysisState(request, stateLimits);
    const inventory = await new LocalRepositoryInventory().inventory(root, {
      maxFiles: this.options.maxInventoryFiles,
      maxDirectories: this.options.maxInventoryDirectories,
      signal,
    });
    state = transitionAnalysisState(state, { inventory });
    const graph = new EvidenceGraph();
    const architectureSource: EvidenceSource = { file: ".", startLine: 1, endLine: Math.max(1, inventory.sourceRoots.length), text: inventory.sourceRoots.join("\n") || "(no source roots detected)" };
    if (request.mode === "architecture") {
      graph.addNode({ id: "repository:root", kind: "file", label: path.basename(inventory.root), status: "verified", confidence: 1, evidence: [architectureSource] });
      for (const directory of inventory.sourceRoots.slice(0, state.limits.graphNodes - 1)) {
        const evidence = { ...architectureSource, text: directory };
        const id = `file:${directory}`;
        graph.addNode({ id, kind: "file", label: directory, status: "verified", confidence: 0.9, evidence: [evidence] });
        graph.addEdge({ id: `repository:root->${id}:imports`, from: "repository:root", to: id, kind: "imports", status: "inferred", confidence: 0.65, evidence: [evidence] });
      }
      const graphData = graph.toJSON();
      const completion = decideCompletion(request, graphData, { initiation: false, sideEffect: false, response: false }, { hasResults: true });
      state = transitionAnalysisState(state, { graph: graphData, status: completion.status, reason: completion.reason });
      return { request, state, graph: graphData, completion, coverage: { initiation: false, sideEffect: false, response: false } };
    }

    const entities = request.entities;
    const queries = generateSearchQueries(entities, inventory, { maxQueries: Math.min(this.options.maxQueries ?? 40, state.limits.searches) });
    const availableFiles = await listFiles(root, { limit: Math.min(this.options.maxInventoryFiles ?? 20_000, 5_000), signal });
    let pendingQueries = queries.map((query) => query.query);
    let executedQueries: string[] = [];
    const candidates = [];
    let consumed = { ...state.consumed };
    for (const query of queries) {
      if (signal?.aborted) break;
      if (checkAnalysisBudget(state)) break;
      const matches = await searchCode(root, query.query, { mode: "exact", files: availableFiles, limit: Math.min(state.limits.results, 500), signal });
      candidates.push(...matches.map((match) => ({
        file: match.file, line: match.line, text: match.text, queryFamilies: [query.family],
        reasons: candidateReasons(match.file, match.text, query.query, query.exact),
      })));
      executedQueries = [...executedQueries, query.query];
      pendingQueries = pendingQueries.slice(1);
      consumed = { ...consumed, searches: consumed.searches + 1 };
      state = transitionAnalysisState(state, { pendingQueries, executedQueries, consumed });
    }
    const ranked = rankCandidates(candidates).slice(0, state.limits.results);
    const maxFiles = Math.min(this.options.maxCandidateFiles ?? 20, state.limits.files);
    const selected = ranked.filter((candidate, index, all) => all.findIndex((item) => item.file === candidate.file && item.line === candidate.line) === index).slice(0, maxFiles);
    const regions: EvidenceSource[] = [];
    const filesRead: string[] = [];
    let linesRead = 0;
    for (const candidate of selected) {
      if (signal?.aborted || linesRead >= state.limits.lines) break;
      const remaining = state.limits.lines - linesRead;
      const startLine = Math.max(1, candidate.line - 8);
      const lineCount = Math.min(17, remaining);
      if (lineCount < 1) break;
      try {
        const read = await readWorkspaceFile(root, candidate.file, { startLine, endLine: startLine + lineCount - 1, maxLines: lineCount, signal });
        const names = declaredNames(read.text);
        const matchingSymbol = names.find((name) => candidate.text.includes(name));
        const capture = analyzeReadRegion(read, matchingSymbol);
        regions.push({ file: capture.file, startLine: capture.startLine, endLine: capture.endLine, text: capture.text });
        filesRead.push(candidate.file);
        linesRead += capture.endLine - capture.startLine + 1;
      } catch { /* Ignored, binary, and changing files are not evidence. */ }
    }
    const knownSymbols = new Set(regions.flatMap((region) => declaredNames(region.text)));
    const symbolProvider = new TypeScriptCompilerSymbolProvider();
    for (const symbol of request.targetSymbols) {
      const definitions = await symbolProvider.findSymbol(root, symbol, 20);
      for (const definition of definitions) {
        const result = await readWorkspaceFile(root, definition.file, { startLine: definition.line, endLine: definition.line, maxLines: 1, signal });
        const evidence = { file: definition.file, startLine: definition.line, endLine: definition.line, text: result.text };
        graph.addNode({ id: `symbol:${definition.file}:${symbol}`, kind: "symbol", label: symbol, status: "verified", confidence: 1, evidence: [evidence] });
      }
    }
    const callSteps = traceCalls(regions, knownSymbols);
    for (const step of callSteps) {
      const from = `symbol:${step.evidence.file}:${step.from}`;
      const targetName = step.to.split(".").at(-1) ?? step.to;
      const to = `symbol:${targetName}`;
      graph.addNode({ id: from, kind: "symbol", label: step.from, status: "verified", confidence: 0.9, evidence: [step.evidence] });
      if (step.status === "unresolved") {
        graph.addUnresolved({ id: `call:${from}:${targetName}:${step.evidence.startLine}`, from, relation: "calls", targetHint: targetName, reason: "Call target was not resolved in captured TypeScript symbols", evidence: [step.evidence], suggestedTool: "find_symbol", query: targetName });
        continue;
      }
      graph.addNode({ id: to, kind: "symbol", label: targetName, status: step.status === "verified" ? "verified" : "inferred", confidence: step.status === "verified" ? 0.9 : 0.55, evidence: [step.evidence] });
      graph.addEdge({ id: `${from}->${to}:calls:${step.evidence.startLine}`, from, to, kind: "calls", status: step.status === "verified" ? "verified" : "inferred", confidence: step.status === "verified" ? 0.9 : 0.55, evidence: [step.evidence] });
    }
    const dataSteps = traceDataFlow(regions);
    for (const step of dataSteps.filter((item) => item.kind === "side_effect")) {
      const id = `database:${step.expression}`;
      graph.addNode({ id, kind: "database", label: step.expression, status: "inferred", confidence: 0.6, evidence: [step.evidence] });
      const from = `symbol:${step.evidence.file}:side-effect`;
      graph.addNode({ id: from, kind: "symbol", label: "side-effect", status: "verified", confidence: 0.8, evidence: [step.evidence] });
      graph.addEdge({ id: `${from}->${id}:writes`, from, to: id, kind: "writes", status: "verified", confidence: 0.8, evidence: [step.evidence] });
    }
    resolveFrameworkRelationships(regions, graph);
    const graphData = graph.toJSON();
    const coverage = {
      initiation: graphData.edges.some((edge) => edge.kind === "handles" || edge.kind === "routes_to"),
      sideEffect: dataSteps.some((step) => step.kind === "side_effect") || graphData.edges.some((edge) => edge.kind === "writes"),
      response: regions.some((region) => /\breturn\b|\.json\s*\(|\.send\s*\(/.test(region.text)),
    };
    const budgetReason = checkAnalysisBudget(state);
    const hasResults = ranked.length > 0 || inventory.sourceRoots.length > 0;
    const ambiguous = ranked.length > 1 && ranked[0]?.score === ranked[1]?.score && ranked[0]?.file !== ranked[1]?.file && graphData.edges.length === 0;
    const completion = decideCompletion(request, graphData, coverage, { budgetReason, cancelled: signal?.aborted, ambiguous, hasResults });
    state = transitionAnalysisState(state, {
      pendingQueries,
      executedQueries,
      candidates: ranked,
      graph: graphData,
      filesRead,
      consumed: { ...consumed, lines: linesRead },
      status: completion.status,
      reason: completion.reason,
    });
    return { request, state, graph: graphData, completion, coverage };
  }
}

export function createAnalysisService(options: AnalysisOrchestratorOptions = {}) {
  const orchestrator = new AnalysisOrchestrator(options);
  return { analyze: orchestrator.analyze.bind(orchestrator) };
}