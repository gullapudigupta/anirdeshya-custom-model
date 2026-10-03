import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { defaultIgnorePatterns, isIgnoredPath, isPathInside, parseIgnoreFile } from "./ignore-policy";

export interface ReadFileOptions {
  startLine: number;
  endLine: number;
  maxLines?: number;
  maxBytes?: number;
  signal?: AbortSignal;
}

export interface ReadFileResult {
  file: string;
  startLine: number;
  endLine: number;
  text: string;
}

export async function readWorkspaceFile(root: string, relativeFile: string, options: ReadFileOptions): Promise<ReadFileResult> {
  const startLine = options.startLine;
  const endLine = options.endLine;
  const maxLines = options.maxLines ?? 200;
  if (!Number.isInteger(startLine) || !Number.isInteger(endLine) || startLine < 1 || endLine < startLine || endLine - startLine + 1 > maxLines) {
    throw new Error("File line range is invalid or exceeds the configured limit");
  }
  if (options.signal?.aborted) throw options.signal.reason ?? new Error("Read cancelled");
  const canonicalRoot = await realpath(root);
  const absolute = path.resolve(canonicalRoot, relativeFile);
  if (!isPathInside(canonicalRoot, absolute)) throw new Error("File path is outside the workspace");
  let ignorePatterns: string[] = [...defaultIgnorePatterns];
  try { ignorePatterns = [...ignorePatterns, ...parseIgnoreFile(await readFile(path.join(canonicalRoot, ".gitignore"), "utf8"))]; } catch { /* Optional metadata. */ }
  if (isIgnoredPath(path.relative(canonicalRoot, absolute), false, ignorePatterns)) throw new Error("File is ignored by repository policy");
  const stats = await lstat(absolute);
  if (stats.isSymbolicLink() || !stats.isFile()) throw new Error("Only regular workspace files can be read");
  const canonicalFile = await realpath(absolute);
  if (!isPathInside(canonicalRoot, canonicalFile)) throw new Error("Resolved file is outside the workspace");
  if (stats.size > (options.maxBytes ?? 2_000_000)) throw new Error("File exceeds the read size limit");
  const bytes = await readFile(canonicalFile);
  if (bytes.includes(0)) throw new Error("Binary files cannot be read as source evidence");
  const lines = bytes.toString("utf8").split(/\r?\n/);
  return { file: relativeFile.replace(/\\/g, "/"), startLine, endLine: Math.min(endLine, lines.length), text: lines.slice(startLine - 1, endLine).join("\n") };
}