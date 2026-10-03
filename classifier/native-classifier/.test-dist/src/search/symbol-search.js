"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TypeScriptAstSymbolProvider = void 0;
const promises_1 = require("node:fs/promises");
const node_path_1 = __importDefault(require("node:path"));
const typescript_1 = __importDefault(require("typescript"));
const file_search_1 = require("./file-search");
function declarationKind(node) {
    if (typescript_1.default.isFunctionDeclaration(node))
        return "function";
    if (typescript_1.default.isMethodDeclaration(node))
        return "method";
    if (typescript_1.default.isClassDeclaration(node))
        return "class";
    if (typescript_1.default.isInterfaceDeclaration(node))
        return "interface";
    if (typescript_1.default.isVariableDeclaration(node))
        return "variable";
    if (typescript_1.default.isPropertyDeclaration(node) || typescript_1.default.isPropertySignature(node))
        return "property";
    if (typescript_1.default.isTypeAliasDeclaration(node))
        return "type";
    if (typescript_1.default.isEnumDeclaration(node))
        return "enum";
    return undefined;
}
function isDeclarationName(node) {
    const parent = node.parent;
    return Boolean(("name" in parent && parent.name === node && declarationKind(parent))
        || (typescript_1.default.isParameter(parent) && parent.name === node)
        || (typescript_1.default.isImportSpecifier(parent) && parent.name === node)
        || (typescript_1.default.isExportSpecifier(parent) && parent.name === node));
}
async function sourceFiles(root, limit = 2_000) {
    const files = await (0, file_search_1.listFiles)(root, { include: ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"], limit });
    const output = [];
    for (const file of files) {
        try {
            const text = await (0, promises_1.readFile)(node_path_1.default.join(root, file), "utf8");
            if (Buffer.byteLength(text) <= 2_000_000 && !text.includes("\0"))
                output.push({ file, source: typescript_1.default.createSourceFile(file, text, typescript_1.default.ScriptTarget.Latest, true) });
        }
        catch { /* Files can disappear while a bounded scan is running. */ }
    }
    return output;
}
class TypeScriptAstSymbolProvider {
    async findSymbol(root, symbol, limit = 100) {
        const results = [];
        for (const { file, source } of await sourceFiles(root)) {
            const visit = (node) => {
                const kind = declarationKind(node);
                const declarationName = node.name;
                const name = declarationName && typescript_1.default.isIdentifier(declarationName) ? declarationName : undefined;
                if (kind && name?.text === symbol) {
                    const location = source.getLineAndCharacterOfPosition(name.getStart(source));
                    results.push({ name: symbol, kind, file, line: location.line + 1, column: location.character + 1, isDefinition: true });
                }
                typescript_1.default.forEachChild(node, visit);
            };
            visit(source);
            if (results.length >= limit)
                return results.slice(0, limit);
        }
        return results;
    }
    async findReferences(root, symbol, includeDefinition = false, limit = 500) {
        const definitions = await this.findSymbol(root, symbol, limit);
        const definitionLocations = new Set(definitions.map((item) => `${item.file}:${item.line}:${item.column}`));
        const results = includeDefinition ? [...definitions] : [];
        for (const { file, source } of await sourceFiles(root)) {
            const visit = (node) => {
                if (typescript_1.default.isIdentifier(node) && node.text === symbol && !isDeclarationName(node)) {
                    const location = source.getLineAndCharacterOfPosition(node.getStart(source));
                    const reference = { name: symbol, kind: "variable", file, line: location.line + 1, column: location.character + 1, isDefinition: false };
                    if (!definitionLocations.has(`${file}:${reference.line}:${reference.column}`))
                        results.push(reference);
                }
                typescript_1.default.forEachChild(node, visit);
            };
            visit(source);
            if (results.length >= limit)
                break;
        }
        return results.slice(0, limit).sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column);
    }
    async findImplementations(root, symbol, limit = 100) {
        const output = [];
        for (const { file, source } of await sourceFiles(root)) {
            const visit = (node) => {
                if (typescript_1.default.isClassDeclaration(node) && node.heritageClauses?.some((clause) => clause.token === typescript_1.default.SyntaxKind.ImplementsKeyword
                    && clause.types.some((type) => type.expression.getText(source).split(".").at(-1) === symbol))) {
                    for (const member of node.members) {
                        if (!("name" in member) || !member.name || !typescript_1.default.isIdentifier(member.name))
                            continue;
                        const location = source.getLineAndCharacterOfPosition(member.name.getStart(source));
                        output.push({ name: member.name.text, kind: declarationKind(member) ?? "method", file, line: location.line + 1, column: location.character + 1, isDefinition: true });
                    }
                }
                typescript_1.default.forEachChild(node, visit);
            };
            visit(source);
            if (output.length >= limit)
                break;
        }
        return output.slice(0, limit);
    }
}
exports.TypeScriptAstSymbolProvider = TypeScriptAstSymbolProvider;
