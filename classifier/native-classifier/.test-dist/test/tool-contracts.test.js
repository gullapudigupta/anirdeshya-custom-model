"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const tool_contracts_1 = require("../src/search/tool-contracts");
(0, node_test_1.default)("validates bounded paths and line reads across analysis tools", () => {
    strict_1.default.equal(tool_contracts_1.toolInputSchemas.read_file.safeParse({ file: "src/a.ts", startLine: 1, endLine: 10 }).success, true);
    strict_1.default.equal(tool_contracts_1.toolInputSchemas.read_file.safeParse({ file: "../outside", startLine: 1, endLine: 2 }).success, false);
    strict_1.default.equal(tool_contracts_1.toolInputSchemas.read_file.safeParse({ file: "src/a.ts", startLine: 1, endLine: 900 }).success, false);
    strict_1.default.equal(tool_contracts_1.toolInputSchemas.search_code.safeParse({ query: "x", mode: "regex", limit: 10 }).success, true);
});
(0, node_test_1.default)("registry rejects mutating tools and malformed handler outputs", async () => {
    const registry = (0, tool_contracts_1.createReadOnlyRegistry)({
        search_code: () => ({ tool: "search_code", query: "x", items: [], evidence: [] }),
    });
    await strict_1.default.rejects(registry.invoke("edit_file", {}), /not allowed/);
    await strict_1.default.rejects(registry.invoke("search_code", { query: "x", unexpected: true }), /Unrecognized key/);
    await strict_1.default.rejects(registry.invoke("search_code", { query: "x" }).then(() => {
        const bad = (0, tool_contracts_1.createReadOnlyRegistry)({ search_code: () => ({ tool: "read_file", query: "x", items: [], evidence: [] }) });
        return bad.invoke("search_code", { query: "x" });
    }), /does not match/);
});
