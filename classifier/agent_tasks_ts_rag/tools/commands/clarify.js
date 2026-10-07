'use strict';
const { findTask, writeJson } = require('../lib/common');

const STATUSES = new Set(['confirmed', 'recorded_decision', 'awaiting_user_input']);

function recordClarification(folders, id, opts) {
  if (!id) throw new Error('Task ID is required');
  const hit = findTask(folders, id);
  if (!hit) throw new Error(`Task ${id} not found`);

  const question = String(opts.question || '').trim();
  const answer = String(opts.answer || '').trim();
  const status = opts.status || 'confirmed';
  if (!question) throw new Error('--question is required');
  if (!answer) throw new Error('--answer is required');
  if (!STATUSES.has(status)) {
    throw new Error(`--status must be one of: ${[...STATUSES].join(', ')}`);
  }

  const { task, file } = hit;
  if (task.userClarifications === undefined) task.userClarifications = [];
  if (!Array.isArray(task.userClarifications)) {
    throw new Error(`Task ${id} has an invalid userClarifications field`);
  }

  const clarification = { question, answer, status };
  const existingIndex = task.userClarifications.findIndex((entry) => entry.question === question);
  if (existingIndex === -1) task.userClarifications.push(clarification);
  else task.userClarifications[existingIndex] = clarification;

  writeJson(file.file, file.data);
  return clarification;
}

module.exports = { recordClarification };
