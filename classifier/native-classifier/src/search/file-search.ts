import { LocalRepositoryInventory } from "../repository/repository-inventory";
import { matchesGlobPattern } from "../repository/ignore-policy";

export interface FileSearchOptions {
  directory?: string;
  include?: string[];
  exclude?: string[];
  limit?: number;
  signal?: AbortSignal;
}

export async function listFiles(root: string, options: FileSearchOptions = {}): Promise<string[]> {
  const inventory = await new LocalRepositoryInventory().inventory(root, { signal: options.signal });
  const include = options.include ?? [];
  const exclude = options.exclude ?? [];
  const directory = options.directory?.replace(/\\/g, "/").replace(/\/$/, "");
  return inventory.files
    .filter((file) => !directory || file === directory || file.startsWith(`${directory}/`))
    .filter((file) => include.length === 0 || include.some((pattern) => matchesGlobPattern(file, pattern)))
    .filter((file) => !exclude.some((pattern) => matchesGlobPattern(file, pattern)))
    .slice(0, options.limit ?? 500);
}