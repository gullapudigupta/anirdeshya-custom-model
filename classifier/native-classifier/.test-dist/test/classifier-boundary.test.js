"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const classifier_boundary_1 = require("../src/classifier-boundary");
const tool_contracts_1 = require("../src/search/tool-contracts");
function input(overrides = {}) {
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
(0, node_test_1.default)("preserves the documented AgentInput contract and validates analysis requests", () => {
    const packet = input();
    strict_1.default.equal(classifier_boundary_1.agentInputSchema.parse(packet).intent, "analyze");
    const request = (0, classifier_boundary_1.createAnalysisRequestFromInput)(packet);
    strict_1.default.equal(request.requestId, packet.requestId);
    strict_1.default.equal(request.mode, "feature_flow");
    strict_1.default.deepEqual(request.constraints, ["read_only"]);
});
(0, node_test_1.default)("classification preserves trusted metadata and existing intents", async () => {
    const context = { repo: "workspace", openFiles: ["src/main.ts"], recentActions: [] };
    const client = {
        async generateJson({ prompt }) {
            return { ...JSON.parse(prompt), intent: "explain", entities: [], constraints: [], confidence: 0.9, requiredTools: ["respond"], nextAction: "respond" };
        },
    };
    const result = await (0, classifier_boundary_1.classifyIntent)(client, " explain this ", context);
    strict_1.default.equal(result.intent, "explain");
    strict_1.default.equal(result.userMessage, "explain this");
    await strict_1.default.rejects((0, classifier_boundary_1.classifyIntent)(client, "  "), /cannot be empty/);
});
(0, node_test_1.default)("analysis routing receives a validated request and cannot invoke mutation tools", async () => {
    let invoked = false;
    const legacyRegistry = {
        edit_file: async () => { invoked = true; return { ok: true, summary: "mutated" }; },
    };
    const readOnlyRegistry = (0, tool_contracts_1.createReadOnlyRegistry)({
        respond: async (request) => ({ tool: "respond", query: request.message, items: [], evidence: [] }),
    });
    const routed = await (0, classifier_boundary_1.routeTool)(input({ requiredTools: ["search_code", "edit_file"] }), legacyRegistry, undefined, {
        registry: readOnlyRegistry,
        async execute(request, tools) {
            strict_1.default.equal(request.mode, "feature_flow");
            await strict_1.default.rejects(tools.invoke("edit_file", {}), /not allowed/);
            return { ok: true, summary: "analysis routed", data: request };
        },
    });
    strict_1.default.equal(routed.ok, true);
    strict_1.default.equal(invoked, false);
});
(0, node_test_1.default)("non-analysis routing and mixed mutation requests retain the existing allowlist", async () => {
    let searches = 0;
    const registry = {
        search_code: async () => { searches += 1; return { ok: true, summary: "searched" }; },
        edit_file: async () => { throw new Error("must not run"); },
    };
    const regular = await (0, classifier_boundary_1.routeTool)(input({ intent: "search_code", requiredTools: ["search_code"] }), registry);
    const blocked = await (0, classifier_boundary_1.routeTool)(input({ requiredTools: ["edit_file"], nextAction: "edit_file" }), registry);
    strict_1.default.equal(regular.summary, "searched");
    strict_1.default.equal(blocked.ok, false);
    strict_1.default.equal(searches, 1);
});
