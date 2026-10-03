"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toolResultSchema = exports.evidenceSchema = exports.toolInputSchemas = exports.analysisToolNames = void 0;
exports.createReadOnlyRegistry = createReadOnlyRegistry;
const zod_1 = require("zod");
const relativePathSchema = zod_1.z.string().min(1).max(1_000).refine((value) => !value.includes("\0") && !value.startsWith("/") && !value.startsWith("\\") && !/^[a-zA-Z]:/.test(value)
    && !value.split(/[\\/]+/).some((part) => part === ".." || part === "."), "Expected a workspace-relative path");
const patternsSchema = zod_1.z.array(zod_1.z.string().min(1).max(500)).max(100).default([]);
const limitSchema = zod_1.z.number().int().min(1).max(2_000).default(100);
exports.analysisToolNames = [
    "list_repository", "list_files", "search_code", "find_symbol", "find_references", "find_implementations",
    "read_file", "get_project_metadata", "get_diagnostics", "respond",
];
exports.toolInputSchemas = {
    list_repository: zod_1.z.object({}).strict(),
    list_files: zod_1.z.object({ directory: relativePathSchema.optional(), include: patternsSchema, exclude: patternsSchema, limit: limitSchema }).strict(),
    search_code: zod_1.z.object({ query: zod_1.z.string().min(1).max(1_000), mode: zod_1.z.enum(["exact", "regex"]).default("exact"), include: patternsSchema, exclude: patternsSchema, limit: limitSchema }).strict(),
    find_symbol: zod_1.z.object({ symbol: zod_1.z.string().trim().min(1).max(240), include: patternsSchema, limit: limitSchema }).strict(),
    find_references: zod_1.z.object({ symbol: zod_1.z.string().trim().min(1).max(240), includeDefinition: zod_1.z.boolean().default(false), include: patternsSchema, limit: limitSchema }).strict(),
    find_implementations: zod_1.z.object({ symbol: zod_1.z.string().trim().min(1).max(240), include: patternsSchema, limit: limitSchema }).strict(),
    read_file: zod_1.z.object({ file: relativePathSchema, startLine: zod_1.z.number().int().min(1), endLine: zod_1.z.number().int().min(1), maxLines: zod_1.z.number().int().min(1).max(500).default(200) }).strict().refine((input) => input.endLine >= input.startLine && input.endLine - input.startLine + 1 <= input.maxLines, "Invalid or unbounded line range"),
    get_project_metadata: zod_1.z.object({}).strict(),
    get_diagnostics: zod_1.z.object({ file: relativePathSchema.optional(), limit: limitSchema }).strict(),
    respond: zod_1.z.object({ message: zod_1.z.string().min(1).max(10_000) }).strict(),
};
exports.evidenceSchema = zod_1.z.object({
    file: relativePathSchema,
    startLine: zod_1.z.number().int().min(1).optional(),
    endLine: zod_1.z.number().int().min(1).optional(),
    symbol: zod_1.z.string().optional(),
    text: zod_1.z.string().max(20_000),
}).strict();
exports.toolResultSchema = zod_1.z.object({
    tool: zod_1.z.enum(exports.analysisToolNames),
    query: zod_1.z.string().max(1_000),
    items: zod_1.z.array(zod_1.z.unknown()).max(2_000),
    evidence: zod_1.z.array(exports.evidenceSchema).max(2_000),
}).strict();
function createReadOnlyRegistry(handlers) {
    const registered = new Map();
    for (const name of exports.analysisToolNames) {
        const handler = handlers[name];
        if (!handler)
            continue;
        registered.set(name, async (input) => {
            const validatedInput = exports.toolInputSchemas[name].parse(input);
            const result = await handler(validatedInput);
            const validatedResult = exports.toolResultSchema.parse(result);
            if (validatedResult.tool !== name)
                throw new Error("Tool result does not match the invoked tool");
            return validatedResult;
        });
    }
    return {
        names: [...registered.keys()],
        async invoke(name, input) {
            if (!exports.analysisToolNames.includes(name))
                throw new Error(`Tool is not allowed for analysis: ${name}`);
            const handler = registered.get(name);
            if (!handler)
                throw new Error(`Analysis tool is unavailable: ${name}`);
            return handler(input);
        },
    };
}
