import { z } from "zod";

const relativePathSchema = z.string().min(1).max(1_000).refine((value) =>
  !value.includes("\0") && !value.startsWith("/") && !value.startsWith("\\") && !/^[a-zA-Z]:/.test(value)
  && !value.split(/[\\/]+/).some((part) => part === ".." || part === "."), "Expected a workspace-relative path");
const patternsSchema = z.array(z.string().min(1).max(500)).max(100).default([]);
const limitSchema = z.number().int().min(1).max(2_000).default(100);

export const analysisToolNames = [
  "list_repository", "list_files", "search_code", "find_symbol", "find_references", "find_implementations",
  "read_file", "get_project_metadata", "get_diagnostics", "respond",
] as const;
export type AnalysisToolName = typeof analysisToolNames[number];

export const toolInputSchemas = {
  list_repository: z.object({}).strict(),
  list_files: z.object({ directory: relativePathSchema.optional(), include: patternsSchema, exclude: patternsSchema, limit: limitSchema }).strict(),
  search_code: z.object({ query: z.string().min(1).max(1_000), mode: z.enum(["exact", "regex"]).default("exact"), include: patternsSchema, exclude: patternsSchema, limit: limitSchema }).strict(),
  find_symbol: z.object({ symbol: z.string().trim().min(1).max(240), include: patternsSchema, limit: limitSchema }).strict(),
  find_references: z.object({ symbol: z.string().trim().min(1).max(240), includeDefinition: z.boolean().default(false), include: patternsSchema, limit: limitSchema }).strict(),
  find_implementations: z.object({ symbol: z.string().trim().min(1).max(240), include: patternsSchema, limit: limitSchema }).strict(),
  read_file: z.object({ file: relativePathSchema, startLine: z.number().int().min(1), endLine: z.number().int().min(1), maxLines: z.number().int().min(1).max(500).default(200) }).strict().refine((input) => input.endLine >= input.startLine && input.endLine - input.startLine + 1 <= input.maxLines, "Invalid or unbounded line range"),
  get_project_metadata: z.object({}).strict(),
  get_diagnostics: z.object({ file: relativePathSchema.optional(), limit: limitSchema }).strict(),
  respond: z.object({ message: z.string().min(1).max(10_000) }).strict(),
} satisfies Record<AnalysisToolName, z.ZodTypeAny>;

export const evidenceSchema = z.object({
  file: relativePathSchema,
  startLine: z.number().int().min(1).optional(),
  endLine: z.number().int().min(1).optional(),
  symbol: z.string().optional(),
  text: z.string().max(20_000),
}).strict();

export const toolResultSchema = z.object({
  tool: z.enum(analysisToolNames),
  query: z.string().max(1_000),
  items: z.array(z.unknown()).max(2_000),
  evidence: z.array(evidenceSchema).max(2_000),
}).strict();
export type ToolResult = z.infer<typeof toolResultSchema>;

export type ReadOnlyAnalysisRegistry = {
  [Name in AnalysisToolName]?: (input: z.infer<(typeof toolInputSchemas)[Name]>) => Promise<ToolResult> | ToolResult;
};

export function createReadOnlyRegistry(handlers: ReadOnlyAnalysisRegistry) {
  const registered = new Map<AnalysisToolName, (input: unknown) => Promise<ToolResult>>();
  for (const name of analysisToolNames) {
    const handler = handlers[name] as ((input: unknown) => Promise<ToolResult> | ToolResult) | undefined;
    if (!handler) continue;
    registered.set(name, async (input) => {
      const validatedInput = toolInputSchemas[name].parse(input);
      const result = await handler(validatedInput);
      const validatedResult = toolResultSchema.parse(result);
      if (validatedResult.tool !== name) throw new Error("Tool result does not match the invoked tool");
      return validatedResult;
    });
  }
  return {
    names: [...registered.keys()],
    async invoke(name: string, input: unknown): Promise<ToolResult> {
      if (!analysisToolNames.includes(name as AnalysisToolName)) throw new Error(`Tool is not allowed for analysis: ${name}`);
      const handler = registered.get(name as AnalysisToolName);
      if (!handler) throw new Error(`Analysis tool is unavailable: ${name}`);
      return handler(input);
    },
  };
}