"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.readWorkspaceFile = readWorkspaceFile;
const promises_1 = require("node:fs/promises");
const node_path_1 = __importDefault(require("node:path"));
const ignore_policy_1 = require("./ignore-policy");
async function readWorkspaceFile(root, relativeFile, options) {
    const startLine = options.startLine;
    const endLine = options.endLine;
    const maxLines = options.maxLines ?? 200;
    if (!Number.isInteger(startLine) || !Number.isInteger(endLine) || startLine < 1 || endLine < startLine || endLine - startLine + 1 > maxLines) {
        throw new Error("File line range is invalid or exceeds the configured limit");
    }
    if (options.signal?.aborted)
        throw options.signal.reason ?? new Error("Read cancelled");
    const canonicalRoot = await (0, promises_1.realpath)(root);
    const absolute = node_path_1.default.resolve(canonicalRoot, relativeFile);
    if (!(0, ignore_policy_1.isPathInside)(canonicalRoot, absolute))
        throw new Error("File path is outside the workspace");
    let ignorePatterns = [...ignore_policy_1.defaultIgnorePatterns];
    try {
        ignorePatterns = [...ignorePatterns, ...(0, ignore_policy_1.parseIgnoreFile)(await (0, promises_1.readFile)(node_path_1.default.join(canonicalRoot, ".gitignore"), "utf8"))];
    }
    catch { /* Optional metadata. */ }
    if ((0, ignore_policy_1.isIgnoredPath)(node_path_1.default.relative(canonicalRoot, absolute), false, ignorePatterns))
        throw new Error("File is ignored by repository policy");
    const stats = await (0, promises_1.lstat)(absolute);
    if (stats.isSymbolicLink() || !stats.isFile())
        throw new Error("Only regular workspace files can be read");
    const canonicalFile = await (0, promises_1.realpath)(absolute);
    if (!(0, ignore_policy_1.isPathInside)(canonicalRoot, canonicalFile))
        throw new Error("Resolved file is outside the workspace");
    if (stats.size > (options.maxBytes ?? 2_000_000))
        throw new Error("File exceeds the read size limit");
    const bytes = await (0, promises_1.readFile)(canonicalFile);
    if (bytes.includes(0))
        throw new Error("Binary files cannot be read as source evidence");
    const lines = bytes.toString("utf8").split(/\r?\n/);
    return { file: relativeFile.replace(/\\/g, "/"), startLine, endLine: Math.min(endLine, lines.length), text: lines.slice(startLine - 1, endLine).join("\n") };
}
