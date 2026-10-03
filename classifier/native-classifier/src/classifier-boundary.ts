import { randomUUID } from "node:crypto";
import { z } from "zod";
import { createAnalysisRequest, type AnalysisRequest } from "./analysis/analysis-request";
import { createReadOnlyRegistry } from "./search/tool-contracts";

const intents = ["ask", "search_code", "debug_and_fix", "generate_code", "refactor", "explain", "run_tests", "analyze"] as const;
const toolNames = ["ask_clarification", "search_code", "read_file", "edit_file", "run_build", "run_tests", "respond"] as const;

const intentSchema = z.enum(intents);
const toolNameSchema = z.enum(toolNames);

export const agentInputSchema = z.object({
  requestId: z.string().min(1),
  userMessage: z.string().min(1).max(20_000),
  intent: intentSchema,
  domain: z.string().min(1).max(100).optional(),
  entities: z.array(z.string().min(1).max(500)).max(50),
  constraints: z.array(z.string().min(1).max(500)).max(50),
  confidence: z.number().min(0).max(1),
  requiredTools: z.array(toolNameSchema).max(20),
  context: z.object({
    repo: z.string().max(500).optional(),
    openFiles: z.array(z.string().min(1).max(1_000)).max(100),
    recentActions: z.array(z.string().min(1).max(2_000)).max(100),
  }).strict(),
  nextAction: toolNameSchema,
}).strict();

export type AgentInput = z.infer<typeof agentInputSchema>;
export type Intent = z.infer<typeof intentSchema>;
export type ToolName = z.infer<typeof toolNameSchema>;
export type ClassificationContext = {
  repo?: string;
  openFiles?: string[];
  recentActions?: string[];
};

export interface JevAiClient {
  generateJson(input: { system: string; prompt: string; signal?: AbortSignal }): Promise<unknown>;
}

export class ClassificationError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "ClassificationError";
  }
}

const classifierPrompt = `
Classify a software-development request into one JSON object.
Return JSON only, with no Markdown or commentary.
Allowed intents: ${intents.join(", ")}.
Allowed tools: ${toolNames.join(", ")}.
Required fields: requestId, userMessage, intent, entities, constraints,
confidence, requiredTools, context, nextAction. Domain is optional.
Copy requestId, userMessage, and context exactly from the input.
Use confidence from 0 to 1. Do not invent repository facts.
`.trim();

export async function classifyIntent(
  client: JevAiClient,
  userMessage: string,
  context: ClassificationContext = {},
  signal?: AbortSignal,
): Promise<AgentInput> {
  const normalizedMessage = userMessage.trim();
  if (!normalizedMessage) throw new ClassificationError("User message cannot be empty");

  const trustedInput = {
    requestId: randomUUID(),
    userMessage: normalizedMessage,
    context: {
      ...(context.repo === undefined ? {} : { repo: context.repo }),
      openFiles: context.openFiles ?? [],
      recentActions: context.recentActions ?? [],
    },
  };

  let output: unknown;
  try {
    output = await client.generateJson({ system: classifierPrompt, prompt: JSON.stringify(trustedInput), signal });
  } catch (error) {
    throw new ClassificationError("JevAI classification failed", error);
  }
  if (typeof output === "string") {
    try { output = JSON.parse(output); }
    catch (error) { throw new ClassificationError("JevAI returned invalid JSON", error); }
  }

  const validation = agentInputSchema.safeParse(output);
  if (!validation.success) {
    throw new ClassificationError(`Invalid agent input: ${validation.error.message}`, validation.error);
  }
  const result = validation.data;
  if (
    result.requestId !== trustedInput.requestId ||
    result.userMessage !== trustedInput.userMessage ||
    JSON.stringify(result.context) !== JSON.stringify(trustedInput.context)
  ) throw new ClassificationError("JevAI changed trusted request metadata");
  return result;
}

export type ClassifierToolResult = { ok: boolean; summary: string; data?: unknown };
export type ToolHandler = (input: AgentInput, signal?: AbortSignal) => Promise<ClassifierToolResult>;
export type ToolRegistry = Partial<Record<ToolName, ToolHandler>>;
export type ClassifierAnalysisRegistry = ReturnType<typeof createReadOnlyRegistry>;
export type AnalysisExecutor = (
  request: AnalysisRequest,
  registry: ClassifierAnalysisRegistry,
  signal?: AbortSignal,
) => Promise<ClassifierToolResult>;

const allowedByIntent: Record<Intent, readonly ToolName[]> = {
  ask: ["ask_clarification", "respond"],
  search_code: ["search_code", "read_file", "respond"],
  debug_and_fix: toolNames,
  generate_code: toolNames,
  refactor: toolNames,
  explain: ["search_code", "read_file", "respond"],
  run_tests: ["run_tests", "respond"],
  analyze: ["ask_clarification", "search_code", "read_file", "respond"],
};

export function createAnalysisRequestFromInput(input: AgentInput): AnalysisRequest {
  const validated = agentInputSchema.parse(input);
  return createAnalysisRequest(validated.userMessage, {
    requestId: validated.requestId,
    ...(validated.context.repo === undefined ? {} : { repository: validated.context.repo }),
  });
}

export async function routeTool(
  input: AgentInput,
  registry: ToolRegistry,
  signal?: AbortSignal,
  analysis?: { registry: ClassifierAnalysisRegistry; execute: AnalysisExecutor },
): Promise<ClassifierToolResult> {
  const validated = agentInputSchema.parse(input);
  if (validated.confidence < 0.6) return runFallback("low_confidence", validated, registry, signal);
  const action = validated.nextAction;
  if (!validated.requiredTools.includes(action)) return runFallback("undeclared_action", validated, registry, signal);
  if (!allowedByIntent[validated.intent].includes(action)) return runFallback("disallowed_action", validated, registry, signal);

  if (validated.intent === "analyze" && analysis) {
    try {
      return await analysis.execute(createAnalysisRequestFromInput(validated), analysis.registry, signal);
    } catch (error) {
      return runFallback("tool_failed", validated, registry, signal, error);
    }
  }

  const handler = registry[action];
  if (!handler) return runFallback("tool_unavailable", validated, registry, signal);
  try { return await handler(validated, signal); }
  catch (error) { return runFallback("tool_failed", validated, registry, signal, error); }
}

type FallbackReason = "low_confidence" | "undeclared_action" | "disallowed_action" | "tool_unavailable" | "tool_failed";

export async function runFallback(
  reason: FallbackReason,
  input: AgentInput,
  registry: ToolRegistry,
  signal?: AbortSignal,
  cause?: unknown,
): Promise<ClassifierToolResult> {
  const clarify = registry.ask_clarification;
  if (clarify) {
    return clarify({ ...input, requiredTools: ["ask_clarification"], nextAction: "ask_clarification" }, signal);
  }
  const details = cause instanceof Error ? `: ${cause.message}` : "";
  return { ok: false, summary: `Action was not executed (${reason})${details}`, data: { requestId: input.requestId, suggestedAction: "ask_clarification" } };
}