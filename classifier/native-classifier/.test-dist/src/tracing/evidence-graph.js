"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EvidenceGraph = exports.evidenceGraphSchema = exports.unresolvedLinkSchema = exports.evidenceEdgeSchema = exports.evidenceNodeSchema = exports.evidenceSourceSchema = void 0;
const zod_1 = require("zod");
exports.evidenceSourceSchema = zod_1.z.object({ file: zod_1.z.string().min(1), startLine: zod_1.z.number().int().min(1), endLine: zod_1.z.number().int().min(1), text: zod_1.z.string().max(20_000) }).strict();
exports.evidenceNodeSchema = zod_1.z.object({
    id: zod_1.z.string().min(1),
    kind: zod_1.z.enum(["file", "symbol", "route", "event", "database", "external_api"]),
    label: zod_1.z.string().min(1),
    status: zod_1.z.enum(["verified", "inferred"]),
    confidence: zod_1.z.number().min(0).max(1),
    evidence: zod_1.z.array(exports.evidenceSourceSchema).min(1),
}).strict();
exports.evidenceEdgeSchema = zod_1.z.object({
    id: zod_1.z.string().min(1),
    from: zod_1.z.string().min(1),
    to: zod_1.z.string().min(1),
    kind: zod_1.z.enum(["calls", "imports", "emits", "handles", "reads", "writes", "routes_to", "injects"]),
    status: zod_1.z.enum(["verified", "inferred"]),
    confidence: zod_1.z.number().min(0).max(1),
    evidence: zod_1.z.array(exports.evidenceSourceSchema).min(1),
}).strict();
exports.unresolvedLinkSchema = zod_1.z.object({
    id: zod_1.z.string().min(1),
    from: zod_1.z.string().min(1),
    relation: zod_1.z.string().min(1),
    targetHint: zod_1.z.string().min(1),
    reason: zod_1.z.string().min(1),
    evidence: zod_1.z.array(exports.evidenceSourceSchema).min(1),
    suggestedTool: zod_1.z.string().min(1),
    query: zod_1.z.string().min(1),
}).strict();
exports.evidenceGraphSchema = zod_1.z.object({
    nodes: zod_1.z.array(exports.evidenceNodeSchema),
    edges: zod_1.z.array(exports.evidenceEdgeSchema),
    unresolved: zod_1.z.array(exports.unresolvedLinkSchema),
}).strict();
function mergeSources(first, second) {
    const map = new Map();
    for (const source of [...first, ...second])
        map.set(`${source.file}:${source.startLine}:${source.endLine}`, source);
    return [...map.values()].sort((a, b) => a.file.localeCompare(b.file) || a.startLine - b.startLine || a.endLine - b.endLine);
}
class EvidenceGraph {
    nodes = new Map();
    edges = new Map();
    unresolved = new Map();
    addNode(node) {
        const valid = exports.evidenceNodeSchema.parse(node);
        const existing = this.nodes.get(valid.id);
        this.nodes.set(valid.id, existing ? {
            ...existing,
            status: existing.status === "verified" || valid.status === "verified" ? "verified" : "inferred",
            confidence: Math.max(existing.confidence, valid.confidence),
            evidence: mergeSources(existing.evidence, valid.evidence),
        } : valid);
    }
    addEdge(edge) {
        const valid = exports.evidenceEdgeSchema.parse(edge);
        const existing = this.edges.get(valid.id);
        this.edges.set(valid.id, existing ? {
            ...existing,
            status: existing.status === "verified" || valid.status === "verified" ? "verified" : "inferred",
            confidence: Math.max(existing.confidence, valid.confidence),
            evidence: mergeSources(existing.evidence, valid.evidence),
        } : valid);
    }
    addUnresolved(link) {
        const valid = exports.unresolvedLinkSchema.parse(link);
        const existing = this.unresolved.get(valid.id);
        this.unresolved.set(valid.id, existing ? { ...existing, evidence: mergeSources(existing.evidence, valid.evidence) } : valid);
    }
    toJSON() {
        return exports.evidenceGraphSchema.parse({
            nodes: [...this.nodes.values()].sort((a, b) => a.id.localeCompare(b.id)),
            edges: [...this.edges.values()].sort((a, b) => a.id.localeCompare(b.id)),
            unresolved: [...this.unresolved.values()].sort((a, b) => a.id.localeCompare(b.id)),
        });
    }
}
exports.EvidenceGraph = EvidenceGraph;
