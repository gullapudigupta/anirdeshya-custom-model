"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.defaultIgnorePatterns = void 0;
exports.normalizeRelativePath = normalizeRelativePath;
exports.matchesGlobPattern = matchesGlobPattern;
exports.parseIgnoreFile = parseIgnoreFile;
exports.isIgnoredPath = isIgnoredPath;
exports.isPathInside = isPathInside;
const node_path_1 = __importDefault(require("node:path"));
exports.defaultIgnorePatterns = ["node_modules/", "dist/", "coverage/", ".git/", ".test-dist/"];
function normalizeRelativePath(value) {
    return value.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "");
}
function globToRegExp(pattern) {
    const normalized = normalizeRelativePath(pattern).replace(/^\//, "");
    let expression = "^";
    for (let index = 0; index < normalized.length; index += 1) {
        const character = normalized[index];
        if (character === "*") {
            if (normalized[index + 1] === "*") {
                index += 1;
                expression += normalized[index + 1] === "/" ? "(?:.*/)?" : ".*";
                if (normalized[index + 1] === "/")
                    index += 1;
            }
            else {
                expression += "[^/]*";
            }
        }
        else if (character === "?") {
            expression += "[^/]";
        }
        else {
            expression += character.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        }
    }
    return new RegExp(`${expression}(?:/.*)?$`, "i");
}
function matchesGlobPattern(relativePath, pattern) {
    const normalizedPattern = normalizeRelativePath(pattern);
    const normalizedPath = normalizeRelativePath(relativePath);
    const matcher = globToRegExp(normalizedPattern);
    return normalizedPattern.includes("/") ? matcher.test(normalizedPath) : normalizedPath.split("/").some((part) => matcher.test(part));
}
function parseIgnoreFile(content) {
    return content.split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith("#") && line !== "!");
}
function isIgnoredPath(relativePath, isDirectory, patterns) {
    const normalized = normalizeRelativePath(relativePath);
    let ignored = false;
    for (const rawPattern of patterns) {
        const negated = rawPattern.startsWith("!");
        const pattern = negated ? rawPattern.slice(1) : rawPattern;
        const directoryOnly = pattern.endsWith("/");
        if (directoryOnly && !isDirectory && !normalized.includes("/"))
            continue;
        const matches = matchesGlobPattern(normalized, pattern);
        if (matches)
            ignored = !negated;
    }
    return ignored;
}
function isPathInside(root, candidate) {
    const relative = node_path_1.default.relative(root, candidate);
    return relative === "" || (!relative.startsWith(`..${node_path_1.default.sep}`) && relative !== ".." && !node_path_1.default.isAbsolute(relative));
}
