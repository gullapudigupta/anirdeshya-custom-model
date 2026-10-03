import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

export const detectedProjectSchema = z.object({
  languages: z.array(z.string()),
  frameworks: z.array(z.object({ name: z.string(), version: z.string().optional() }).strict()),
  packageManagers: z.array(z.string()),
  isMonorepo: z.boolean(),
  metadataFiles: z.array(z.string()),
}).strict();

export type DetectedProject = z.infer<typeof detectedProjectSchema>;

async function readJson(root: string, file: string): Promise<Record<string, unknown> | undefined> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path.join(root, file), "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

export async function detectProject(root: string, files: readonly string[]): Promise<DetectedProject> {
  const fileSet = new Set(files.map((file) => file.replace(/\\/g, "/")));
  const metadataFiles = ["package.json", "tsconfig.json", "angular.json", "nx.json", "lerna.json", "pnpm-workspace.yaml", "package-lock.json", "yarn.lock", "pnpm-lock.yaml"]
    .filter((file) => fileSet.has(file));
  const packageJson = await readJson(root, "package.json");
  const dependencies = {
    ...((packageJson?.dependencies as Record<string, string> | undefined) ?? {}),
    ...((packageJson?.devDependencies as Record<string, string> | undefined) ?? {}),
  };
  const frameworks: DetectedProject["frameworks"] = [];
  const candidates: Array<[string, string]> = [
    ["Angular", "@angular/core"], ["NestJS", "@nestjs/core"], ["Express", "express"],
    ["Fastify", "fastify"], ["React", "react"], ["Vue", "vue"], ["Next.js", "next"],
  ];
  for (const [name, dependency] of candidates) {
    if (dependencies[dependency]) frameworks.push({ name, version: String(dependencies[dependency]) });
  }
  if (fileSet.has("angular.json") && !frameworks.some((entry) => entry.name === "Angular")) frameworks.push({ name: "Angular" });
  const languages = new Set<string>();
  for (const file of files) {
    const extension = path.extname(file).toLowerCase();
    if ([".ts", ".tsx", ".mts", ".cts"].includes(extension)) languages.add("TypeScript");
    if (extension === ".js" || extension === ".jsx" || extension === ".mjs" || extension === ".cjs") languages.add("JavaScript");
    if (extension === ".py") languages.add("Python");
    if (extension === ".java") languages.add("Java");
    if (extension === ".kt" || extension === ".kts") languages.add("Kotlin");
    if (extension === ".cs") languages.add("C#");
    if (extension === ".go") languages.add("Go");
    if (extension === ".rs") languages.add("Rust");
  }
  const packageManagers = [
    ["npm", "package-lock.json"], ["pnpm", "pnpm-lock.yaml"], ["yarn", "yarn.lock"], ["bun", "bun.lockb"],
  ].filter(([, file]) => fileSet.has(file as string)).map(([name]) => name as string);
  const workspaces = packageJson?.workspaces;
  const isMonorepo = fileSet.has("nx.json") || fileSet.has("lerna.json") || fileSet.has("pnpm-workspace.yaml") || Boolean(workspaces);
  return detectedProjectSchema.parse({ languages: [...languages].sort(), frameworks, packageManagers, isMonorepo, metadataFiles });
}