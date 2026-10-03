"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const promises_1 = require("node:fs/promises");
const node_path_1 = __importDefault(require("node:path"));
const node_test_1 = __importDefault(require("node:test"));
const analysis_orchestrator_1 = require("../src/analysis/analysis-orchestrator");
const analysis_report_1 = require("../src/reporting/analysis-report");
const secret_redactor_1 = require("../src/reporting/secret-redactor");
const fixtureRoot = node_path_1.default.join(process.cwd(), "test", "fixtures", "codebase-analysis");
(0, node_test_1.default)("evaluation finds the known save entry point deterministically and never exposes fixture secrets", async () => {
    const first = await new analysis_orchestrator_1.AnalysisOrchestrator({ maxQueries: 12, maxCandidateFiles: 8 }).analyze(fixtureRoot, "trace save flow");
    const second = await new analysis_orchestrator_1.AnalysisOrchestrator({ maxQueries: 12, maxCandidateFiles: 8 }).analyze(fixtureRoot, "trace save flow");
    const normalize = (value) => JSON.stringify(value, (_key, item) => _key === "requestId" ? "stable" : item);
    strict_1.default.equal(normalize(first.graph), normalize(second.graph));
    strict_1.default.ok(first.graph.nodes.some((node) => node.label === "save"));
    strict_1.default.ok(first.graph.edges.length > 0);
    const report = (0, analysis_report_1.buildAnalysisReport)(first.request, first.completion, first.graph);
    const fixture = await (0, promises_1.readFile)(node_path_1.default.join(fixtureRoot, "expected-save-flow.json"), "utf8");
    strict_1.default.doesNotMatch((0, secret_redactor_1.redactSecrets)(JSON.stringify(report)), /fixture-secret-must-not-appear/);
    strict_1.default.ok(fixture.includes('"requiredEdges"'));
});
