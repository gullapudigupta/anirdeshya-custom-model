"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listFiles = listFiles;
const repository_inventory_1 = require("../repository/repository-inventory");
const ignore_policy_1 = require("../repository/ignore-policy");
async function listFiles(root, options = {}) {
    const inventory = await new repository_inventory_1.LocalRepositoryInventory().inventory(root, { signal: options.signal });
    const include = options.include ?? [];
    const exclude = options.exclude ?? [];
    const directory = options.directory?.replace(/\\/g, "/").replace(/\/$/, "");
    return inventory.files
        .filter((file) => !directory || file === directory || file.startsWith(`${directory}/`))
        .filter((file) => include.length === 0 || include.some((pattern) => (0, ignore_policy_1.matchesGlobPattern)(file, pattern)))
        .filter((file) => !exclude.some((pattern) => (0, ignore_policy_1.matchesGlobPattern)(file, pattern)))
        .slice(0, options.limit ?? 500);
}
