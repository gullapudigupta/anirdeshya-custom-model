import { z } from "zod";

export const analysisEntityTypes = [
  "feature",
  "symbol",
  "file",
  "directory",
  "framework",
  "endpoint",
  "event",
  "database_entity",
] as const;

export const analysisEntitySchema = z.object({
  type: z.enum(analysisEntityTypes),
  value: z.string().trim().min(1).max(240),
  normalizedValue: z.string().trim().min(1).max(240),
  confidence: z.number().min(0).max(1),
}).strict();

export type AnalysisEntity = z.infer<typeof analysisEntitySchema>;