import path from "node:path";

export const defaultIgnorePatterns = ["node_modules/", "dist/", "coverage/", ".git/", ".test-dist/"] as const;

export function normalizeRelativePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "");
}

function globToRegExp(pattern: string): RegExp {
  const normalized = normalizeRelativePath(pattern).replace(/^\//, "");
  let expression = "^";
  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index];
    if (character === "*") {
      if (normalized[index + 1] === "*") {
        index += 1;
        expression += normalized[index + 1] === "/" ? "(?:.*/)?" : ".*";
        if (normalized[index + 1] === "/") index += 1;
      } else {
        expression += "[^/]*";
      }
    } else if (character === "?") {
      expression += "[^/]";
    } else {
      expression += character.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`${expression}(?:/.*)?$`, "i");
}

export function matchesGlobPattern(relativePath: string, pattern: string): boolean {
  const normalizedPattern = normalizeRelativePath(pattern);
  const normalizedPath = normalizeRelativePath(relativePath);
  const matcher = globToRegExp(normalizedPattern);
  return normalizedPattern.includes("/") ? matcher.test(normalizedPath) : normalizedPath.split("/").some((part) => matcher.test(part));
}

export function parseIgnoreFile(content: string): string[] {
  return content.split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#") && line !== "!");
}

export function isIgnoredPath(relativePath: string, isDirectory: boolean, patterns: readonly string[]): boolean {
  const normalized = normalizeRelativePath(relativePath);
  let ignored = false;
  for (const rawPattern of patterns) {
    const negated = rawPattern.startsWith("!");
    const pattern = negated ? rawPattern.slice(1) : rawPattern;
    const directoryOnly = pattern.endsWith("/");
    if (directoryOnly && !isDirectory && !normalized.includes("/")) continue;
    const matches = matchesGlobPattern(normalized, pattern);
    if (matches) ignored = !negated;
  }
  return ignored;
}

export function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}