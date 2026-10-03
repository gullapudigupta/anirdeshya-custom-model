"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AnalysisOrchestrator = void 0;
exports.createAnalysisService = createAnalysisService;
const node_path_1 = __importDefault(require("node:path"));
const analysis_request_1 = require("./analysis-request");
const evidence_capture_1 = require("./evidence-capture");
const completion_policy_1 = require("./completion-policy");
const analysis_state_1 = require("./analysis-state");
const repository_inventory_1 = require("../repository/repository-inventory");
const file_search_1 = require("../search/file-search");
const text_search_1 = require("../search/text-search");
const read_file_1 = require("../repository/read-file");
const compiler_symbol_provider_1 = require("../search/compiler-symbol-provider");
const query_generator_1 = require("../search/query-generator");
const result_ranker_1 = require("../search/result-ranker");
const evidence_graph_1 = require("../tracing/evidence-graph");
const call_graph_1 = require("../tracing/call-graph");
const data_flow_1 = require("../tracing/data-flow");
const framework_resolvers_1 = require("../tracing/framework-resolvers");
function candidateReasons(file, text, query, exactSymbol) {
    const reasons = [];
    const lower = file.toLowerCase();
    if (exactSymbol && new RegExp(`\\b${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(text))
        reasons.push("exact_symbol");
    if (new RegExp(`\\b(?:function|class|interface|const|let|var)\\s+${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(text))
        reasons.push("definition");
    if (/^\s*(?:\/\/|\*|<!--)/.test(text))
        reasons.push("comment");
    if (/\.(?:md|mdx|rst|txt)$/i.test(lower))
        reasons.push("documentation");
    if (/(?:^|\/)(?:fixtures?|__tests__|test|tests)(?:\/|$)/i.test(lower))
        reasons.push("fixture");
    if (/(?:^|\/)(?:dist|build|generated|coverage)(?:\/|$)/i.test(lower))
        reasons.push("generated");
    if (/^\s*export\s+\*\s+from/.test(text))
        reasons.push("reexport");
    if (!reasons.length)
        reasons.push("phrase_match");
    return reasons;
}
function declaredNames(text) {
    return [...text.matchAll(/\b(?:function|class|interface|const|let|var)\s+([A-Za-z_$][\w$]*)/g)].map((match) => match[1]);
}
class AnalysisOrchestrator {
    options;
    constructor(options = {}) {
        this.options = options;
    }
    async analyze(root, question, requestOptions = {}, signal) {
        const request = (0, analysis_request_1.createAnalysisRequest)(question, requestOptions);
        const stateLimits = { ...this.options.limits };
        let state = (0, analysis_state_1.createAnalysisState)(request, stateLimits);
        const inventory = await new repository_inventory_1.LocalRepositoryInventory().inventory(root, {
            maxFiles: this.options.maxInventoryFiles,
            maxDirectories: this.options.maxInventoryDirectories,
            signal,
        });
        state = (0, analysis_state_1.transitionAnalysisState)(state, { inventory });
        const graph = new evidence_graph_1.EvidenceGraph();
        const architectureSource = { file: ".", startLine: 1, endLine: Math.max(1, inventory.sourceRoots.length), text: inventory.sourceRoots.join("\n") || "(no source roots detected)" };
        if (request.mode === "architecture") {
            graph.addNode({ id: "repository:root", kind: "file", label: node_path_1.default.basename(inventory.root), status: "verified", confidence: 1, evidence: [architectureSource] });
            for (const directory of inventory.sourceRoots.slice(0, state.limits.graphNodes - 1)) {
                const evidence = { ...architectureSource, text: directory };
                const id = `file:${directory}`;
                graph.addNode({ id, kind: "file", label: directory, status: "verified", confidence: 0.9, evidence: [evidence] });
                graph.addEdge({ id: `repository:root->${id}:imports`, from: "repository:root", to: id, kind: "imports", status: "inferred", confidence: 0.65, evidence: [evidence] });
            }
            const graphData = graph.toJSON();
            const completion = (0, completion_policy_1.decideCompletion)(request, graphData, { initiation: false, sideEffect: false, response: false }, { hasResults: true });
            state = (0, analysis_state_1.transitionAnalysisState)(state, { graph: graphData, status: completion.status, reason: completion.reason });
            return { request, state, graph: graphData, completion, coverage: { initiation: false, sideEffect: false, response: false } };
        }
        const entities = request.entities;
        const queries = (0, query_generator_1.generateSearchQueries)(entities, inventory, { maxQueries: Math.min(this.options.maxQueries ?? 40, state.limits.searches) });
        const availableFiles = await (0, file_search_1.listFiles)(root, { limit: Math.min(this.options.maxInventoryFiles ?? 20_000, 5_000), signal });
        let pendingQueries = queries.map((query) => query.query);
        let executedQueries = [];
        const candidates = [];
        let consumed = { ...state.consumed };
        for (const query of queries) {
            if (signal?.aborted)
                break;
            if ((0, analysis_state_1.checkAnalysisBudget)(state))
                break;
            const matches = await (0, text_search_1.searchCode)(root, query.query, { mode: "exact", files: availableFiles, limit: Math.min(state.limits.results, 500), signal });
            candidates.push(...matches.map((match) => ({
                file: match.file, line: match.line, text: match.text, queryFamilies: [query.family],
                reasons: candidateReasons(match.file, match.text, query.query, query.exact),
            })));
            executedQueries = [...executedQueries, query.query];
            pendingQueries = pendingQueries.slice(1);
            consumed = { ...consumed, searches: consumed.searches + 1 };
            state = (0, analysis_state_1.transitionAnalysisState)(state, { pendingQueries, executedQueries, consumed });
        }
        const ranked = (0, result_ranker_1.rankCandidates)(candidates).slice(0, state.limits.results);
        const maxFiles = Math.min(this.options.maxCandidateFiles ?? 20, state.limits.files);
        const selected = ranked.filter((candidate, index, all) => all.findIndex((item) => item.file === candidate.file && item.line === candidate.line) === index).slice(0, maxFiles);
        const regions = [];
        const filesRead = [];
        let linesRead = 0;
        for (const candidate of selected) {
            if (signal?.aborted || linesRead >= state.limits.lines)
                break;
            const remaining = state.limits.lines - linesRead;
            const startLine = Math.max(1, candidate.line - 8);
            const lineCount = Math.min(17, remaining);
            if (lineCount < 1)
                break;
            try {
                const read = await (0, read_file_1.readWorkspaceFile)(root, candidate.file, { startLine, endLine: startLine + lineCount - 1, maxLines: lineCount, signal });
                const names = declaredNames(read.text);
                const matchingSymbol = names.find((name) => candidate.text.includes(name));
                const capture = (0, evidence_capture_1.analyzeReadRegion)(read, matchingSymbol);
                regions.push({ file: capture.file, startLine: capture.startLine, endLine: capture.endLine, text: capture.text });
                filesRead.push(candidate.file);
                linesRead += capture.endLine - capture.startLine + 1;
            }
            catch { /* Ignored, binary, and changing files are not evidence. */ }
        }
        const knownSymbols = new Set(regions.flatMap((region) => declaredNames(region.text)));
        const symbolProvider = new compiler_symbol_provider_1.TypeScriptCompilerSymbolProvider();
        for (const symbol of request.targetSymbols) {
            const definitions = await symbolProvider.findSymbol(root, symbol, 20);
            for (const definition of definitions) {
                const result = await (0, read_file_1.readWorkspaceFile)(root, definition.file, { startLine: definition.line, endLine: definition.line, maxLines: 1, signal });
                const evidence = { file: definition.file, startLine: definition.line, endLine: definition.line, text: result.text };
                graph.addNode({ id: `symbol:${definition.file}:${symbol}`, kind: "symbol", label: symbol, status: "verified", confidence: 1, evidence: [evidence] });
            }
        }
        const callSteps = (0, call_graph_1.traceCalls)(regions, knownSymbols);
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
        const dataSteps = (0, data_flow_1.traceDataFlow)(regions);
        for (const step of dataSteps.filter((item) => item.kind === "side_effect")) {
            const id = `database:${step.expression}`;
            graph.addNode({ id, kind: "database", label: step.expression, status: "inferred", confidence: 0.6, evidence: [step.evidence] });
            const from = `symbol:${step.evidence.file}:side-effect`;
            graph.addNode({ id: from, kind: "symbol", label: "side-effect", status: "verified", confidence: 0.8, evidence: [step.evidence] });
            graph.addEdge({ id: `${from}->${id}:writes`, from, to: id, kind: "writes", status: "verified", confidence: 0.8, evidence: [step.evidence] });
        }
        (0, framework_resolvers_1.resolveFrameworkRelationships)(regions, graph);
        const graphData = graph.toJSON();
        const coverage = {
            initiation: graphData.edges.some((edge) => edge.kind === "handles" || edge.kind === "routes_to"),
            sideEffect: dataSteps.some((step) => step.kind === "side_effect") || graphData.edges.some((edge) => edge.kind === "writes"),
            response: regions.some((region) => /\breturn\b|\.json\s*\(|\.send\s*\(/.test(region.text)),
        };
        const budgetReason = (0, analysis_state_1.checkAnalysisBudget)(state);
        const hasResults = ranked.length > 0 || inventory.sourceRoots.length > 0;
        const ambiguous = ranked.length > 1 && ranked[0]?.score === ranked[1]?.score && ranked[0]?.file !== ranked[1]?.file && graphData.edges.length === 0;
        const completion = (0, completion_policy_1.decideCompletion)(request, graphData, coverage, { budgetReason, cancelled: signal?.aborted, ambiguous, hasResults });
        state = (0, analysis_state_1.transitionAnalysisState)(state, {
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
exports.AnalysisOrchestrator = AnalysisOrchestrator;
function createAnalysisService(options = {}) {
    const orchestrator = new AnalysisOrchestrator(options);
    return { analyze: orchestrator.analyze.bind(orchestrator) };
}
