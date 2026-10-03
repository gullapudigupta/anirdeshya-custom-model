import assert from "node:assert/strict";
import test from "node:test";
import { createReadOnlyRegistry, toolInputSchemas } from "../src/search/tool-contracts";

test("validates bounded paths and line reads across analysis tools", () => {
  assert.equal(toolInputSchemas.read_file.safeParse({ file: "src/a.ts", startLine: 1, endLine: 10 }).success, true);
  assert.equal(toolInputSchemas.read_file.safeParse({ file: "../outside", startLine: 1, endLine: 2 }).success, false);
  assert.equal(toolInputSchemas.read_file.safeParse({ file: "src/a.ts", startLine: 1, endLine: 900 }).success, false);
  assert.equal(toolInputSchemas.search_code.safeParse({ query: "x", mode: "regex", limit: 10 }).success, true);
});

test("registry rejects mutating tools and malformed handler outputs", async () => {
  const registry = createReadOnlyRegistry({
    search_code: () => ({ tool: "search_code", query: "x", items: [], evidence: [] }),
  });
  await assert.rejects(registry.invoke("edit_file", {}), /not allowed/);
  await assert.rejects(registry.invoke("search_code", { query: "x", unexpected: true }), /Unrecognized key/);
  await assert.rejects(registry.invoke("search_code", { query: "x" }).then(() => {
    const bad = createReadOnlyRegistry({ search_code: () => ({ tool: "read_file", query: "x", items: [], evidence: [] }) });
    return bad.invoke("search_code", { query: "x" });
  }), /does not match/);
});