"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const promises_1 = require("node:fs/promises");
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const node_test_1 = __importDefault(require("node:test"));
const repository_inventory_1 = require("../src/repository/repository-inventory");
(0, node_test_1.default)("detects TypeScript Angular and monorepo metadata while excluding generated paths", async () => {
    const root = await (0, promises_1.mkdtemp)(node_path_1.default.join(node_os_1.default.tmpdir(), "native-inventory-"));
    try {
        await (0, promises_1.mkdir)(node_path_1.default.join(root, "src", "app"), { recursive: true });
        await (0, promises_1.mkdir)(node_path_1.default.join(root, "node_modules", "hidden"), { recursive: true });
        await (0, promises_1.writeFile)(node_path_1.default.join(root, "package.json"), JSON.stringify({ workspaces: ["packages/*"], dependencies: { "@angular/core": "19" } }));
        await (0, promises_1.writeFile)(node_path_1.default.join(root, "angular.json"), "{}");
        await (0, promises_1.writeFile)(node_path_1.default.join(root, "src", "app", "main.ts"), "export const value = 1;");
        await (0, promises_1.writeFile)(node_path_1.default.join(root, "node_modules", "hidden", "index.js"), "secret");
        const inventory = await new repository_inventory_1.LocalRepositoryInventory().inventory(root);
        strict_1.default.equal(inventory.isMonorepo, true);
        strict_1.default.deepEqual(inventory.languages, ["TypeScript"]);
        strict_1.default.ok(inventory.frameworks.some((framework) => framework.name === "Angular"));
        strict_1.default.ok(!inventory.files.some((file) => file.includes("node_modules")));
        strict_1.default.ok(inventory.sourceRoots.includes("src"));
    }
    finally {
        await (0, promises_1.rm)(root, { recursive: true, force: true });
    }
});
(0, node_test_1.default)("does not traverse symlinks and enforces configured directory limits", async () => {
    const root = await (0, promises_1.mkdtemp)(node_path_1.default.join(node_os_1.default.tmpdir(), "native-inventory-"));
    const outside = await (0, promises_1.mkdtemp)(node_path_1.default.join(node_os_1.default.tmpdir(), "native-outside-"));
    try {
        await (0, promises_1.writeFile)(node_path_1.default.join(outside, "outside.ts"), "const outside = true;");
        await (0, promises_1.symlink)(outside, node_path_1.default.join(root, "linked"), "junction");
        const inventory = await new repository_inventory_1.LocalRepositoryInventory().inventory(root);
        strict_1.default.ok(!inventory.files.some((file) => file.includes("outside")));
        await (0, promises_1.mkdir)(node_path_1.default.join(root, "a"));
        await strict_1.default.rejects(new repository_inventory_1.LocalRepositoryInventory().inventory(root, { maxDirectories: 0 }), /Directory limit exceeded/);
    }
    finally {
        await (0, promises_1.rm)(root, { recursive: true, force: true });
        await (0, promises_1.rm)(outside, { recursive: true, force: true });
    }
});
