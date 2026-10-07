'use strict';
// Task 3: record which model executed a task, its confidence and notes, then mark it COMPLETED.
const { loadFolders, findTask, writeJson } = require('../lib/common');
const catalog = require('../model-catalog.json');

const MODELS = Object.fromEntries(catalog.models.map((m) => [m.id, m]));

function completeTask(folders, id, opts) {
  const hit = findTask(folders, id);
  if (!hit) throw new Error(`Task ${id} not found`);
  const { task, file } = hit;
  const model = opts.model;
  if (!model) throw new Error('--model is required');
  if (!MODELS[model]) throw new Error(`Unknown model "${model}". Known: ${Object.keys(MODELS).join(', ')}`);
  const confidence = Number(opts.confidence);
  if (!(confidence >= 0 && confidence <= 1)) throw new Error('--confidence must be a number between 0 and 1');
  const pending = (task.dependencies || []).filter((d) => {
    const dep = findTask(folders, d);
    return dep && dep.task.status !== 'COMPLETED';
  });
  if (pending.length && !opts.force) throw new Error(`Dependencies not completed: ${pending.join(', ')} (use --force to override)`);
  const now = new Date().toISOString();
  task.status = 'COMPLETED';
  task.completedDate = now.slice(0, 10);
  if (opts.artifacts) task.artifacts = String(opts.artifacts).split(',').map((s) => s.trim()).filter(Boolean);
  const first = task.modelAssignment?.firstChoice;
  task.executionResult = {
    model,
    provider: MODELS[model].vendor,
    confidenceScore: confidence,
    executionNotes: opts.notes ? String(opts.notes) : '',
    usedFirstChoice: first ? first === model : null,
    executedAt: now,
  };
  writeJson(file.file, file.data);
  return task.executionResult;
}

module.exports = { completeTask };

if (require.main === module) {
  const { parseArgs } = require('../lib/common');
  const a = parseArgs(process.argv.slice(2));
  console.log(JSON.stringify(completeTask(loadFolders(), a._[0], a), null, 2));
}
