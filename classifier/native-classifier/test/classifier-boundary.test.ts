import assert from "node:assert/strict";
import test from "node:test";
import { agentInputSchema, classifyIntent, createAnalysisRequestFromInput, routeTool, type AgentInput } from "../src/classifier-boundary";
import { createReadOnlyRegistry } from "../src/search/tool-contracts";

function input(overrides: Partial<AgentInput> = {}): AgentInput {
  return {
    requestId: "request-1",
    userMessage: "trace save flow",
    intent: "analyze",
    entities: ["save"],
    constraints: [],
    confidence: 0.9,
    requiredTools: ["search_code"],
    context: { openFiles: [], recentActions: [] },
    nextAction: "search_code",
    ...overrides,
  };
}

test("preserves the documented AgentInput contract and validates analysis requests", () => {
  const packet = input();
  assert.equal(agentInputSchema.parse(packet).intent, "analyze");
  const request = createAnalysisRequestFromInput(packet);
  assert.equal(request.requestId, packet.requestId);
  assert.equal(request.mode, "feature_flow");
  assert.deepEqual(request.constraints, ["read_only"]);
});

test("classification preserves trusted metadata and existing intents", async () => {
  const context = { repo: "workspace", openFiles: ["src/main.ts"], recentActions: [] };
  const client = {
    async generateJson({ prompt }: { prompt: string }) {
      return { ...JSON.parse(prompt), intent: "explain", entities: [], constraints: [], confidence: 0.9, requiredTools: ["respond"], nextAction: "respond" };
    },
  };
  const result = await classifyIntent(client, " explain this ", context);
  assert.equal(result.intent, "explain");
  assert.equal(result.userMessage, "explain this");
  await assert.rejects(classifyIntent(client, "  "), /cannot be empty/);
});

test("analysis routing receives a validated request and cannot invoke mutation tools", async () => {
  let invoked = false;
  const legacyRegistry = {
    edit_file: async () => { invoked = true; return { ok: true, summary: "mutated" }; },
  };
  const readOnlyRegistry = createReadOnlyRegistry({
    respond: async (request) => ({ tool: "respond", query: request.message, items: [], evidence: [] }),
  });
  const routed = await routeTool(input({ requiredTools: ["search_code", "edit_file"] as AgentInput["requiredTools"] }), legacyRegistry, undefined, {
    registry: readOnlyRegistry,
    async execute(request, tools) {
      assert.equal(request.mode, "feature_flow");
      await assert.rejects(tools.invoke("edit_file", {}), /not allowed/);
      return { ok: true, summary: "analysis routed", data: request };
    },
  });
  assert.equal(routed.ok, true);
  assert.equal(invoked, false);
});

test("non-analysis routing and mixed mutation requests retain the existing allowlist", async () => {
  let searches = 0;
  const registry = {
    search_code: async () => { searches += 1; return { ok: true, summary: "searched" }; },
    edit_file: async () => { throw new Error("must not run"); },
  };
  const regular = await routeTool(input({ intent: "search_code", requiredTools: ["search_code"] }), registry);
  const blocked = await routeTool(input({ requiredTools: ["edit_file"] as AgentInput["requiredTools"], nextAction: "edit_file" }), registry);
  assert.equal(regular.summary, "searched");
  assert.equal(blocked.ok, false);
  assert.equal(searches, 1);
});