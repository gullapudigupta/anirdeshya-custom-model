import assert from "node:assert/strict";
import test from "node:test";
import { generateSearchQueries } from "../src/search/query-generator";
import { rankCandidates } from "../src/search/result-ranker";

test("generates deterministic framework-aware queries and preserves exact symbols", () => {
  const inventory = { frameworks: [{ name: "Angular" }, { name: "Express" }] } as never;
  const entities = [
    { type: "feature", value: "save", normalizedValue: "save", confidence: 0.9 },
    { type: "symbol", value: "saveOrder", normalizedValue: "saveOrder", confidence: 0.99 },
  ] as const;
  const result = generateSearchQueries(entities, inventory, { maxQueries: 100 });
  assert.equal(result[0]?.query, "save");
  assert.ok(result.some((query) => query.query === "saveOrder" && query.exact));
  assert.ok(result.some((query) => query.query === "NgRx"));
  assert.deepEqual(result, generateSearchQueries(entities, inventory, { maxQueries: 100 }));
});

test("ranks definitions above comments, merges evidence, and breaks ties deterministically", () => {
  const results = rankCandidates([
    { file: "src/z.ts", line: 2, text: "save()", queryFamilies: ["direct"], reasons: ["definition"] },
    { file: "src/a.ts", line: 1, text: "// save", queryFamilies: ["direct"], reasons: ["comment"] },
    { file: "src/z.ts", line: 2, text: "save()", queryFamilies: ["symbol"], reasons: ["exact_symbol"] },
  ]);
  assert.equal(results.length, 2);
  assert.equal(results[0]?.file, "src/z.ts");
  assert.deepEqual(results[0]?.queryFamilies, ["direct", "symbol"]);
});