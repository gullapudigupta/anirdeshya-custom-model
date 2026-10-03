"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.createAnalysisHandlers = createAnalysisHandlers;
const repository_inventory_1 = require("../repository/repository-inventory");
const read_file_1 = require("../repository/read-file");
const file_search_1 = require("./file-search");
const text_search_1 = require("./text-search");
const compiler_symbol_provider_1 = require("./compiler-symbol-provider");
const tool_contracts_1 = require("./tool-contracts");
function result(tool, query, items = [], evidence = []) {
    return { tool, query, items, evidence };
}
function createAnalysisHandlers(root, signal) {
    const provider = new compiler_symbol_provider_1.TypeScriptCompilerSymbolProvider();
    const handlers = {
        list_repository: async () => {
            const inventory = await new repository_inventory_1.LocalRepositoryInventory().inventory(root, { signal });
            return result("list_repository", "repository inventory", [inventory]);
        },
        list_files: async (input) => result("list_files", input.directory ?? "workspace files", await (0, file_search_1.listFiles)(root, { ...input, signal })),
        search_code: async (input) => {
            const matches = await (0, text_search_1.searchCode)(root, input.query, { ...input, signal });
            return result("search_code", input.query, matches, matches.map((match) => ({ file: match.file, startLine: match.line, endLine: match.line, text: match.text })));
        },
        find_symbol: async (input) => result("find_symbol", input.symbol, await provider.findSymbol(root, input.symbol, input.limit)),
        find_references: async (input) => result("find_references", input.symbol, await provider.findReferences(root, input.symbol, input.includeDefinition, input.limit)),
        find_implementations: async (input) => result("find_implementations", input.symbol, await provider.findImplementations(root, input.symbol, input.limit)),
        read_file: async (input) => {
            const read = await (0, read_file_1.readWorkspaceFile)(root, input.file, { startLine: input.startLine, endLine: input.endLine, maxLines: input.maxLines, signal });
            return result("read_file", input.file, [read], [{ file: read.file, startLine: read.startLine, endLine: read.endLine, text: read.text }]);
        },
        get_project_metadata: async () => {
            const inventory = await new repository_inventory_1.LocalRepositoryInventory().inventory(root, { signal });
            return result("get_project_metadata", "project metadata", [{ root: inventory.root, languages: inventory.languages, frameworks: inventory.frameworks, sourceRoots: inventory.sourceRoots, testRoots: inventory.testRoots }]);
        },
        get_diagnostics: async (input) => {
            const files = input.file ? [input.file] : (await (0, file_search_1.listFiles)(root, { include: ["**/*.ts", "**/*.tsx"], limit: input.limit, signal }));
            const diagnostics = [];
            for (const file of files.slice(0, input.limit)) {
                const source = await (0, read_file_1.readWorkspaceFile)(root, file, { startLine: 1, endLine: 200, maxLines: 200, signal }).catch(() => undefined);
                if (!source)
                    continue;
                const ts = await Promise.resolve().then(() => __importStar(require("typescript")));
                const parsed = ts.transpileModule(source.text, { fileName: file, reportDiagnostics: true, compilerOptions: { target: ts.ScriptTarget.Latest } });
                diagnostics.push(...(parsed.diagnostics ?? []).map((diagnostic) => ({ file, message: ts.flattenDiagnosticMessageText(diagnostic.messageText, " "), start: diagnostic.start })));
            }
            return result("get_diagnostics", input.file ?? "workspace", diagnostics.slice(0, input.limit));
        },
        respond: async (input) => result("respond", input.message, []),
    };
    return (0, tool_contracts_1.createReadOnlyRegistry)(handlers);
}
