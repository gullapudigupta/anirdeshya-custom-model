"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LocalRepositoryInventory = exports.InventoryLimitError = exports.repositoryInventorySchema = void 0;
const promises_1 = require("node:fs/promises");
const node_path_1 = __importDefault(require("node:path"));
const zod_1 = require("zod");
const ignore_policy_1 = require("./ignore-policy");
const project_detector_1 = require("./project-detector");
exports.repositoryInventorySchema = zod_1.z.object({
    root: zod_1.z.string(),
    files: zod_1.z.array(zod_1.z.string()),
    languages: zod_1.z.array(zod_1.z.string()),
    frameworks: zod_1.z.array(zod_1.z.object({ name: zod_1.z.string(), version: zod_1.z.string().optional() }).strict()),
    sourceRoots: zod_1.z.array(zod_1.z.string()),
    testRoots: zod_1.z.array(zod_1.z.string()),
    ignoredPaths: zod_1.z.array(zod_1.z.string()),
    layers: zod_1.z.array(zod_1.z.object({ name: zod_1.z.enum(["frontend", "api", "service", "persistence", "shared"]), directories: zod_1.z.array(zod_1.z.string()) }).strict()),
    isMonorepo: zod_1.z.boolean(),
}).strict();
class InventoryLimitError extends Error {
    constructor(message) { super(message); this.name = "InventoryLimitError"; }
}
exports.InventoryLimitError = InventoryLimitError;
class LocalRepositoryInventory {
    async inventory(root, options = {}) {
        const canonicalRoot = await (0, promises_1.realpath)(root);
        const rootStats = await (0, promises_1.lstat)(canonicalRoot);
        if (!rootStats.isDirectory())
            throw new Error("Workspace root must be a directory");
        const maxFiles = options.maxFiles ?? 20_000;
        const maxDirectories = options.maxDirectories ?? 5_000;
        const ignores = [...ignore_policy_1.defaultIgnorePatterns, ...(options.ignorePatterns ?? [])];
        const ignoreFile = node_path_1.default.join(canonicalRoot, ".gitignore");
        try {
            ignores.push(...(0, ignore_policy_1.parseIgnoreFile)(await (0, promises_1.readFile)(ignoreFile, "utf8")));
        }
        catch { /* Optional metadata. */ }
        const files = [];
        const directories = [];
        const ignoredPaths = new Set();
        const visit = async (absoluteDirectory, relativeDirectory) => {
            if (options.signal?.aborted)
                throw options.signal.reason ?? new Error("Inventory cancelled");
            const entries = await (0, promises_1.readdir)(absoluteDirectory, { withFileTypes: true });
            for (const entry of entries) {
                const relative = (0, ignore_policy_1.normalizeRelativePath)(node_path_1.default.join(relativeDirectory, entry.name));
                const absolute = node_path_1.default.join(absoluteDirectory, entry.name);
                if (!(0, ignore_policy_1.isPathInside)(canonicalRoot, absolute))
                    throw new Error("Resolved path escaped workspace root");
                const stats = await (0, promises_1.lstat)(absolute);
                if (stats.isSymbolicLink()) {
                    ignoredPaths.add(relative);
                    continue;
                }
                if ((0, ignore_policy_1.isIgnoredPath)(relative, stats.isDirectory(), ignores)) {
                    ignoredPaths.add(relative);
                    continue;
                }
                if (stats.isDirectory()) {
                    directories.push(relative);
                    if (directories.length > maxDirectories)
                        throw new InventoryLimitError("Directory limit exceeded");
                    await visit(absolute, relative);
                }
                else if (stats.isFile()) {
                    files.push(relative);
                    if (files.length > maxFiles)
                        throw new InventoryLimitError("File limit exceeded");
                }
            }
        };
        await visit(canonicalRoot, "");
        files.sort();
        directories.sort();
        const project = await (0, project_detector_1.detectProject)(canonicalRoot, files);
        const roots = directories.filter((directory) => ["src", "app", "packages", "libs", "test", "tests", "e2e"].includes(node_path_1.default.posix.basename(directory)));
        const sourceRoots = roots.filter((directory) => !["test", "tests", "e2e"].includes(node_path_1.default.posix.basename(directory)));
        const testRoots = roots.filter((directory) => ["test", "tests", "e2e"].includes(node_path_1.default.posix.basename(directory)));
        const layerDirectories = new Map([
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
        const layers = [...layerDirectories.entries()].map(([name, paths]) => ({ name: name, directories: [...paths].sort() }));
        return exports.repositoryInventorySchema.parse({
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
exports.LocalRepositoryInventory = LocalRepositoryInventory;
