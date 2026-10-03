import assert from "node:assert/strict";
import { mkdtemp, mkdir, symlink, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { LocalRepositoryInventory } from "../src/repository/repository-inventory";

test("detects TypeScript Angular and monorepo metadata while excluding generated paths", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "native-inventory-"));
  try {
    await mkdir(path.join(root, "src", "app"), { recursive: true });
    await mkdir(path.join(root, "node_modules", "hidden"), { recursive: true });
    await writeFile(path.join(root, "package.json"), JSON.stringify({ workspaces: ["packages/*"], dependencies: { "@angular/core": "19" } }));
    await writeFile(path.join(root, "angular.json"), "{}");
    await writeFile(path.join(root, "src", "app", "main.ts"), "export const value = 1;");
    await writeFile(path.join(root, "node_modules", "hidden", "index.js"), "secret");
    const inventory = await new LocalRepositoryInventory().inventory(root);
    assert.equal(inventory.isMonorepo, true);
    assert.deepEqual(inventory.languages, ["TypeScript"]);
    assert.ok(inventory.frameworks.some((framework) => framework.name === "Angular"));
    assert.ok(!inventory.files.some((file) => file.includes("node_modules")));
    assert.ok(inventory.sourceRoots.includes("src"));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("does not traverse symlinks and enforces configured directory limits", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "native-inventory-"));
  const outside = await mkdtemp(path.join(os.tmpdir(), "native-outside-"));
  try {
    await writeFile(path.join(outside, "outside.ts"), "const outside = true;");
    await symlink(outside, path.join(root, "linked"), "junction");
    const inventory = await new LocalRepositoryInventory().inventory(root);
    assert.ok(!inventory.files.some((file) => file.includes("outside")));
    await mkdir(path.join(root, "a"));
    await assert.rejects(new LocalRepositoryInventory().inventory(root, { maxDirectories: 0 }), /Directory limit exceeded/);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});