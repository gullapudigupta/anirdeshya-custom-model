"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.analysisRequestSchema = exports.analysisModes = void 0;
exports.inferAnalysisMode = inferAnalysisMode;
exports.createAnalysisRequest = createAnalysisRequest;
const node_crypto_1 = require("node:crypto");
const zod_1 = require("zod");
const feature_terms_1 = require("../extraction/feature-terms");
const analysis_entities_1 = require("../extraction/analysis-entities");
exports.analysisModes = ["architecture", "feature_flow", "symbol_usage", "data_flow", "dependency", "error_path"];
const safeRelativePath = zod_1.z.string().max(500).refine((value) => {
    if (!value || value.includes("\0") || value.startsWith("/") || value.startsWith("\\"))
        return false;
    if (/^[a-zA-Z]:/.test(value))
        return false;
    return !value.split(/[\\/]+/).some((part) => part === ".." || part === ".");
}, "Expected a safe workspace-relative path");
const outputSchema = zod_1.z.object({
    includeFileReferences: zod_1.z.boolean(),
    includeCallFlow: zod_1.z.boolean(),
    includeUncertainty: zod_1.z.boolean(),
}).strict();
exports.analysisRequestSchema = zod_1.z.object({
    requestId: zod_1.z.string().min(1).max(120),
    mode: zod_1.z.enum(exports.analysisModes),
    question: zod_1.z.string().trim().min(1).max(20_000),
    targetTerms: zod_1.z.array(zod_1.z.string().trim().min(1).max(240)).max(50),
    targetSymbols: zod_1.z.array(zod_1.z.string().trim().min(1).max(240)).max(50),
    entities: zod_1.z.array(analysis_entities_1.analysisEntitySchema).max(100),
    scope: zod_1.z.object({
        repository: zod_1.z.string().trim().min(1).max(500),
        directories: zod_1.z.array(safeRelativePath).max(100),
        excludePatterns: zod_1.z.array(safeRelativePath).max(100),
    }).strict(),
    constraints: zod_1.z.array(zod_1.z.literal("read_only")).min(1).max(1),
    output: outputSchema,
}).strict();
function inferAnalysisMode(question, entities = (0, feature_terms_1.extractAnalysisEntities)(question)) {
    if (/\b(error|exception|failure|throw|catch|reject)\b/i.test(question))
        return "error_path";
    if (/\b(dependenc(?:y|ies)|depends on|imports?)\b/i.test(question))
        return "dependency";
    if (/\b(data flow|transformation|maps?|serialize|deserialize)\b/i.test(question))
        return "data_flow";
    if (/\b(who calls|references? to|usages? of)\b/i.test(question) || entities.some((entity) => entity.type === "symbol"))
        return "symbol_usage";
    if (/\b(analy[sz]e|architecture|structure|codebase|repository)\b/i.test(question) && !entities.some((entity) => entity.type === "feature"))
        return "architecture";
    return "feature_flow";
}
function createAnalysisRequest(question, options = {}) {
    const entities = (0, feature_terms_1.extractAnalysisEntities)(question);
    const inferredMode = inferAnalysisMode(question, entities);
    const targetTerms = options.targetTerms ?? entities.filter((entity) => entity.type === "feature").map((entity) => entity.normalizedValue);
    const targetSymbols = options.targetSymbols ?? entities.filter((entity) => entity.type === "symbol").map((entity) => entity.value);
    return exports.analysisRequestSchema.parse({
        requestId: options.requestId ?? (0, node_crypto_1.randomUUID)(),
        mode: options.mode ?? inferredMode,
        question,
        targetTerms,
        targetSymbols,
        entities,
        scope: {
            repository: options.repository ?? "current",
            directories: options.directories ?? [],
            excludePatterns: options.excludePatterns ?? ["node_modules", "dist", "coverage", ".git"],
        },
        constraints: ["read_only"],
        output: {
            includeFileReferences: options.output?.includeFileReferences ?? true,
            includeCallFlow: options.output?.includeCallFlow ?? true,
            includeUncertainty: options.output?.includeUncertainty ?? true,
        },
    });
}
