import { z } from "zod";

export const rankingReasonSchema = z.enum(["exact_symbol", "definition", "phrase_match", "ui_trigger", "route", "framework_location", "connected_candidate", "comment", "documentation", "fixture", "generated", "reexport", "filename_only"]);
export const searchCandidateSchema = z.object({
  file: z.string().min(1),
  line: z.number().int().min(1),
  endLine: z.number().int().min(1).optional(),
  symbol: z.string().optional(),
  text: z.string().max(10_000),
  queryFamilies: z.array(z.string()),
  reasons: z.array(rankingReasonSchema),
  score: z.number(),
}).strict();
export type SearchCandidate = z.infer<typeof searchCandidateSchema>;

const weights: Record<z.infer<typeof rankingReasonSchema>, number> = {
  exact_symbol: 100, definition: 45, phrase_match: 25, ui_trigger: 18, route: 15, framework_location: 10,
  connected_candidate: 12, comment: -25, documentation: -35, fixture: -20, generated: -100, reexport: -15, filename_only: 0,
};

export function rankCandidates(candidates: readonly Omit<SearchCandidate, "score">[]): SearchCandidate[] {
  const merged = new Map<string, Omit<SearchCandidate, "score">>();
  for (const candidate of candidates) {
    const key = `${candidate.file}:${candidate.line}:${candidate.symbol ?? ""}`;
    const existing = merged.get(key);
    if (existing) {
      existing.reasons = [...new Set([...existing.reasons, ...candidate.reasons])];
      existing.queryFamilies = [...new Set([...existing.queryFamilies, ...candidate.queryFamilies])];
      if (candidate.text.length > existing.text.length) existing.text = candidate.text;
    } else merged.set(key, { ...candidate, reasons: [...new Set(candidate.reasons)], queryFamilies: [...new Set(candidate.queryFamilies)] });
  }
  return [...merged.values()].map((candidate) => ({ ...candidate, score: candidate.reasons.reduce((score, reason) => score + weights[reason], 0) }))
    .sort((a, b) => b.score - a.score || a.file.localeCompare(b.file) || a.line - b.line || (a.symbol ?? "").localeCompare(b.symbol ?? ""));
}