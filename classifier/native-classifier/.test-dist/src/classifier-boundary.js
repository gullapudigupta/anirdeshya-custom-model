"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ClassificationError = exports.agentInputSchema = void 0;
exports.classifyIntent = classifyIntent;
exports.createAnalysisRequestFromInput = createAnalysisRequestFromInput;
exports.routeTool = routeTool;
exports.runFallback = runFallback;
const node_crypto_1 = require("node:crypto");
const zod_1 = require("zod");
const analysis_request_1 = require("./analysis/analysis-request");
const intents = ["ask", "search_code", "debug_and_fix", "generate_code", "refactor", "explain", "run_tests", "analyze"];
const toolNames = ["ask_clarification", "search_code", "read_file", "edit_file", "run_build", "run_tests", "respond"];
const intentSchema = zod_1.z.enum(intents);
const toolNameSchema = zod_1.z.enum(toolNames);
exports.agentInputSchema = zod_1.z.object({
    requestId: zod_1.z.string().min(1),
    userMessage: zod_1.z.string().min(1).max(20_000),
    intent: intentSchema,
    domain: zod_1.z.string().min(1).max(100).optional(),
    entities: zod_1.z.array(zod_1.z.string().min(1).max(500)).max(50),
    constraints: zod_1.z.array(zod_1.z.string().min(1).max(500)).max(50),
    confidence: zod_1.z.number().min(0).max(1),
    requiredTools: zod_1.z.array(toolNameSchema).max(20),
    context: zod_1.z.object({
        repo: zod_1.z.string().max(500).optional(),
        openFiles: zod_1.z.array(zod_1.z.string().min(1).max(1_000)).max(100),
        recentActions: zod_1.z.array(zod_1.z.string().min(1).max(2_000)).max(100),
    }).strict(),
    nextAction: toolNameSchema,
}).strict();
class ClassificationError extends Error {
    cause;
    constructor(message, cause) {
        super(message);
        this.cause = cause;
        this.name = "ClassificationError";
    }
}
exports.ClassificationError = ClassificationError;
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
async function classifyIntent(client, userMessage, context = {}, signal) {
    const normalizedMessage = userMessage.trim();
    if (!normalizedMessage)
        throw new ClassificationError("User message cannot be empty");
    const trustedInput = {
        requestId: (0, node_crypto_1.randomUUID)(),
        userMessage: normalizedMessage,
        context: {
            ...(context.repo === undefined ? {} : { repo: context.repo }),
            openFiles: context.openFiles ?? [],
            recentActions: context.recentActions ?? [],
        },
    };
    let output;
    try {
        output = await client.generateJson({ system: classifierPrompt, prompt: JSON.stringify(trustedInput), signal });
    }
    catch (error) {
        throw new ClassificationError("JevAI classification failed", error);
    }
    if (typeof output === "string") {
        try {
            output = JSON.parse(output);
        }
        catch (error) {
            throw new ClassificationError("JevAI returned invalid JSON", error);
        }
    }
    const validation = exports.agentInputSchema.safeParse(output);
    if (!validation.success) {
        throw new ClassificationError(`Invalid agent input: ${validation.error.message}`, validation.error);
    }
    const result = validation.data;
    if (result.requestId !== trustedInput.requestId ||
        result.userMessage !== trustedInput.userMessage ||
        JSON.stringify(result.context) !== JSON.stringify(trustedInput.context))
        throw new ClassificationError("JevAI changed trusted request metadata");
    return result;
}
const allowedByIntent = {
    ask: ["ask_clarification", "respond"],
    search_code: ["search_code", "read_file", "respond"],
    debug_and_fix: toolNames,
    generate_code: toolNames,
    refactor: toolNames,
    explain: ["search_code", "read_file", "respond"],
    run_tests: ["run_tests", "respond"],
    analyze: ["ask_clarification", "search_code", "read_file", "respond"],
};
function createAnalysisRequestFromInput(input) {
    const validated = exports.agentInputSchema.parse(input);
    return (0, analysis_request_1.createAnalysisRequest)(validated.userMessage, {
        requestId: validated.requestId,
        ...(validated.context.repo === undefined ? {} : { repository: validated.context.repo }),
    });
}
async function routeTool(input, registry, signal, analysis) {
    const validated = exports.agentInputSchema.parse(input);
    if (validated.confidence < 0.6)
        return runFallback("low_confidence", validated, registry, signal);
    const action = validated.nextAction;
    if (!validated.requiredTools.includes(action))
        return runFallback("undeclared_action", validated, registry, signal);
    if (!allowedByIntent[validated.intent].includes(action))
        return runFallback("disallowed_action", validated, registry, signal);
    if (validated.intent === "analyze" && analysis) {
        try {
            return await analysis.execute(createAnalysisRequestFromInput(validated), analysis.registry, signal);
        }
        catch (error) {
            return runFallback("tool_failed", validated, registry, signal, error);
        }
    }
    const handler = registry[action];
    if (!handler)
        return runFallback("tool_unavailable", validated, registry, signal);
    try {
        return await handler(validated, signal);
    }
    catch (error) {
        return runFallback("tool_failed", validated, registry, signal, error);
    }
}
async function runFallback(reason, input, registry, signal, cause) {
    const clarify = registry.ask_clarification;
    if (clarify) {
        return clarify({ ...input, requiredTools: ["ask_clarification"], nextAction: "ask_clarification" }, signal);
    }
    const details = cause instanceof Error ? `: ${cause.message}` : "";
    return { ok: false, summary: `Action was not executed (${reason})${details}`, data: { requestId: input.requestId, suggestedAction: "ask_clarification" } };
}
