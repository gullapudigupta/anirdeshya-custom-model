# JevAI Classification Responsibilities and TypeScript Implementation

This document extends [LLM human language classification agent input format.md](LLM%20human%20language%20classification%20agent%20input%20format.md) with a JevAI responsibility split and a Node.js/TypeScript reference implementation.

## 1. Responsibility split

Assumption: JevAI accepts a prompt and can return structured JSON. Its SDK should remain behind an adapter so application logic does not depend on provider-specific APIs.

- **Still required**: application code must own the step.
- **Partially handled by the model**: JevAI proposes a result, but application code constrains and verifies it.
- **Can be abstracted away**: JevAI performs the semantic work, so no separate application algorithm is normally needed.

| Pipeline step | Status with JevAI | Responsibility |
| --- | --- | --- |
| 1. Receive user message | **Still required** | The API, CLI, or UI accepts the message, authenticates the caller, assigns a request ID, and collects context. |
| 2. Send message to classifier | **Still required** | The application builds the prompt, calls JevAI, handles timeouts, and protects credentials. |
| 3. Parse JSON output | **Partially handled by the model** | JevAI can produce JSON, but the application must parse it and reject malformed data. |
| 4. Validate with schema | **Still required** | Validate types, enums, confidence bounds, context limits, and tool names outside the model. |
| 5. Route to tools | **Partially handled by the model** | JevAI recommends `requiredTools` and `nextAction`; deterministic code authorizes and dispatches the tool. |
| 6. Execute tool action | **Still required** | The host or MCP server executes tools, enforces permissions, and records results. |
| 7. Feed results back | **Still required** | The orchestrator stores and limits untrusted tool output before returning relevant results to JevAI. |
| 8. Repeat until done | **Partially handled by the model** | JevAI chooses a next action; the application enforces iteration, token, cost, timeout, and approval limits. |

Intent detection, entity extraction, domain inference, and initial confidence estimation **can be abstracted away** behind JevAI. Input normalization is **partially handled**: the application must still limit message size and preserve exact file names, symbols, and errors.

> JevAI proposes typed actions. Application code validates, authorizes, executes, and audits them.

## 2. Node.js/TypeScript implementation

Install dependencies:

```bash
npm install zod
npm install --save-dev typescript tsx @types/node
```

The `JevAiClient` interface is the provider-specific boundary. Implement it with the official JevAI SDK or HTTP API.

```typescript
import { randomUUID } from "node:crypto";
import { z } from "zod";

const intents = [
  "ask", "search_code", "debug_and_fix", "generate_code",
  "refactor", "explain", "run_tests", "analyze",
] as const;

const toolNames = [
  "ask_clarification", "search_code", "read_file", "edit_file",
  "run_build", "run_tests", "respond",
] as const;

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
  generateJson(input: {
    system: string;
    prompt: string;
    signal?: AbortSignal;
  }): Promise<unknown>;
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
  if (!normalizedMessage) {
    throw new ClassificationError("User message cannot be empty");
  }

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
    output = await client.generateJson({
      system: classifierPrompt,
      prompt: JSON.stringify(trustedInput),
      signal,
    });
  } catch (error) {
    throw new ClassificationError("JevAI classification failed", error);
  }

  if (typeof output === "string") {
    try {
      output = JSON.parse(output);
    } catch (error) {
      throw new ClassificationError("JevAI returned invalid JSON", error);
    }
  }

  const validation = agentInputSchema.safeParse(output);
  if (!validation.success) {
    throw new ClassificationError(
      `Invalid agent input: ${validation.error.message}`,
      validation.error,
    );
  }

  const result = validation.data;
  if (
    result.requestId !== trustedInput.requestId ||
    result.userMessage !== trustedInput.userMessage ||
    JSON.stringify(result.context) !== JSON.stringify(trustedInput.context)
  ) {
    throw new ClassificationError("JevAI changed trusted request metadata");
  }

  return result;
}

export type ToolResult = { ok: boolean; summary: string; data?: unknown };
export type ToolHandler = (
  input: AgentInput,
  signal?: AbortSignal,
) => Promise<ToolResult>;
export type ToolRegistry = Partial<Record<ToolName, ToolHandler>>;

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

export async function routeTool(
  input: AgentInput,
  registry: ToolRegistry,
  signal?: AbortSignal,
): Promise<ToolResult> {
  const validated = agentInputSchema.parse(input);

  if (validated.confidence < 0.6) {
    return runFallback("low_confidence", validated, registry, signal);
  }

  const action = validated.nextAction;
  if (!validated.requiredTools.includes(action)) {
    return runFallback("undeclared_action", validated, registry, signal);
  }
  if (!allowedByIntent[validated.intent].includes(action)) {
    return runFallback("disallowed_action", validated, registry, signal);
  }

  const handler = registry[action];
  if (!handler) {
    return runFallback("tool_unavailable", validated, registry, signal);
  }

  try {
    return await handler(validated, signal);
  } catch (error) {
    return runFallback("tool_failed", validated, registry, signal, error);
  }
}

type FallbackReason =
  | "low_confidence"
  | "undeclared_action"
  | "disallowed_action"
  | "tool_unavailable"
  | "tool_failed";

export async function runFallback(
  reason: FallbackReason,
  input: AgentInput,
  registry: ToolRegistry,
  signal?: AbortSignal,
  cause?: unknown,
): Promise<ToolResult> {
  const clarify = registry.ask_clarification;
  if (clarify) {
    return clarify({
      ...input,
      requiredTools: ["ask_clarification"],
      nextAction: "ask_clarification",
    }, signal);
  }

  const details = cause instanceof Error ? `: ${cause.message}` : "";
  return {
    ok: false,
    summary: `Action was not executed (${reason})${details}`,
    data: { requestId: input.requestId, suggestedAction: "ask_clarification" },
  };
}
```

Example composition:

```typescript
const tools: ToolRegistry = {
  search_code: async (input) => ({
    ok: true,
    summary: `Search queued for: ${input.entities.join(", ")}`,
  }),
  ask_clarification: async (input) => ({
    ok: false,
    summary: `More information is required for: ${input.userMessage}`,
  }),
};

const agentInput = await classifyIntent(
  jevAiClient,
  "Find the login bug and fix it in Angular",
  { repo: "frontend-app", openFiles: ["src/app/auth/login.component.ts"] },
);

const firstResult = await routeTool(agentInput, tools);
```

## 3. Production controls outside JevAI

1. Authentication, authorization, and per-tool permissions.
2. Schema validation and an explicit tool allowlist.
3. Timeouts, retries with backoff, cancellation, and rate limits.
4. Maximum loop count, token budget, and cost budget.
5. Human approval for destructive, privileged, or external actions.
6. Prompt-injection defenses for repository and tool output.
7. Secret redaction and audit records for decisions, calls, and results.

The classifier packet selects a tool but does not contain typed arguments for each tool. In production, define and enforce a separate Zod schema for every tool call immediately before execution.


