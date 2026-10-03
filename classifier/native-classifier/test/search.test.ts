import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { listFiles } from "../src/search/file-search";
import { readWorkspaceFile } from "../src/repository/read-file";
import { searchCode } from "../src/search/text-search";
import { TypeScriptAstSymbolProvider } from "../src/search/symbol-search";
import { TypeScriptCompilerSymbolProvider } from "../src/search/compiler-symbol-provider";

test("lists and searches only allowed text files and reads bounded line ranges", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "native-search-"));
  try {
    await mkdir(path.join(root, "src"));
    await mkdir(path.join(root, "dist"));
    await writeFile(path.join(root, "src", "main.ts"), "export function save() {\n  persist();\n}\nfunction persist() {}\n");
    await writeFile(path.join(root, "src", "image.png"), Buffer.from([0, 1, 2]));
    await writeFile(path.join(root, "dist", "built.ts"), "save");
    assert.deepEqual(await listFiles(root, { include: ["**/*.ts"] }), ["src/main.ts"]);
    const results = await searchCode(root, "persist", { limit: 5 });
    assert.equal(results[0]?.line, 2);
    assert.equal((await readWorkspaceFile(root, "src/main.ts", { startLine: 1, endLine: 2 })).text, "export function save() {\n  persist();");
    await assert.rejects(readWorkspaceFile(root, "dist/built.ts", { startLine: 1, endLine: 1 }), /outside|ignored/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("indexes TypeScript declarations, references, and interface implementations", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "native-symbols-"));
  try {
    await writeFile(path.join(root, "index.ts"), "interface Saver { save(): void }\nclass Store implements Saver { save() { persist(); } }\nfunction persist() {}\n");
    const provider = new TypeScriptAstSymbolProvider();
    assert.equal((await provider.findSymbol(root, "persist"))[0]?.kind, "function");
    assert.equal((await provider.findReferences(root, "persist")).length, 1);
    assert.equal((await provider.findImplementations(root, "Saver"))[0]?.name, "save");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("compiler resolves configured aliases, barrel exports, references, and implementations", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "native-language-service-"));
  try {
    await mkdir(path.join(root, "src", "lib"), { recursive: true });
    await writeFile(path.join(root, "tsconfig.json"), JSON.stringify({
      compilerOptions: { target: "ES2022", module: "CommonJS", moduleResolution: "Node", baseUrl: ".", paths: { "@lib/*": ["src/lib/*"] }, strict: true },
      include: ["src/**/*.ts"],
    }));
    await writeFile(path.join(root, "src", "lib", "store.ts"), "export interface Saver { save(value: string): void }\nexport class Store implements Saver { save(value: string): void {} }\nexport function overloaded(value: string): string;\nexport function overloaded(value: number): number;\nexport function overloaded(value: string | number): string | number { return value; }\n");
    await writeFile(path.join(root, "src", "index.ts"), "export { Store as DataStore } from './lib/store';\n");
    await writeFile(path.join(root, "src", "consumer.ts"), "import { Store } from '@lib/store';\nexport const instance = new Store();\ninstance.save('value');\n");
    const provider = new TypeScriptCompilerSymbolProvider();
    const storeDefinitions = await provider.findSymbol(root, "Store");
    assert.equal(storeDefinitions[0]?.file, "src/lib/store.ts", JSON.stringify(await provider.resolveSymbol(root, "Store")));
    const references = await provider.findReferences(root, "Store");
    assert.ok(references.some((location) => location.file === "src/consumer.ts"));
    const implementations = await provider.findImplementations(root, "Saver");
    assert.ok(implementations.some((location) => location.file === "src/lib/store.ts"));
    assert.equal((await provider.resolveSymbol(root, "Store")).status, "verified");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("malformed or missing project metadata yields explicit inferred or unresolved results", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "native-symbol-fallback-"));
  try {
    await writeFile(path.join(root, "tsconfig.json"), "{ malformed");
    await writeFile(path.join(root, "fallback.ts"), "export function localOnly() {}\n");
    const provider = new TypeScriptCompilerSymbolProvider();
    const inferred = await provider.resolveSymbol(root, "localOnly");
    assert.equal(inferred.status, "inferred");
    const missing = await provider.resolveSymbol(root, "notFound");
    assert.equal(missing.status, "unresolved");
    assert.match(missing.reason, /tsconfig|definition/i);
  } finally { await rm(root, { recursive: true, force: true }); }
});