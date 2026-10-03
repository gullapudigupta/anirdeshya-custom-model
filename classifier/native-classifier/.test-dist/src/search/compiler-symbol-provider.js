"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TypeScriptCompilerSymbolProvider = void 0;
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
    const normalizedRoot = process.platform === "win32" ? node_path_1.default.resolve(root).toLowerCase() : node_path_1.default.resolve(root);
    const normalizedFile = process.platform === "win32" ? node_path_1.default.resolve(file).toLowerCase() : node_path_1.default.resolve(file);
    const relative = node_path_1.default.relative(normalizedRoot, normalizedFile);
    return relative === "" || (relative !== ".." && !relative.startsWith(`..${node_path_1.default.sep}`) && !node_path_1.default.isAbsolute(relative));
}
function normalizedPath(fileName) {
    const absolute = node_path_1.default.resolve(fileName);
    return process.platform === "win32" ? absolute.toLowerCase() : absolute;
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
            else
                expression += ".*";
        }
        else if (character === "*")
            expression += "[^/]*";
        else if (character === "?")
            expression += "[^/]";
        else
            expression += /[.+^${}()|[\]\\]/.test(character) ? `\\${character}` : character;
    }
    return new RegExp(`^${expression}$`);
}
function matchesAny(value, patterns) {
    return patterns.some((pattern) => globRegex(pattern).test(value));
}
function symbolKind(node) {
    if (typescript_1.default.isFunctionDeclaration(node))
        return "function";
    if (typescript_1.default.isMethodDeclaration(node) || typescript_1.default.isMethodSignature(node))
        return "method";
    if (typescript_1.default.isClassDeclaration(node))
        return "class";
    if (typescript_1.default.isInterfaceDeclaration(node))
        return "interface";
    if (typescript_1.default.isVariableDeclaration(node) || typescript_1.default.isParameter(node))
        return "variable";
    if (typescript_1.default.isPropertyDeclaration(node) || typescript_1.default.isPropertySignature(node))
        return "property";
    if (typescript_1.default.isTypeAliasDeclaration(node))
        return "type";
    if (typescript_1.default.isEnumDeclaration(node))
        return "enum";
    return "variable";
}
function symbolKey(symbol, checker) {
    const resolved = symbol.flags & typescript_1.default.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
    return (resolved.declarations ?? []).map((declaration) => `${node_path_1.default.resolve(declaration.getSourceFile().fileName)}:${declaration.getStart()}`).sort().join("|");
}
function declarationLocation(root, declaration, name, isDefinition) {
    const source = declaration.getSourceFile();
    if (!isWithin(root, source.fileName))
        return undefined;
    const namedNode = declaration.name;
    const location = source.getLineAndCharacterOfPosition((namedNode ?? declaration).getStart(source));
    return {
        name,
        kind: symbolKind(declaration),
        file: toPosix(node_path_1.default.relative(root, source.fileName)),
        line: location.line + 1,
        column: location.character + 1,
        isDefinition,
    };
}
function mergedConfig(fileName, root, availableConfigs, seen = new Set()) {
    const absolute = node_path_1.default.resolve(fileName);
    if (!isWithin(root, absolute) || !availableConfigs.has(absolute) || seen.has(absolute))
        return undefined;
    seen.add(absolute);
    let current;
    try {
        current = JSON.parse((0, node_fs_1.readFileSync)(absolute, "utf8"));
    }
    catch {
        return undefined;
    }
    let base = {};
    if (current.extends) {
        const requested = node_path_1.default.resolve(node_path_1.default.dirname(absolute), current.extends);
        const candidates = node_path_1.default.extname(requested) ? [requested] : [`${requested}.json`, node_path_1.default.join(requested, "tsconfig.json")];
        const basePath = candidates.find((candidate) => availableConfigs.has(candidate) && isWithin(root, candidate));
        if (!basePath)
            return undefined;
        const loadedBase = mergedConfig(basePath, root, availableConfigs, seen);
        if (!loadedBase)
            return undefined;
        base = loadedBase;
    }
    return {
        ...base,
        ...current,
        compilerOptions: {
            ...base.compilerOptions,
            ...current.compilerOptions,
            paths: {
                ...base.compilerOptions?.paths,
                ...current.compilerOptions?.paths,
            },
        },
        files: current.files ?? base.files,
        include: current.include ?? base.include,
        exclude: current.exclude ?? base.exclude,
    };
}
function rootNamesForConfig(config, configFile, root, sourceFiles) {
    const base = node_path_1.default.dirname(configFile);
    if (config.files) {
        return config.files.map((file) => node_path_1.default.resolve(base, file))
            .filter((file) => isWithin(root, file) && sourceFiles.includes(file));
    }
    const includes = (config.include ?? ["**/*"]).map((pattern) => toPosix(pattern));
    const excludes = [...(config.exclude ?? []), "node_modules", "bower_components", "jspm_packages", "**/node_modules/**"];
    return sourceFiles.filter((file) => {
        if (!isWithin(root, file))
            return false;
        const relative = toPosix(node_path_1.default.relative(base, file));
        return matchesAny(relative, includes) && !matchesAny(relative, excludes);
    });
}
function compilerHost(root, allowedFiles, defaultLibDirectory, options) {
    const host = typescript_1.default.createCompilerHost(options, true);
    const canRead = (fileName) => {
        const absolute = node_path_1.default.resolve(fileName);
        return allowedFiles.has(normalizedPath(absolute)) || isWithin(defaultLibDirectory, absolute);
    };
    const safeRead = (fileName) => {
        if (!canRead(fileName))
            return undefined;
        try {
            return (0, node_fs_1.readFileSync)(fileName, "utf8");
        }
        catch {
            return undefined;
        }
    };
    host.fileExists = (fileName) => canRead(fileName) && (0, node_fs_1.existsSync)(fileName);
    host.readFile = safeRead;
    host.getSourceFile = (fileName, languageVersion, onError) => {
        const text = safeRead(fileName);
        if (text === undefined) {
            onError?.(`File is outside the configured analysis boundary: ${fileName}`);
            return undefined;
        }
        return typescript_1.default.createSourceFile(fileName, text, languageVersion, true);
    };
    host.directoryExists = (directory) => isWithin(root, node_path_1.default.resolve(directory)) && (0, node_fs_1.existsSync)(directory);
    host.getDirectories = (directory) => isWithin(root, node_path_1.default.resolve(directory))
        ? typescript_1.default.sys.getDirectories(directory).filter((entry) => isWithin(root, node_path_1.default.resolve(directory, entry)))
        : [];
    host.realpath = (fileName) => node_path_1.default.resolve(fileName);
    return host;
}
class TypeScriptCompilerSymbolProvider {
    projectCache = new Map();
    astFallback = new symbol_search_1.TypeScriptAstSymbolProvider();
    async findSymbol(root, symbol, limit = 100) {
        const { projects } = await this.loadProjects(root);
        if (!projects.length)
            return this.astFallback.findSymbol(root, symbol, limit);
        const results = [];
        for (const { program } of projects) {
            const checker = program.getTypeChecker();
            for (const source of program.getSourceFiles()) {
                if (!isWithin(node_path_1.default.resolve(root), source.fileName))
                    continue;
                const visit = (node) => {
                    if (typescript_1.default.isIdentifier(node) && node.text === symbol) {
                        const found = checker.getSymbolAtLocation(node);
                        if (found) {
                            const target = found.flags & typescript_1.default.SymbolFlags.Alias ? checker.getAliasedSymbol(found) : found;
                            for (const declaration of target.declarations ?? []) {
                                const location = declarationLocation(node_path_1.default.resolve(root), declaration, symbol, true);
                                if (location)
                                    results.push(location);
                            }
                        }
                    }
                    typescript_1.default.forEachChild(node, visit);
                };
                visit(source);
            }
        }
        return this.sortAndLimit(results, limit);
    }
    async findReferences(root, symbol, includeDefinition = false, limit = 500) {
        const { projects } = await this.loadProjects(root);
        if (!projects.length)
            return this.astFallback.findReferences(root, symbol, includeDefinition, limit);
        const results = [];
        for (const { program } of projects) {
            const checker = program.getTypeChecker();
            const targets = new Set();
            const sources = program.getSourceFiles().filter((source) => isWithin(node_path_1.default.resolve(root), source.fileName));
            for (const source of sources) {
                const collect = (node) => {
                    if (typescript_1.default.isIdentifier(node) && node.text === symbol) {
                        const found = checker.getSymbolAtLocation(node);
                        if (found)
                            targets.add(symbolKey(found, checker));
                    }
                    typescript_1.default.forEachChild(node, collect);
                };
                collect(source);
            }
            for (const source of sources) {
                const collect = (node) => {
                    if (typescript_1.default.isIdentifier(node)) {
                        const found = checker.getSymbolAtLocation(node);
                        if (found && targets.has(symbolKey(found, checker))) {
                            const declaration = this.isDeclarationName(node);
                            if (includeDefinition || !declaration) {
                                const location = declarationLocation(node_path_1.default.resolve(root), node.parent, symbol, declaration);
                                if (location)
                                    results.push(location);
                            }
                        }
                    }
                    typescript_1.default.forEachChild(node, collect);
                };
                collect(source);
            }
        }
        return this.sortAndLimit(results, limit);
    }
    async findImplementations(root, symbol, limit = 100) {
        const { projects } = await this.loadProjects(root);
        if (!projects.length)
            return this.astFallback.findImplementations(root, symbol, limit);
        const results = [];
        for (const { program } of projects) {
            const checker = program.getTypeChecker();
            const sources = program.getSourceFiles().filter((source) => isWithin(node_path_1.default.resolve(root), source.fileName));
            const targets = new Set();
            const memberNames = new Set();
            for (const source of sources) {
                const collect = (node) => {
                    if (typescript_1.default.isIdentifier(node) && node.text === symbol) {
                        const found = checker.getSymbolAtLocation(node);
                        if (!found)
                            return;
                        const target = found.flags & typescript_1.default.SymbolFlags.Alias ? checker.getAliasedSymbol(found) : found;
                        targets.add(symbolKey(target, checker));
                        for (const declaration of target.declarations ?? []) {
                            if (typescript_1.default.isMethodSignature(declaration) || typescript_1.default.isPropertySignature(declaration))
                                memberNames.add(declaration.name.getText(source));
                            if (typescript_1.default.isClassDeclaration(declaration) || typescript_1.default.isInterfaceDeclaration(declaration)) {
                                for (const member of declaration.members)
                                    if ("name" in member && member.name)
                                        memberNames.add(member.name.getText(source));
                            }
                        }
                    }
                    typescript_1.default.forEachChild(node, collect);
                };
                collect(source);
            }
            for (const source of sources) {
                const visit = (node) => {
                    if (typescript_1.default.isClassDeclaration(node) && node.name) {
                        const inherited = node.heritageClauses?.flatMap((clause) => clause.types)
                            .some((heritage) => {
                            const heritageSymbol = checker.getSymbolAtLocation(heritage.expression);
                            return heritageSymbol !== undefined && targets.has(symbolKey(heritageSymbol, checker));
                        }) ?? false;
                        if (inherited) {
                            for (const member of node.members) {
                                if (!("name" in member) || !member.name)
                                    continue;
                                const name = member.name.getText(source);
                                if (memberNames.size && !memberNames.has(name))
                                    continue;
                                const location = declarationLocation(node_path_1.default.resolve(root), member, name, true);
                                if (location)
                                    results.push(location);
                            }
                        }
                    }
                    typescript_1.default.forEachChild(node, visit);
                };
                visit(source);
            }
        }
        const locations = this.sortAndLimit(results, limit);
        return locations.length ? locations : this.astFallback.findImplementations(root, symbol, limit);
    }
    async resolveSymbol(root, symbol) {
        const load = await this.loadProjects(root);
        const locations = await this.findSymbol(root, symbol);
        if (locations.length && load.projects.length)
            return { status: "verified", locations };
        if (locations.length)
            return { status: "inferred", locations, reason: load.reason ?? "No valid tsconfig project was found" };
        const projectSummary = load.projects.map((project) => `${project.rootNames.map((name) => node_path_1.default.basename(name)).join("|")} roots; ${project.program.getSourceFiles().slice(0, 6).map((source) => toPosix(source.fileName)).join("|")} program files`).join("; ");
        return { status: "unresolved", locations: [], reason: load.reason ?? `No definition for ${symbol} was found (${projectSummary})` };
    }
    async loadProjects(rootPath) {
        const key = node_path_1.default.resolve(rootPath);
        let pending = this.projectCache.get(key);
        if (!pending) {
            pending = this.createProjects(key);
            this.projectCache.set(key, pending);
        }
        return pending;
    }
    async createProjects(rootPath) {
        const root = await (0, promises_1.realpath)(rootPath);
        const files = await (0, file_search_1.listFiles)(root, { include: ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts", "**/*.json"], limit: 10_000 });
        const sourceFiles = files.filter((file) => /\.(?:ts|tsx|mts|cts)$/i.test(file)).map((file) => node_path_1.default.resolve(root, file));
        const jsonFiles = files.filter((file) => file.endsWith(".json")).map((file) => node_path_1.default.resolve(root, file));
        const configFiles = jsonFiles.filter((file) => /(?:^|[\\/])tsconfig[^\\/]*\.json$/i.test(file));
        if (!configFiles.length)
            return { projects: [], reason: "No tsconfig project was found; AST results are inferred" };
        const allowedFiles = new Set([...sourceFiles, ...jsonFiles].map(normalizedPath));
        const availableConfigs = new Set(jsonFiles);
        const defaultLibDirectory = node_path_1.default.dirname(node_path_1.default.resolve(typescript_1.default.getDefaultLibFilePath({})));
        const projects = [];
        let hasMalformedConfig = false;
        for (const configFile of configFiles) {
            const config = mergedConfig(configFile, root, availableConfigs);
            if (!config) {
                hasMalformedConfig = true;
                continue;
            }
            const converted = typescript_1.default.convertCompilerOptionsFromJson(config.compilerOptions ?? {}, node_path_1.default.dirname(configFile));
            const options = { ...converted.options, noEmit: true };
            const rootNames = rootNamesForConfig(config, configFile, root, sourceFiles);
            if (!rootNames.length)
                continue;
            const host = compilerHost(root, allowedFiles, defaultLibDirectory, options);
            projects.push({ rootNames, program: typescript_1.default.createProgram(rootNames, options, host) });
        }
        return {
            projects,
            reason: projects.length ? undefined : hasMalformedConfig ? "No valid in-workspace tsconfig project could be loaded; AST results are inferred" : "No configured TypeScript source files were found",
        };
    }
    isDeclarationName(node) {
        const parent = node.parent;
        return ("name" in parent && parent.name === node)
            || (typescript_1.default.isImportSpecifier(parent) && parent.name === node)
            || (typescript_1.default.isExportSpecifier(parent) && parent.name === node);
    }
    sortAndLimit(locations, limit) {
        const unique = new Map();
        for (const location of locations) {
            const key = `${location.file}:${location.line}:${location.column}:${location.isDefinition}`;
            if (!unique.has(key))
                unique.set(key, location);
        }
        return [...unique.values()].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column).slice(0, limit);
    }
}
exports.TypeScriptCompilerSymbolProvider = TypeScriptCompilerSymbolProvider;
