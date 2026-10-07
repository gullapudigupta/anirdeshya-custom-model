'use strict';
// Shared helpers for the task toolkit (no external dependencies).
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const SKIP_DIRS = new Set(['.agents', 'tools', 'node_modules', 'public']);
const PRIORITY_RANK = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function listJsonFiles(dir = ROOT) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) out.push(...listJsonFiles(p));
    } else if (e.name.endsWith('.json')) {
      out.push(p);
    }
  }
  return out.sort();
}

// Groups task files by their spec folder. A folder may hold chunks, a master and a migration file.
function loadFolders(root = ROOT) {
  const folders = new Map();
  for (const file of listJsonFiles(root)) {
    const data = readJson(file);
    const rel = path.relative(root, file);
    if (path.dirname(rel) === '.') continue;
    const folder = path.dirname(rel).split(path.sep)[0];
    if (!folders.has(folder)) folders.set(folder, { name: folder, files: [], master: null });
    const entry = folders.get(folder);
    const rec = { file, rel, data, isMaster: Array.isArray(data.chunks) && !Array.isArray(data.tasks) };
    entry.files.push(rec);
    if (rec.isMaster) entry.master = rec;
  }
  return folders;
}

function folderTasks(folder) {
  const tasks = [];
  for (const f of folder.files) {
    for (const t of f.data.tasks || []) tasks.push({ task: t, file: f });
  }
  return tasks;
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      if (v !== undefined) args[k] = v;
      else if (argv[i + 1] && !argv[i + 1].startsWith('--')) args[k] = argv[++i];
      else args[k] = true;
    } else args._.push(a);
  }
  return args;
}

function findTask(folders, id) {
  for (const folder of folders.values()) {
    for (const { task, file } of folderTasks(folder)) if (task.id === id) return { task, file, folder };
  }
  return null;
}

module.exports = { ROOT, PRIORITY_RANK, readJson, writeJson, listJsonFiles, loadFolders, folderTasks, parseArgs, findTask };
