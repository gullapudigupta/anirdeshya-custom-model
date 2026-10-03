"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const query_generator_1 = require("../src/search/query-generator");
const result_ranker_1 = require("../src/search/result-ranker");
(0, node_test_1.default)("generates deterministic framework-aware queries and preserves exact symbols", () => {
    const inventory = { frameworks: [{ name: "Angular" }, { name: "Express" }] };
    const entities = [
        { type: "feature", value: "save", normalizedValue: "save", confidence: 0.9 },
        { type: "symbol", value: "saveOrder", normalizedValue: "saveOrder", confidence: 0.99 },
    ];
    const result = (0, query_generator_1.generateSearchQueries)(entities, inventory, { maxQueries: 100 });
    strict_1.default.equal(result[0]?.query, "save");
    strict_1.default.ok(result.some((query) => query.query === "saveOrder" && query.exact));
    strict_1.default.ok(result.some((query) => query.query === "NgRx"));
    strict_1.default.deepEqual(result, (0, query_generator_1.generateSearchQueries)(entities, inventory, { maxQueries: 100 }));
});
(0, node_test_1.default)("ranks definitions above comments, merges evidence, and breaks ties deterministically", () => {
    const results = (0, result_ranker_1.rankCandidates)([
        { file: "src/z.ts", line: 2, text: "save()", queryFamilies: ["direct"], reasons: ["definition"] },
        { file: "src/a.ts", line: 1, text: "// save", queryFamilies: ["direct"], reasons: ["comment"] },
        { file: "src/z.ts", line: 2, text: "save()", queryFamilies: ["symbol"], reasons: ["exact_symbol"] },
    ]);
    strict_1.default.equal(results.length, 2);
    strict_1.default.equal(results[0]?.file, "src/z.ts");
    strict_1.default.deepEqual(results[0]?.queryFamilies, ["direct", "symbol"]);
});
