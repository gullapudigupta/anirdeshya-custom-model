import { existsSync, readFileSync } from "node:fs";
import { realpath } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import { listFiles } from "./file-search";
import { TypeScriptAstSymbolProvider, type SymbolKind, type SymbolLocation, type TypeScriptSymbolProvider } from "./symbol-search";

export type SymbolResolution =
  | { status: "verified" | "inferred"; locations: SymbolLocation[]; reason?: string }
  | { status: "unresolved"; locations: []; reason: string };

interface Project {
  rootNames: string[];
  program: ts.Program;
}

interface ProjectLoad {
  projects: Project[];
  reason?: string;
}

interface ParsedConfig {
  compilerOptions?: Record<string, unknown>;
  files?: string[];
  include?: string[];
  exclude?: string[];
  extends?: string;
}

function toPosix(value: string): string {
  return value.replace(/\\/g, "/");
}

function isWithin(root: string, file: string): boolean {
  const normalizedRoot = process.platform === "win32" ? path.resolve(root).toLowerCase() : path.resolve(root);
  const normalizedFile = process.platform === "win32" ? path.resolve(file).toLowerCase() : path.resolve(file);
  const relative = path.relative(normalizedRoot, normalizedFile);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function normalizedPath(fileName: string): string {
  const absolute = path.resolve(fileName);
  return process.platform === "win32" ? absolute.toLowerCase() : absolute;
}

function globRegex(pattern: string): RegExp {
  const normalized = toPosix(pattern);
  let expression = "";
  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index];
    if (character === "*" && normalized[index + 1] === "*") {
      index += 1;
      if (normalized[index + 1] === "/") {
        index += 1;
        expression += "(?:.*/)?";
      } else expression += ".*";
    } else if (character === "*") expression += "[^/]*";
    else if (character === "?") expression += "[^/]";
    else expression += /[.+^${}()|[\]\\]/.test(character) ? `\\${character}` : character;
  }
  return new RegExp(`^${expression}$`);
}

function matchesAny(value: string, patterns: string[]): boolean {
  return patterns.some((pattern) => globRegex(pattern).test(value));
}

function symbolKind(node: ts.Node): SymbolKind {
  if (ts.isFunctionDeclaration(node)) return "function";
  if (ts.isMethodDeclaration(node) || ts.isMethodSignature(node)) return "method";
  if (ts.isClassDeclaration(node)) return "class";
  if (ts.isInterfaceDeclaration(node)) return "interface";
  if (ts.isVariableDeclaration(node) || ts.isParameter(node)) return "variable";
  if (ts.isPropertyDeclaration(node) || ts.isPropertySignature(node)) return "property";
  if (ts.isTypeAliasDeclaration(node)) return "type";
  if (ts.isEnumDeclaration(node)) return "enum";
  return "variable";
}

function symbolKey(symbol: ts.Symbol, checker: ts.TypeChecker): string {
  const resolved = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
  return (resolved.declarations ?? []).map((declaration) => `${path.resolve(declaration.getSourceFile().fileName)}:${declaration.getStart()}`).sort().join("|");
}

function declarationLocation(root: string, declaration: ts.Declaration, name: string, isDefinition: boolean): SymbolLocation | undefined {
  const source = declaration.getSourceFile();
  if (!isWithin(root, source.fileName)) return undefined;
  const namedNode = (declaration as ts.NamedDeclaration).name as ts.Node | undefined;
  const location = source.getLineAndCharacterOfPosition((namedNode ?? declaration).getStart(source));
  return {
    name,
    kind: symbolKind(declaration),
    file: toPosix(path.relative(root, source.fileName)),
    line: location.line + 1,
    column: location.character + 1,
    isDefinition,
  };
}

function mergedConfig(
  fileName: string,
  root: string,
  availableConfigs: Set<string>,
  seen: Set<string> = new Set(),
): ParsedConfig | undefined {
  const absolute = path.resolve(fileName);
  if (!isWithin(root, absolute) || !availableConfigs.has(absolute) || seen.has(absolute)) return undefined;
  seen.add(absolute);
  let current: ParsedConfig;
  try { current = JSON.parse(readFileSync(absolute, "utf8")) as ParsedConfig; }
  catch { return undefined; }

  let base: ParsedConfig = {};
  if (current.extends) {
    const requested = path.resolve(path.dirname(absolute), current.extends);
    const candidates = path.extname(requested) ? [requested] : [`${requested}.json`, path.join(requested, "tsconfig.json")];
    const basePath = candidates.find((candidate) => availableConfigs.has(candidate) && isWithin(root, candidate));
    if (!basePath) return undefined;
    const loadedBase = mergedConfig(basePath, root, availableConfigs, seen);
    if (!loadedBase) return undefined;
    base = loadedBase;
  }
  return {
    ...base,
    ...current,
    compilerOptions: {
      ...base.compilerOptions,
      ...current.compilerOptions,
      paths: {
        ...(base.compilerOptions?.paths as Record<string, unknown> | undefined),
        ...(current.compilerOptions?.paths as Record<string, unknown> | undefined),
      },
    },
    files: current.files ?? base.files,
    include: current.include ?? base.include,
    exclude: current.exclude ?? base.exclude,
  };
}

function rootNamesForConfig(config: ParsedConfig, configFile: string, root: string, sourceFiles: string[]): string[] {
  const base = path.dirname(configFile);
  if (config.files) {
    return config.files.map((file) => path.resolve(base, file))
      .filter((file) => isWithin(root, file) && sourceFiles.includes(file));
  }
  const includes = (config.include ?? ["**/*"]).map((pattern) => toPosix(pattern));
  const excludes = [...(config.exclude ?? []), "node_modules", "bower_components", "jspm_packages", "**/node_modules/**"];
  return sourceFiles.filter((file) => {
    if (!isWithin(root, file)) return false;
    const relative = toPosix(path.relative(base, file));
    return matchesAny(relative, includes) && !matchesAny(relative, excludes);
  });
}

function compilerHost(root: string, allowedFiles: Set<string>, defaultLibDirectory: string, options: ts.CompilerOptions): ts.CompilerHost {
  const host = ts.createCompilerHost(options, true);
  const canRead = (fileName: string): boolean => {
    const absolute = path.resolve(fileName);
    return allowedFiles.has(normalizedPath(absolute)) || isWithin(defaultLibDirectory, absolute);
  };
  const safeRead = (fileName: string): string | undefined => {
    if (!canRead(fileName)) return undefined;
    try { return readFileSync(fileName, "utf8"); } catch { return undefined; }
  };
  host.fileExists = (fileName) => canRead(fileName) && existsSync(fileName);
  host.readFile = safeRead;
  host.getSourceFile = (fileName, languageVersion, onError) => {
    const text = safeRead(fileName);
    if (text === undefined) {
      onError?.(`File is outside the configured analysis boundary: ${fileName}`);
      return undefined;
    }
    return ts.createSourceFile(fileName, text, languageVersion, true);
  };
  host.directoryExists = (directory) => isWithin(root, path.resolve(directory)) && existsSync(directory);
  host.getDirectories = (directory) => isWithin(root, path.resolve(directory))
    ? ts.sys.getDirectories(directory).filter((entry) => isWithin(root, path.resolve(directory, entry)))
    : [];
  host.realpath = (fileName) => path.resolve(fileName);
  return host;
}

export class TypeScriptCompilerSymbolProvider implements TypeScriptSymbolProvider {
  private readonly projectCache = new Map<string, Promise<ProjectLoad>>();
  private readonly astFallback = new TypeScriptAstSymbolProvider();

  async findSymbol(root: string, symbol: string, limit = 100): Promise<SymbolLocation[]> {
    const { projects } = await this.loadProjects(root);
    if (!projects.length) return this.astFallback.findSymbol(root, symbol, limit);
    const results: SymbolLocation[] = [];
    for (const { program } of projects) {
      const checker = program.getTypeChecker();
      for (const source of program.getSourceFiles()) {
        if (!isWithin(path.resolve(root), source.fileName)) continue;
        const visit = (node: ts.Node): void => {
          if (ts.isIdentifier(node) && node.text === symbol) {
            const found = checker.getSymbolAtLocation(node);
            if (found) {
              const target = found.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(found) : found;
              for (const declaration of target.declarations ?? []) {
                const location = declarationLocation(path.resolve(root), declaration, symbol, true);
                if (location) results.push(location);
              }
            }
          }
          ts.forEachChild(node, visit);
        };
        visit(source);
      }
    }
    return this.sortAndLimit(results, limit);
  }

  async findReferences(root: string, symbol: string, includeDefinition = false, limit = 500): Promise<SymbolLocation[]> {
    const { projects } = await this.loadProjects(root);
    if (!projects.length) return this.astFallback.findReferences(root, symbol, includeDefinition, limit);
    const results: SymbolLocation[] = [];
    for (const { program } of projects) {
      const checker = program.getTypeChecker();
      const targets = new Set<string>();
      const sources = program.getSourceFiles().filter((source) => isWithin(path.resolve(root), source.fileName));
      for (const source of sources) {
        const collect = (node: ts.Node): void => {
          if (ts.isIdentifier(node) && node.text === symbol) {
            const found = checker.getSymbolAtLocation(node);
            if (found) targets.add(symbolKey(found, checker));
          }
          ts.forEachChild(node, collect);
        };
        collect(source);
      }
      for (const source of sources) {
        const collect = (node: ts.Node): void => {
          if (ts.isIdentifier(node)) {
            const found = checker.getSymbolAtLocation(node);
            if (found && targets.has(symbolKey(found, checker))) {
              const declaration = this.isDeclarationName(node);
              if (includeDefinition || !declaration) {
                const location = declarationLocation(path.resolve(root), node.parent as ts.Declaration, symbol, declaration);
                if (location) results.push(location);
              }
            }
          }
          ts.forEachChild(node, collect);
        };
        collect(source);
      }
    }
    return this.sortAndLimit(results, limit);
  }

  async findImplementations(root: string, symbol: string, limit = 100): Promise<SymbolLocation[]> {
    const { projects } = await this.loadProjects(root);
    if (!projects.length) return this.astFallback.findImplementations(root, symbol, limit);
    const results: SymbolLocation[] = [];
    for (const { program } of projects) {
      const checker = program.getTypeChecker();
      const sources = program.getSourceFiles().filter((source) => isWithin(path.resolve(root), source.fileName));
      const targets = new Set<string>();
      const memberNames = new Set<string>();
      for (const source of sources) {
        const collect = (node: ts.Node): void => {
          if (ts.isIdentifier(node) && node.text === symbol) {
            const found = checker.getSymbolAtLocation(node);
            if (!found) return;
            const target = found.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(found) : found;
            targets.add(symbolKey(target, checker));
            for (const declaration of target.declarations ?? []) {
              if (ts.isMethodSignature(declaration) || ts.isPropertySignature(declaration)) memberNames.add(declaration.name.getText(source));
              if (ts.isClassDeclaration(declaration) || ts.isInterfaceDeclaration(declaration)) {
                for (const member of declaration.members) if ("name" in member && member.name) memberNames.add(member.name.getText(source));
              }
            }
          }
          ts.forEachChild(node, collect);
        };
        collect(source);
      }
      for (const source of sources) {
        const visit = (node: ts.Node): void => {
          if (ts.isClassDeclaration(node) && node.name) {
            const inherited = node.heritageClauses?.flatMap((clause) => clause.types)
              .some((heritage) => {
                const heritageSymbol = checker.getSymbolAtLocation(heritage.expression);
                return heritageSymbol !== undefined && targets.has(symbolKey(heritageSymbol, checker));
              }) ?? false;
            if (inherited) {
              for (const member of node.members) {
                if (!("name" in member) || !member.name) continue;
                const name = member.name.getText(source);
                if (memberNames.size && !memberNames.has(name)) continue;
                const location = declarationLocation(path.resolve(root), member as ts.Declaration, name, true);
                if (location) results.push(location);
              }
            }
          }
          ts.forEachChild(node, visit);
        };
        visit(source);
      }
    }
    const locations = this.sortAndLimit(results, limit);
    return locations.length ? locations : this.astFallback.findImplementations(root, symbol, limit);
  }

  async resolveSymbol(root: string, symbol: string): Promise<SymbolResolution> {
    const load = await this.loadProjects(root);
    const locations = await this.findSymbol(root, symbol);
    if (locations.length && load.projects.length) return { status: "verified", locations };
    if (locations.length) return { status: "inferred", locations, reason: load.reason ?? "No valid tsconfig project was found" };
    const projectSummary = load.projects.map((project) => `${project.rootNames.map((name) => path.basename(name)).join("|")} roots; ${project.program.getSourceFiles().slice(0, 6).map((source) => toPosix(source.fileName)).join("|")} program files`).join("; ");
    return { status: "unresolved", locations: [], reason: load.reason ?? `No definition for ${symbol} was found (${projectSummary})` };
  }

  private async loadProjects(rootPath: string): Promise<ProjectLoad> {
    const key = path.resolve(rootPath);
    let pending = this.projectCache.get(key);
    if (!pending) {
      pending = this.createProjects(key);
      this.projectCache.set(key, pending);
    }
    return pending;
  }

  private async createProjects(rootPath: string): Promise<ProjectLoad> {
    const root = await realpath(rootPath);
    const files = await listFiles(root, { include: ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts", "**/*.json"], limit: 10_000 });
    const sourceFiles = files.filter((file) => /\.(?:ts|tsx|mts|cts)$/i.test(file)).map((file) => path.resolve(root, file));
    const jsonFiles = files.filter((file) => file.endsWith(".json")).map((file) => path.resolve(root, file));
    const configFiles = jsonFiles.filter((file) => /(?:^|[\\/])tsconfig[^\\/]*\.json$/i.test(file));
    if (!configFiles.length) return { projects: [], reason: "No tsconfig project was found; AST results are inferred" };
    const allowedFiles = new Set([...sourceFiles, ...jsonFiles].map(normalizedPath));
    const availableConfigs = new Set(jsonFiles);
    const defaultLibDirectory = path.dirname(path.resolve(ts.getDefaultLibFilePath({})));
    const projects: Project[] = [];
    let hasMalformedConfig = false;
    for (const configFile of configFiles) {
      const config = mergedConfig(configFile, root, availableConfigs);
      if (!config) { hasMalformedConfig = true; continue; }
      const converted = ts.convertCompilerOptionsFromJson(config.compilerOptions ?? {}, path.dirname(configFile));
      const options = { ...converted.options, noEmit: true };
      const rootNames = rootNamesForConfig(config, configFile, root, sourceFiles);
      if (!rootNames.length) continue;
      const host = compilerHost(root, allowedFiles, defaultLibDirectory, options);
      projects.push({ rootNames, program: ts.createProgram(rootNames, options, host) });
    }
    return {
      projects,
      reason: projects.length ? undefined : hasMalformedConfig ? "No valid in-workspace tsconfig project could be loaded; AST results are inferred" : "No configured TypeScript source files were found",
    };
  }

  private isDeclarationName(node: ts.Identifier): boolean {
    const parent = node.parent;
    return ("name" in parent && parent.name === node)
      || (ts.isImportSpecifier(parent) && parent.name === node)
      || (ts.isExportSpecifier(parent) && parent.name === node);
  }

  private sortAndLimit(locations: SymbolLocation[], limit: number): SymbolLocation[] {
    const unique = new Map<string, SymbolLocation>();
    for (const location of locations) {
      const key = `${location.file}:${location.line}:${location.column}:${location.isDefinition}`;
      if (!unique.has(key)) unique.set(key, location);
    }
    return [...unique.values()].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column).slice(0, limit);
  }
}