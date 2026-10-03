"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TypeScriptLanguageServiceSymbolProvider = void 0;
const node_fs_1 = require("node:fs");
const promises_1 = require("node:fs/promises");
const node_path_1 = __importDefault(require("node:path"));
const typescript_1 = __importDefault(require("typescript"));
const file_search_1 = require("./file-search");
const symbol_search_1 = require("./symbol-search");
function toPosix(value) {
    return value.replace(/\\/g, "/");
}
function isWithin(root, file) {
    const relative = node_path_1.default.relative(root, file);
    return relative === "" || (!relative.startsWith(`..${node_path_1.default.sep}`) && relative !== ".." && !node_path_1.default.isAbsolute(relative));
}
function globRegex(pattern) {
    const normalized = toPosix(pattern);
    let expression = "";
    for (let index = 0; index < normalized.length; index += 1) {
        const character = normalized[index];
        if (character === "*" && normalized[index + 1] === "*") {
            index += 1;
            if (normalized[index + 1] === "/") {
                index += 1;
                expression += "(?:.*/)?";
            }
            else {
                expression += ".*";
            }
        }
        else if (character === "*") {
            expression += "[^/]*";
        }
        else if (character === "?") {
            expression += "[^/]";
        }
        else {
            expression += /[.+^${}()|[\]\\]/.test(character) ? `\\${character}` : character;
        }
    }
    return new RegExp(`^${expression}$`);
}
function matchesPatterns(relative, patterns) {
    if (!patterns?.length)
        return true;
    return patterns.some((pattern) => globRegex(pattern).test(relative));
}
function locationFor(root, fileName, position, symbol, isDefinition) {
    if (!isWithin(root, fileName))
        return undefined;
    try {
        const content = (0, node_fs_1.readFileSync)(fileName, "utf8");
        const source = typescript_1.default.createSourceFile(fileName, content, typescript_1.default.ScriptTarget.Latest, true);
        const location = source.getLineAndCharacterOfPosition(position);
        return {
            name: symbol,
            kind: "variable",
            file: toPosix(node_path_1.default.relative(root, fileName)),
            line: location.line + 1,
            column: location.character + 1,
            isDefinition,
        };
    }
    catch {
        return undefined;
    }
}
function sortAndDedupe(locations, limit) {
    const unique = new Map();
    for (const location of locations) {
        const key = `${location.file}:${location.line}:${location.column}:${location.isDefinition}`;
        if (!unique.has(key))
            unique.set(key, location);
    }
    return [...unique.values()].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column).slice(0, limit);
}
class TypeScriptLanguageServiceSymbolProvider {
    projectCache = new Map();
    astFallback = new symbol_search_1.TypeScriptAstSymbolProvider();
    async findSymbol(root, symbol, limit = 100) {
        const { projects } = await this.loadProjects(root);
        if (!projects.length)
            return this.astFallback.findSymbol(root, symbol, limit);
        const results = [];
        for (const project of projects) {
            const program = project.service.getProgram();
            if (!program)
                continue;
            for (const source of program.getSourceFiles()) {
                const fileName = source.fileName;
                if (!isWithin(root, fileName))
                    continue;
                const visit = (node) => {
                    if (typescript_1.default.isIdentifier(node) && node.text === symbol) {
                        const definitions = project.service.getDefinitionAtPosition(fileName, node.getStart(source)) ?? [];
                        for (const definition of definitions) {
                            const location = locationFor(root, definition.fileName, definition.textSpan.start, symbol, true);
                            if (location)
                                results.push(location);
                        }
                    }
                    typescript_1.default.forEachChild(node, visit);
                };
                visit(source);
                if (results.length >= limit)
                    return sortAndDedupe(results, limit);
            }
        }
        return sortAndDedupe(results, limit);
    }
    async findReferences(root, symbol, includeDefinition = false, limit = 500) {
        const { projects } = await this.loadProjects(root);
        if (!projects.length)
            return this.astFallback.findReferences(root, symbol, includeDefinition, limit);
        const results = [];
        for (const project of projects) {
            const program = project.service.getProgram();
            if (!program)
                continue;
            for (const source of program.getSourceFiles()) {
                const fileName = source.fileName;
                if (!isWithin(root, fileName))
                    continue;
                const visit = (node) => {
                    if (typescript_1.default.isIdentifier(node) && node.text === symbol) {
                        const referenceGroups = project.service.findReferences(fileName, node.getStart(source)) ?? [];
                        for (const group of referenceGroups) {
                            for (const reference of group.references) {
                                const isDefinition = reference.isDefinition ?? false;
                                if (isDefinition && !includeDefinition)
                                    continue;
                                const location = locationFor(root, reference.fileName, reference.textSpan.start, symbol, isDefinition);
                                if (location)
                                    results.push(location);
                            }
                        }
                    }
                    typescript_1.default.forEachChild(node, visit);
                };
                visit(source);
                if (results.length >= limit)
                    return sortAndDedupe(results, limit);
            }
        }
        return sortAndDedupe(results, limit);
    }
    async findImplementations(root, symbol, limit = 100) {
        const { projects } = await this.loadProjects(root);
        if (!projects.length)
            return this.astFallback.findImplementations(root, symbol, limit);
        const results = [];
        for (const project of projects) {
            const program = project.service.getProgram();
            if (!program)
                continue;
            for (const source of program.getSourceFiles()) {
                const fileName = source.fileName;
                if (!isWithin(root, fileName))
                    continue;
                const visit = (node) => {
                    if (typescript_1.default.isIdentifier(node) && node.text === symbol) {
                        const implementations = project.service.getImplementationAtPosition(fileName, node.getStart(source)) ?? [];
                        for (const implementation of implementations) {
                            const location = locationFor(root, implementation.fileName, implementation.textSpan.start, symbol, true);
                            if (location)
                                results.push(location);
                        }
                    }
                    typescript_1.default.forEachChild(node, visit);
                };
                visit(source);
                if (results.length >= limit)
                    return sortAndDedupe(results, limit);
            }
        }
        return results.length ? sortAndDedupe(results, limit) : this.astFallback.findImplementations(root, symbol, limit);
    }
    async resolveSymbol(root, symbol) {
        const load = await this.loadProjects(root);
        const locations = await this.findSymbol(root, symbol);
        if (locations.length && load.projects.length)
            return { status: "verified", locations };
        if (locations.length)
            return { status: "inferred", locations, reason: load.reason ?? "No valid tsconfig project was found" };
        return { status: "unresolved", locations: [], reason: load.reason ?? `No definition for ${symbol} was found` };
    }
    dispose() {
        for (const load of this.projectCache.values()) {
            void load.then(({ projects }) => projects.forEach((project) => project.service.dispose()));
        }
        this.projectCache.clear();
    }
    loadProjects(root) {
        const key = node_path_1.default.resolve(root);
        let pending = this.projectCache.get(key);
        if (!pending) {
            pending = this.createProjects(key);
            this.projectCache.set(key, pending);
        }
        return pending;
    }
    async createProjects(rootPath) {
        const root = await (0, promises_1.realpath)(rootPath);
        const files = await (0, file_search_1.listFiles)(root, { include: ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts", "**/tsconfig*.json"], limit: 5_000 });
        const sourceFiles = files.filter((file) => /\.(?:ts|tsx|mts|cts)$/i.test(file)).map((file) => node_path_1.default.resolve(root, file));
        const configFiles = files.filter((file) => /(?:^|\/)tsconfig[^/]*\.json$/i.test(file)).map((file) => node_path_1.default.resolve(root, file));
        if (!configFiles.length)
            return { projects: [], reason: "No tsconfig project was found; AST results are inferred" };
        const allowedWorkspaceFiles = new Set([...sourceFiles, ...configFiles]);
        const defaultLibDirectory = node_path_1.default.dirname(node_path_1.default.resolve(typescript_1.default.getDefaultLibFilePath({})));
        const canRead = (fileName) => {
            const absolute = node_path_1.default.resolve(fileName);
            return allowedWorkspaceFiles.has(absolute) || isWithin(defaultLibDirectory, absolute);
        };
        const readWorkspaceFile = (fileName) => {
            if (!canRead(fileName))
                return undefined;
            try {
                return (0, node_fs_1.readFileSync)(fileName, "utf8");
            }
            catch {
                return undefined;
            }
        };
        const parseHost = {
            useCaseSensitiveFileNames: typescript_1.default.sys.useCaseSensitiveFileNames,
            getCurrentDirectory: () => root,
            fileExists: (fileName) => canRead(fileName) && (0, node_fs_1.existsSync)(fileName),
            readFile: readWorkspaceFile,
            readDirectory: (directory, extensions, excludes, includes) => {
                const absoluteDirectory = node_path_1.default.resolve(directory);
                if (!isWithin(root, absoluteDirectory))
                    return [];
                const relativeIncludes = includes?.map((pattern) => node_path_1.default.isAbsolute(pattern) ? toPosix(node_path_1.default.relative(absoluteDirectory, pattern)) : pattern);
                const relativeExcludes = excludes?.map((pattern) => node_path_1.default.isAbsolute(pattern) ? toPosix(node_path_1.default.relative(absoluteDirectory, pattern)) : pattern);
                const candidates = sourceFiles.filter((fileName) => {
                    if (!isWithin(absoluteDirectory, fileName))
                        return false;
                    if (extensions?.length && !extensions.some((extension) => fileName.endsWith(extension)))
                        return false;
                    const relative = toPosix(node_path_1.default.relative(absoluteDirectory, fileName));
                    return matchesPatterns(relative, relativeIncludes) && !(relativeExcludes ?? []).some((pattern) => globRegex(pattern).test(relative));
                });
                return candidates;
            },
            onUnRecoverableConfigFileDiagnostic: () => undefined,
        };
        const projects = [];
        let hadMalformedConfig = false;
        for (const configFile of configFiles) {
            try {
                const parsed = typescript_1.default.getParsedCommandLineOfConfigFile(configFile, {}, {
                    ...parseHost,
                    getCurrentDirectory: () => root,
                });
                if (!parsed) {
                    hadMalformedConfig = true;
                    continue;
                }
                const projectFiles = parsed.fileNames.map((fileName) => node_path_1.default.resolve(fileName))
                    .filter((fileName) => isWithin(root, fileName) && allowedWorkspaceFiles.has(fileName));
                if (!projectFiles.length)
                    continue;
                const host = {
                    getCompilationSettings: () => parsed.options,
                    getScriptFileNames: () => projectFiles,
                    getScriptVersion: () => "0",
                    getScriptSnapshot: (fileName) => {
                        const text = readWorkspaceFile(fileName);
                        return text === undefined ? undefined : typescript_1.default.ScriptSnapshot.fromString(text);
                    },
                    getCurrentDirectory: () => root,
                    getDefaultLibFileName: (options) => typescript_1.default.getDefaultLibFilePath(options),
                    fileExists: parseHost.fileExists,
                    readFile: parseHost.readFile,
                    readDirectory: (directory, extensions = [], excludes = [], includes = [], depth) => Array.from(parseHost.readDirectory?.(directory, extensions, excludes, includes, depth) ?? []),
                    directoryExists: (directory) => isWithin(root, node_path_1.default.resolve(directory)) && (0, node_fs_1.existsSync)(directory),
                    getDirectories: (directory) => typescript_1.default.sys.getDirectories(directory).filter((child) => isWithin(root, node_path_1.default.resolve(directory, child))),
                    useCaseSensitiveFileNames: () => typescript_1.default.sys.useCaseSensitiveFileNames,
                };
                projects.push({ files: projectFiles, service: typescript_1.default.createLanguageService(host) });
            }
            catch {
                hadMalformedConfig = true;
            }
        }
        return {
            projects,
            reason: projects.length ? undefined : hadMalformedConfig ? "No valid tsconfig project could be loaded; AST results are inferred" : "No configured TypeScript project files were found",
        };
    }
}
exports.TypeScriptLanguageServiceSymbolProvider = TypeScriptLanguageServiceSymbolProvider;
