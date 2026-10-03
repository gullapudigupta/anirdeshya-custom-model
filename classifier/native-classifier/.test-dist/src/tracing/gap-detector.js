"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.analysisGapSchema = void 0;
exports.detectGaps = detectGaps;
const zod_1 = require("zod");
exports.analysisGapSchema = zod_1.z.object({
    id: zod_1.z.string(),
    kind: zod_1.z.enum(["implementation", "route_prefix", "event_handler", "dependency_injection", "external_repository", "dynamic_dispatch", "external_api", "other"]),
    whyItMatters: zod_1.z.string(),
    evidence: zod_1.z.array(zod_1.z.object({ file: zod_1.z.string(), startLine: zod_1.z.number(), endLine: zod_1.z.number(), text: zod_1.z.string() }).strict()),
    query: zod_1.z.string(),
    tool: zod_1.z.string(),
}).strict();
function classify(link) {
    const value = `${link.relation} ${link.targetHint} ${link.reason}`.toLowerCase();
    if (value.includes("implement"))
        return "implementation";
    if (value.includes("prefix") || value.includes("route"))
        return "route_prefix";
    if (value.includes("event") || value.includes("handler"))
        return "event_handler";
    if (value.includes("inject") || value.includes("binding"))
        return "dependency_injection";
    if (value.includes("repository") || value.includes("database"))
        return "external_repository";
    if (value.includes("dynamic") || value.includes("dispatch"))
        return "dynamic_dispatch";
    if (value.includes("external api") || value.includes("external_api"))
        return "external_api";
    return "other";
}
function detectGaps(graph) {
    const gaps = new Map();
    for (const link of graph.toJSON().unresolved) {
        const kind = classify(link);
        const gap = exports.analysisGapSchema.parse({
            id: link.id,
            kind,
            whyItMatters: link.reason,
            evidence: link.evidence,
            query: link.query,
            tool: link.suggestedTool,
        });
        const key = `${gap.kind}:${gap.query.toLowerCase()}:${gap.tool}`;
        if (!gaps.has(key))
            gaps.set(key, gap);
    }
    return [...gaps.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.query.localeCompare(b.query));
}
