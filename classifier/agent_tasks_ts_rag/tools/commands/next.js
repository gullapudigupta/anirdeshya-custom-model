'use strict';
// Helpers for running the plan: `next` shows what to execute now, `cost` summarizes spend by model/band.
const { loadFolders, folderTasks } = require('../lib/common');

function next(args) {
  const folders = loadFolders();
  const done = new Set();
  for (const f of folders.values()) for (const { task } of folderTasks(f)) if (task.status === 'COMPLETED') done.add(task.id);
  for (const f of folders.values()) {
    if (args.folder && f.name !== args.folder) continue;
    const pending = folderTasks(f).map((x) => x.task).filter((t) => t.status !== 'COMPLETED' && t.status !== 'CANCELLED').sort((a, b) => a.executionPlan.order - b.executionPlan.order);
    const ready = pending.filter((t) => (t.dependencies || []).every((d) => done.has(d) || !folders.has(d)));
    if (!pending.length) { console.log(`${f.name}: all done`); continue; }
    const first = pending[0];
    const sameBatch = ready.filter((t) => t.executionPlan.batch === first.executionPlan.batch);
    console.log(`${f.name}: batch ${first.executionPlan.batch} [${first.executionPlan.band}] model=${first.modelAssignment.firstChoice} -> ${sameBatch.map((t) => t.id).join(', ')}`);
  }
}

function cost() {
  const rows = {};
  for (const f of loadFolders().values()) {
    for (const { task } of folderTasks(f)) {
      const k = task.modelAssignment.firstChoice;
      rows[k] = rows[k] || { tasks: 0, hours: 0, estimatedUsd: 0 };
      rows[k].tasks++;
      rows[k].hours += task.estimatedHours || 0;
      rows[k].estimatedUsd = Number((rows[k].estimatedUsd + task.executionPlan.estimatedCostUsd).toFixed(2));
    }
  }
  console.table(rows);
}

module.exports = { next, cost };
