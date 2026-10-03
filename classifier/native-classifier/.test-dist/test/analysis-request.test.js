"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const analysis_request_1 = require("../src/analysis/analysis-request");
(0, node_test_1.default)("builds broad architecture requests with safe defaults", () => {
    const request = (0, analysis_request_1.createAnalysisRequest)("Analyze this codebase");
    strict_1.default.equal(request.mode, "architecture");
    strict_1.default.deepEqual(request.constraints, ["read_only"]);
    strict_1.default.deepEqual(request.scope.excludePatterns, ["node_modules", "dist", "coverage", ".git"]);
});
(0, node_test_1.default)("extracts a feature from natural language flow questions", () => {
    for (const question of ["find how save works", "trace the save flow"]) {
        const request = (0, analysis_request_1.createAnalysisRequest)(question);
        strict_1.default.equal(request.mode, "feature_flow");
        strict_1.default.ok(request.targetTerms.includes("save"));
    }
});
(0, node_test_1.default)("preserves quoted symbols as higher-confidence symbol targets", () => {
    const request = (0, analysis_request_1.createAnalysisRequest)('Who calls "persistOrder"?');
    strict_1.default.equal(request.mode, "symbol_usage");
    strict_1.default.deepEqual(request.targetSymbols, ["persistOrder"]);
    strict_1.default.equal(request.entities[0]?.confidence, 0.99);
});
(0, node_test_1.default)("rejects invalid modes, blank questions, unsafe paths, and malformed output", () => {
    const valid = (0, analysis_request_1.createAnalysisRequest)("Analyze this codebase");
    strict_1.default.equal(analysis_request_1.analysisRequestSchema.safeParse({ ...valid, mode: "mutate" }).success, false);
    strict_1.default.equal(analysis_request_1.analysisRequestSchema.safeParse({ ...valid, question: "  " }).success, false);
    strict_1.default.equal(analysis_request_1.analysisRequestSchema.safeParse({ ...valid, scope: { ...valid.scope, directories: ["../outside"] } }).success, false);
    strict_1.default.equal(analysis_request_1.analysisRequestSchema.safeParse({ ...valid, output: { ...valid.output, includeCallFlow: "yes" } }).success, false);
});
