import { randomUUID } from "node:crypto";
import { z } from "zod";
import { extractAnalysisEntities } from "../extraction/feature-terms";
import { analysisEntitySchema } from "../extraction/analysis-entities";

export const analysisModes = ["architecture", "feature_flow", "symbol_usage", "data_flow", "dependency", "error_path"] as const;

const safeRelativePath = z.string().max(500).refine((value) => {
  if (!value || value.includes("\0") || value.startsWith("/") || value.startsWith("\\")) return false;
  if (/^[a-zA-Z]:/.test(value)) return false;
  return !value.split(/[\\/]+/).some((part) => part === ".." || part === ".");
}, "Expected a safe workspace-relative path");

const outputSchema = z.object({
  includeFileReferences: z.boolean(),
  includeCallFlow: z.boolean(),
  includeUncertainty: z.boolean(),
}).strict();

export const analysisRequestSchema = z.object({
  requestId: z.string().min(1).max(120),
  mode: z.enum(analysisModes),
  question: z.string().trim().min(1).max(20_000),
  targetTerms: z.array(z.string().trim().min(1).max(240)).max(50),
  targetSymbols: z.array(z.string().trim().min(1).max(240)).max(50),
  entities: z.array(analysisEntitySchema).max(100),
  scope: z.object({
    repository: z.string().trim().min(1).max(500),
    directories: z.array(safeRelativePath).max(100),
    excludePatterns: z.array(safeRelativePath).max(100),
  }).strict(),
  constraints: z.array(z.literal("read_only")).min(1).max(1),
  output: outputSchema,
}).strict();

export type AnalysisMode = z.infer<typeof analysisRequestSchema>["mode"];
export type AnalysisRequest = z.infer<typeof analysisRequestSchema>;

export type AnalysisRequestOptions = Partial<Pick<AnalysisRequest, "mode" | "requestId" | "targetTerms" | "targetSymbols">> & {
  repository?: string;
  directories?: string[];
  excludePatterns?: string[];
  output?: Partial<AnalysisRequest["output"]>;
};

export function inferAnalysisMode(question: string, entities = extractAnalysisEntities(question)): AnalysisMode {
  if (/\b(error|exception|failure|throw|catch|reject)\b/i.test(question)) return "error_path";
  if (/\b(dependenc(?:y|ies)|depends on|imports?)\b/i.test(question)) return "dependency";
  if (/\b(data flow|transformation|maps?|serialize|deserialize)\b/i.test(question)) return "data_flow";
  if (/\b(who calls|references? to|usages? of)\b/i.test(question) || entities.some((entity) => entity.type === "symbol")) return "symbol_usage";
  if (/\b(analy[sz]e|architecture|structure|codebase|repository)\b/i.test(question) && !entities.some((entity) => entity.type === "feature")) return "architecture";
  return "feature_flow";
}

export function createAnalysisRequest(question: string, options: AnalysisRequestOptions = {}): AnalysisRequest {
  const entities = extractAnalysisEntities(question);
  const inferredMode = inferAnalysisMode(question, entities);
  const targetTerms = options.targetTerms ?? entities.filter((entity) => entity.type === "feature").map((entity) => entity.normalizedValue);
  const targetSymbols = options.targetSymbols ?? entities.filter((entity) => entity.type === "symbol").map((entity) => entity.value);
  return analysisRequestSchema.parse({
    requestId: options.requestId ?? randomUUID(),
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