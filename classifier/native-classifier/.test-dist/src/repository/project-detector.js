"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectedProjectSchema = void 0;
exports.detectProject = detectProject;
const promises_1 = require("node:fs/promises");
const node_path_1 = __importDefault(require("node:path"));
const zod_1 = require("zod");
exports.detectedProjectSchema = zod_1.z.object({
    languages: zod_1.z.array(zod_1.z.string()),
    frameworks: zod_1.z.array(zod_1.z.object({ name: zod_1.z.string(), version: zod_1.z.string().optional() }).strict()),
    packageManagers: zod_1.z.array(zod_1.z.string()),
    isMonorepo: zod_1.z.boolean(),
    metadataFiles: zod_1.z.array(zod_1.z.string()),
}).strict();
async function readJson(root, file) {
    try {
        const parsed = JSON.parse(await (0, promises_1.readFile)(node_path_1.default.join(root, file), "utf8"));
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : undefined;
    }
    catch {
        return undefined;
    }
}
async function detectProject(root, files) {
    const fileSet = new Set(files.map((file) => file.replace(/\\/g, "/")));
    const metadataFiles = ["package.json", "tsconfig.json", "angular.json", "nx.json", "lerna.json", "pnpm-workspace.yaml", "package-lock.json", "yarn.lock", "pnpm-lock.yaml"]
        .filter((file) => fileSet.has(file));
    const packageJson = await readJson(root, "package.json");
    const dependencies = {
        ...(packageJson?.dependencies ?? {}),
        ...(packageJson?.devDependencies ?? {}),
    };
    const frameworks = [];
    const candidates = [
        ["Angular", "@angular/core"], ["NestJS", "@nestjs/core"], ["Express", "express"],
        ["Fastify", "fastify"], ["React", "react"], ["Vue", "vue"], ["Next.js", "next"],
    ];
    for (const [name, dependency] of candidates) {
        if (dependencies[dependency])
            frameworks.push({ name, version: String(dependencies[dependency]) });
    }
    if (fileSet.has("angular.json") && !frameworks.some((entry) => entry.name === "Angular"))
        frameworks.push({ name: "Angular" });
    const languages = new Set();
    for (const file of files) {
        const extension = node_path_1.default.extname(file).toLowerCase();
        if ([".ts", ".tsx", ".mts", ".cts"].includes(extension))
            languages.add("TypeScript");
        if (extension === ".js" || extension === ".jsx" || extension === ".mjs" || extension === ".cjs")
            languages.add("JavaScript");
        if (extension === ".py")
            languages.add("Python");
        if (extension === ".java")
            languages.add("Java");
        if (extension === ".kt" || extension === ".kts")
            languages.add("Kotlin");
        if (extension === ".cs")
            languages.add("C#");
        if (extension === ".go")
            languages.add("Go");
        if (extension === ".rs")
            languages.add("Rust");
    }
    const packageManagers = [
        ["npm", "package-lock.json"], ["pnpm", "pnpm-lock.yaml"], ["yarn", "yarn.lock"], ["bun", "bun.lockb"],
    ].filter(([, file]) => fileSet.has(file)).map(([name]) => name);
    const workspaces = packageJson?.workspaces;
    const isMonorepo = fileSet.has("nx.json") || fileSet.has("lerna.json") || fileSet.has("pnpm-workspace.yaml") || Boolean(workspaces);
    return exports.detectedProjectSchema.parse({ languages: [...languages].sort(), frameworks, packageManagers, isMonorepo, metadataFiles });
}
