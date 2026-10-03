"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.searchCandidateSchema = exports.rankingReasonSchema = void 0;
exports.rankCandidates = rankCandidates;
const zod_1 = require("zod");
exports.rankingReasonSchema = zod_1.z.enum(["exact_symbol", "definition", "phrase_match", "ui_trigger", "route", "framework_location", "connected_candidate", "comment", "documentation", "fixture", "generated", "reexport", "filename_only"]);
exports.searchCandidateSchema = zod_1.z.object({
    file: zod_1.z.string().min(1),
    line: zod_1.z.number().int().min(1),
    endLine: zod_1.z.number().int().min(1).optional(),
    symbol: zod_1.z.string().optional(),
    text: zod_1.z.string().max(10_000),
    queryFamilies: zod_1.z.array(zod_1.z.string()),
    reasons: zod_1.z.array(exports.rankingReasonSchema),
    score: zod_1.z.number(),
}).strict();
const weights = {
    exact_symbol: 100, definition: 45, phrase_match: 25, ui_trigger: 18, route: 15, framework_location: 10,
    connected_candidate: 12, comment: -25, documentation: -35, fixture: -20, generated: -100, reexport: -15, filename_only: 0,
};
function rankCandidates(candidates) {
    const merged = new Map();
    for (const candidate of candidates) {
        const key = `${candidate.file}:${candidate.line}:${candidate.symbol ?? ""}`;
        const existing = merged.get(key);
        if (existing) {
            existing.reasons = [...new Set([...existing.reasons, ...candidate.reasons])];
            existing.queryFamilies = [...new Set([...existing.queryFamilies, ...candidate.queryFamilies])];
            if (candidate.text.length > existing.text.length)
                existing.text = candidate.text;
        }
        else
            merged.set(key, { ...candidate, reasons: [...new Set(candidate.reasons)], queryFamilies: [...new Set(candidate.queryFamilies)] });
    }
    return [...merged.values()].map((candidate) => ({ ...candidate, score: candidate.reasons.reduce((score, reason) => score + weights[reason], 0) }))
        .sort((a, b) => b.score - a.score || a.file.localeCompare(b.file) || a.line - b.line || (a.symbol ?? "").localeCompare(b.symbol ?? ""));
}
