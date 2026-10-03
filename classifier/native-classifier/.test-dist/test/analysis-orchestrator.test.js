"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const promises_1 = require("node:fs/promises");
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const node_test_1 = __importDefault(require("node:test"));
const analysis_orchestrator_1 = require("../src/analysis/analysis-orchestrator");
const analysis_handlers_1 = require("../src/search/analysis-handlers");
(0, node_test_1.default)("analyzes a feature with bounded evidence and read-only handlers", async () => {
    const root = await (0, promises_1.mkdtemp)(node_path_1.default.join(node_os_1.default.tmpdir(), "native-orchestrator-"));
    try {
        await (0, promises_1.mkdir)(node_path_1.default.join(root, "src"));
        await (0, promises_1.writeFile)(node_path_1.default.join(root, "src", "save.ts"), "export async function save(input: Input) {\n validate(input);\n await repository.save(input);\n return input;\n}\nfunction validate(value: unknown) { return value; }\n");
        const result = await new analysis_orchestrator_1.AnalysisOrchestrator({ maxQueries: 8, maxCandidateFiles: 5 }).analyze(root, "trace save flow");
        strict_1.default.ok(result.state.executedQueries.length <= 8);
        strict_1.default.ok(result.state.filesRead.length <= 5);
        strict_1.default.ok(result.graph.nodes.length > 0);
        const registry = (0, analysis_handlers_1.createAnalysisHandlers)(root);
        const listing = await registry.invoke("list_repository", {});
        strict_1.default.equal(listing.tool, "list_repository");
        await strict_1.default.rejects(registry.invoke("run_tests", {}), /not allowed/);
    }
    finally {
        await (0, promises_1.rm)(root, { recursive: true, force: true });
    }
});
(0, node_test_1.default)("honors an already-aborted signal", async () => {
    const root = await (0, promises_1.mkdtemp)(node_path_1.default.join(node_os_1.default.tmpdir(), "native-cancel-"));
    try {
        const controller = new AbortController();
        controller.abort(new Error("stop"));
        await strict_1.default.rejects(new analysis_orchestrator_1.AnalysisOrchestrator().analyze(root, "trace save flow", {}, controller.signal), /stop|cancel/i);
    }
    finally {
        await (0, promises_1.rm)(root, { recursive: true, force: true });
    }
});
