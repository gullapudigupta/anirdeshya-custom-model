"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.searchCode = searchCode;
const promises_1 = require("node:fs/promises");
const node_path_1 = __importDefault(require("node:path"));
const ignore_policy_1 = require("../repository/ignore-policy");
const file_search_1 = require("./file-search");
async function searchCode(root, query, options = {}) {
    if (!query || query.length > 1_000)
        throw new Error("Search query must contain 1 to 1000 characters");
    let expression;
    try {
        expression = options.mode === "regex" ? new RegExp(query, "i") : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    }
    catch {
        throw new Error("Invalid regular expression");
    }
    const files = options.files ?? await (0, file_search_1.listFiles)(root, { ...options, limit: options.limit ?? 1_000 });
    const matches = [];
    for (const file of files) {
        if (options.signal?.aborted)
            throw options.signal.reason ?? new Error("Search cancelled");
        const absolute = node_path_1.default.resolve(root, file);
        if (!(0, ignore_policy_1.isPathInside)(node_path_1.default.resolve(root), absolute))
            continue;
        let contents;
        try {
            contents = await (0, promises_1.readFile)(absolute);
        }
        catch {
            continue;
        }
        if (contents.length > (options.maxFileBytes ?? 2_000_000) || contents.includes(0))
            continue;
        const lines = contents.toString("utf8").split(/\r?\n/);
        for (let index = 0; index < lines.length; index += 1) {
            const match = expression.exec(lines[index]);
            if (!match)
                continue;
            matches.push({ file, line: index + 1, column: match.index + 1, text: lines[index].slice(0, 1_000), query });
            if (matches.length >= (options.limit ?? 100))
                return matches;
        }
    }
    return matches;
}
