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
const file_search_1 = require("../src/search/file-search");
const read_file_1 = require("../src/repository/read-file");
const text_search_1 = require("../src/search/text-search");
const symbol_search_1 = require("../src/search/symbol-search");
const compiler_symbol_provider_1 = require("../src/search/compiler-symbol-provider");
(0, node_test_1.default)("lists and searches only allowed text files and reads bounded line ranges", async () => {
    const root = await (0, promises_1.mkdtemp)(node_path_1.default.join(node_os_1.default.tmpdir(), "native-search-"));
    try {
        await (0, promises_1.mkdir)(node_path_1.default.join(root, "src"));
        await (0, promises_1.mkdir)(node_path_1.default.join(root, "dist"));
        await (0, promises_1.writeFile)(node_path_1.default.join(root, "src", "main.ts"), "export function save() {\n  persist();\n}\nfunction persist() {}\n");
        await (0, promises_1.writeFile)(node_path_1.default.join(root, "src", "image.png"), Buffer.from([0, 1, 2]));
        await (0, promises_1.writeFile)(node_path_1.default.join(root, "dist", "built.ts"), "save");
        strict_1.default.deepEqual(await (0, file_search_1.listFiles)(root, { include: ["**/*.ts"] }), ["src/main.ts"]);
        const results = await (0, text_search_1.searchCode)(root, "persist", { limit: 5 });
        strict_1.default.equal(results[0]?.line, 2);
        strict_1.default.equal((await (0, read_file_1.readWorkspaceFile)(root, "src/main.ts", { startLine: 1, endLine: 2 })).text, "export function save() {\n  persist();");
        await strict_1.default.rejects((0, read_file_1.readWorkspaceFile)(root, "dist/built.ts", { startLine: 1, endLine: 1 }), /outside|ignored/);
    }
    finally {
        await (0, promises_1.rm)(root, { recursive: true, force: true });
    }
});
(0, node_test_1.default)("indexes TypeScript declarations, references, and interface implementations", async () => {
    const root = await (0, promises_1.mkdtemp)(node_path_1.default.join(node_os_1.default.tmpdir(), "native-symbols-"));
    try {
        await (0, promises_1.writeFile)(node_path_1.default.join(root, "index.ts"), "interface Saver { save(): void }\nclass Store implements Saver { save() { persist(); } }\nfunction persist() {}\n");
        const provider = new symbol_search_1.TypeScriptAstSymbolProvider();
        strict_1.default.equal((await provider.findSymbol(root, "persist"))[0]?.kind, "function");
        strict_1.default.equal((await provider.findReferences(root, "persist")).length, 1);
        strict_1.default.equal((await provider.findImplementations(root, "Saver"))[0]?.name, "save");
    }
    finally {
        await (0, promises_1.rm)(root, { recursive: true, force: true });
    }
});
(0, node_test_1.default)("compiler resolves configured aliases, barrel exports, references, and implementations", async () => {
    const root = await (0, promises_1.mkdtemp)(node_path_1.default.join(node_os_1.default.tmpdir(), "native-language-service-"));
    try {
        await (0, promises_1.mkdir)(node_path_1.default.join(root, "src", "lib"), { recursive: true });
        await (0, promises_1.writeFile)(node_path_1.default.join(root, "tsconfig.json"), JSON.stringify({
            compilerOptions: { target: "ES2022", module: "CommonJS", moduleResolution: "Node", baseUrl: ".", paths: { "@lib/*": ["src/lib/*"] }, strict: true },
            include: ["src/**/*.ts"],
        }));
        await (0, promises_1.writeFile)(node_path_1.default.join(root, "src", "lib", "store.ts"), "export interface Saver { save(value: string): void }\nexport class Store implements Saver { save(value: string): void {} }\nexport function overloaded(value: string): string;\nexport function overloaded(value: number): number;\nexport function overloaded(value: string | number): string | number { return value; }\n");
        await (0, promises_1.writeFile)(node_path_1.default.join(root, "src", "index.ts"), "export { Store as DataStore } from './lib/store';\n");
        await (0, promises_1.writeFile)(node_path_1.default.join(root, "src", "consumer.ts"), "import { Store } from '@lib/store';\nexport const instance = new Store();\ninstance.save('value');\n");
        const provider = new compiler_symbol_provider_1.TypeScriptCompilerSymbolProvider();
        const storeDefinitions = await provider.findSymbol(root, "Store");
        strict_1.default.equal(storeDefinitions[0]?.file, "src/lib/store.ts", JSON.stringify(await provider.resolveSymbol(root, "Store")));
        const references = await provider.findReferences(root, "Store");
        strict_1.default.ok(references.some((location) => location.file === "src/consumer.ts"));
        const implementations = await provider.findImplementations(root, "Saver");
        strict_1.default.ok(implementations.some((location) => location.file === "src/lib/store.ts"));
        strict_1.default.equal((await provider.resolveSymbol(root, "Store")).status, "verified");
    }
    finally {
        await (0, promises_1.rm)(root, { recursive: true, force: true });
    }
});
(0, node_test_1.default)("malformed or missing project metadata yields explicit inferred or unresolved results", async () => {
    const root = await (0, promises_1.mkdtemp)(node_path_1.default.join(node_os_1.default.tmpdir(), "native-symbol-fallback-"));
    try {
        await (0, promises_1.writeFile)(node_path_1.default.join(root, "tsconfig.json"), "{ malformed");
        await (0, promises_1.writeFile)(node_path_1.default.join(root, "fallback.ts"), "export function localOnly() {}\n");
        const provider = new compiler_symbol_provider_1.TypeScriptCompilerSymbolProvider();
        const inferred = await provider.resolveSymbol(root, "localOnly");
        strict_1.default.equal(inferred.status, "inferred");
        const missing = await provider.resolveSymbol(root, "notFound");
        strict_1.default.equal(missing.status, "unresolved");
        strict_1.default.match(missing.reason, /tsconfig|definition/i);
    }
    finally {
        await (0, promises_1.rm)(root, { recursive: true, force: true });
    }
});
