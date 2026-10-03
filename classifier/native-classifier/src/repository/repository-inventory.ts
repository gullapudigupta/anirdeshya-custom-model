import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { defaultIgnorePatterns, isIgnoredPath, isPathInside, normalizeRelativePath, parseIgnoreFile } from "./ignore-policy";
import { detectProject } from "./project-detector";

export const repositoryInventorySchema = z.object({
  root: z.string(),
  files: z.array(z.string()),
  languages: z.array(z.string()),
  frameworks: z.array(z.object({ name: z.string(), version: z.string().optional() }).strict()),
  sourceRoots: z.array(z.string()),
  testRoots: z.array(z.string()),
  ignoredPaths: z.array(z.string()),
  layers: z.array(z.object({ name: z.enum(["frontend", "api", "service", "persistence", "shared"]), directories: z.array(z.string()) }).strict()),
  isMonorepo: z.boolean(),
}).strict();

export type RepositoryInventory = z.infer<typeof repositoryInventorySchema>;
export interface RepositoryInventoryService {
  inventory(root: string, options?: InventoryOptions): Promise<RepositoryInventory>;
}

export interface InventoryOptions {
  maxFiles?: number;
  maxDirectories?: number;
  ignorePatterns?: string[];
  signal?: AbortSignal;
}

export class InventoryLimitError extends Error {
  constructor(message: string) { super(message); this.name = "InventoryLimitError"; }
}

export class LocalRepositoryInventory implements RepositoryInventoryService {
  async inventory(root: string, options: InventoryOptions = {}): Promise<RepositoryInventory> {
    const canonicalRoot = await realpath(root);
    const rootStats = await lstat(canonicalRoot);
    if (!rootStats.isDirectory()) throw new Error("Workspace root must be a directory");
    const maxFiles = options.maxFiles ?? 20_000;
    const maxDirectories = options.maxDirectories ?? 5_000;
    const ignores = [...defaultIgnorePatterns, ...(options.ignorePatterns ?? [])];
    const ignoreFile = path.join(canonicalRoot, ".gitignore");
    try { ignores.push(...parseIgnoreFile(await readFile(ignoreFile, "utf8"))); } catch { /* Optional metadata. */ }

    const files: string[] = [];
    const directories: string[] = [];
    const ignoredPaths = new Set<string>();
    const visit = async (absoluteDirectory: string, relativeDirectory: string): Promise<void> => {
      if (options.signal?.aborted) throw options.signal.reason ?? new Error("Inventory cancelled");
      const entries = await readdir(absoluteDirectory, { withFileTypes: true });
      for (const entry of entries) {
        const relative = normalizeRelativePath(path.join(relativeDirectory, entry.name));
        const absolute = path.join(absoluteDirectory, entry.name);
        if (!isPathInside(canonicalRoot, absolute)) throw new Error("Resolved path escaped workspace root");
        const stats = await lstat(absolute);
        if (stats.isSymbolicLink()) {
          ignoredPaths.add(relative);
          continue;
        }
        if (isIgnoredPath(relative, stats.isDirectory(), ignores)) {
          ignoredPaths.add(relative);
          continue;
        }
        if (stats.isDirectory()) {
          directories.push(relative);
          if (directories.length > maxDirectories) throw new InventoryLimitError("Directory limit exceeded");
          await visit(absolute, relative);
        } else if (stats.isFile()) {
          files.push(relative);
          if (files.length > maxFiles) throw new InventoryLimitError("File limit exceeded");
        }
      }
    };
    await visit(canonicalRoot, "");
    files.sort();
    directories.sort();
    const project = await detectProject(canonicalRoot, files);
    const roots = directories.filter((directory) => ["src", "app", "packages", "libs", "test", "tests", "e2e"].includes(path.posix.basename(directory)));
    const sourceRoots = roots.filter((directory) => !["test", "tests", "e2e"].includes(path.posix.basename(directory)));
    const testRoots = roots.filter((directory) => ["test", "tests", "e2e"].includes(path.posix.basename(directory)));
    const layerDirectories = new Map<string, Set<string>>([
      ["frontend", new Set()], ["api", new Set()], ["service", new Set()], ["persistence", new Set()], ["shared", new Set()],
    ]);
    for (const directory of directories) {
      const lower = directory.toLowerCase();
      const layer = lower.match(/(?:^|\/)(?:frontend|client|web|ui)(?:\/|$)/) ? "frontend"
        : lower.match(/(?:^|\/)(?:api|routes|controllers)(?:\/|$)/) ? "api"
          : lower.match(/(?:^|\/)(?:services|domain)(?:\/|$)/) ? "service"
            : lower.match(/(?:^|\/)(?:database|db|repository|repositories|persistence|models)(?:\/|$)/) ? "persistence" : "shared";
      layerDirectories.get(layer)?.add(directory);
    }
    const layers = [...layerDirectories.entries()].map(([name, paths]) => ({ name: name as "frontend" | "api" | "service" | "persistence" | "shared", directories: [...paths].sort() }));
    return repositoryInventorySchema.parse({
      root: canonicalRoot,
      files,
      languages: project.languages,
      frameworks: project.frameworks,
      sourceRoots,
      testRoots,
      ignoredPaths: [...ignoredPaths].sort(),
      layers,
      isMonorepo: project.isMonorepo,
    });
  }
}