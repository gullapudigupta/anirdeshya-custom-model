import { readFile } from "node:fs/promises";
import path from "node:path";
import { isPathInside } from "../repository/ignore-policy";
import { listFiles, type FileSearchOptions } from "./file-search";

export interface TextSearchOptions extends FileSearchOptions {
  mode?: "exact" | "regex";
  maxFileBytes?: number;
  files?: string[];
}

export interface TextMatch {
  file: string;
  line: number;
  column: number;
  text: string;
  query: string;
}

export async function searchCode(root: string, query: string, options: TextSearchOptions = {}): Promise<TextMatch[]> {
  if (!query || query.length > 1_000) throw new Error("Search query must contain 1 to 1000 characters");
  let expression: RegExp;
  try { expression = options.mode === "regex" ? new RegExp(query, "i") : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"); }
  catch { throw new Error("Invalid regular expression"); }
  const files = options.files ?? await listFiles(root, { ...options, limit: options.limit ?? 1_000 });
  const matches: TextMatch[] = [];
  for (const file of files) {
    if (options.signal?.aborted) throw options.signal.reason ?? new Error("Search cancelled");
    const absolute = path.resolve(root, file);
    if (!isPathInside(path.resolve(root), absolute)) continue;
    let contents: Buffer;
    try { contents = await readFile(absolute); } catch { continue; }
    if (contents.length > (options.maxFileBytes ?? 2_000_000) || contents.includes(0)) continue;
    const lines = contents.toString("utf8").split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const match = expression.exec(lines[index]);
      if (!match) continue;
      matches.push({ file, line: index + 1, column: match.index + 1, text: lines[index].slice(0, 1_000), query });
      if (matches.length >= (options.limit ?? 100)) return matches;
    }
  }
  return matches;
}