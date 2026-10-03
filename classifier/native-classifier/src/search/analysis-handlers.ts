import { LocalRepositoryInventory } from "../repository/repository-inventory";
import { readWorkspaceFile } from "../repository/read-file";
import { listFiles } from "./file-search";
import { searchCode } from "./text-search";
import { TypeScriptCompilerSymbolProvider } from "./compiler-symbol-provider";
import { createReadOnlyRegistry, type ReadOnlyAnalysisRegistry, type ToolResult } from "./tool-contracts";

function result(tool: ToolResult["tool"], query: string, items: unknown[] = [], evidence: ToolResult["evidence"] = []): ToolResult {
  return { tool, query, items, evidence };
}

export function createAnalysisHandlers(root: string, signal?: AbortSignal) {
  const provider = new TypeScriptCompilerSymbolProvider();
  const handlers: ReadOnlyAnalysisRegistry = {
    list_repository: async () => {
      const inventory = await new LocalRepositoryInventory().inventory(root, { signal });
      return result("list_repository", "repository inventory", [inventory]);
    },
    list_files: async (input) => result("list_files", input.directory ?? "workspace files", await listFiles(root, { ...input, signal })),
    search_code: async (input) => {
      const matches = await searchCode(root, input.query, { ...input, signal });
      return result("search_code", input.query, matches, matches.map((match) => ({ file: match.file, startLine: match.line, endLine: match.line, text: match.text })));
    },
    find_symbol: async (input) => result("find_symbol", input.symbol, await provider.findSymbol(root, input.symbol, input.limit)),
    find_references: async (input) => result("find_references", input.symbol, await provider.findReferences(root, input.symbol, input.includeDefinition, input.limit)),
    find_implementations: async (input) => result("find_implementations", input.symbol, await provider.findImplementations(root, input.symbol, input.limit)),
    read_file: async (input) => {
      const read = await readWorkspaceFile(root, input.file, { startLine: input.startLine, endLine: input.endLine, maxLines: input.maxLines, signal });
      return result("read_file", input.file, [read], [{ file: read.file, startLine: read.startLine, endLine: read.endLine, text: read.text }]);
    },
    get_project_metadata: async () => {
      const inventory = await new LocalRepositoryInventory().inventory(root, { signal });
      return result("get_project_metadata", "project metadata", [{ root: inventory.root, languages: inventory.languages, frameworks: inventory.frameworks, sourceRoots: inventory.sourceRoots, testRoots: inventory.testRoots }]);
    },
    get_diagnostics: async (input) => {
      const files = input.file ? [input.file] : (await listFiles(root, { include: ["**/*.ts", "**/*.tsx"], limit: input.limit, signal }));
      const diagnostics: unknown[] = [];
      for (const file of files.slice(0, input.limit)) {
        const source = await readWorkspaceFile(root, file, { startLine: 1, endLine: 200, maxLines: 200, signal }).catch(() => undefined);
        if (!source) continue;
        const ts = await import("typescript");
        const parsed = ts.transpileModule(source.text, { fileName: file, reportDiagnostics: true, compilerOptions: { target: ts.ScriptTarget.Latest } });
        diagnostics.push(...(parsed.diagnostics ?? []).map((diagnostic) => ({ file, message: ts.flattenDiagnosticMessageText(diagnostic.messageText, " "), start: diagnostic.start })));
      }
      return result("get_diagnostics", input.file ?? "workspace", diagnostics.slice(0, input.limit));
    },
    respond: async (input) => result("respond", input.message, []),
  };
  return createReadOnlyRegistry(handlers);
}