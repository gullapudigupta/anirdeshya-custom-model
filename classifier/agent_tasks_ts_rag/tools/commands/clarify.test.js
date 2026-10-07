'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { loadFolders, readJson } = require('../lib/common');
const { recordClarification } = require('./clarify');

function withTask(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-clarify-'));
  const folder = path.join(root, 'coins');
  fs.mkdirSync(folder);
  const file = path.join(folder, 'tasks.json');
  fs.writeFileSync(file, JSON.stringify({ tasks: [{ id: 'COIN-1', userClarifications: [] }] }));
  try {
    run({ file, folders: loadFolders(root) });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('records a clarification on the matching task and persists it', () => {
  withTask(({ file, folders }) => {
    const result = recordClarification(folders, 'COIN-1', {
      question: 'What is the spend order?',
      answer: 'Free, then promo, then paid.',
    });

    assert.deepEqual(result, {
      question: 'What is the spend order?',
      answer: 'Free, then promo, then paid.',
      status: 'confirmed',
    });
    assert.deepEqual(readJson(file).tasks[0].userClarifications, [result]);
  });
});

test('updates the existing entry for the same question without duplicating it', () => {
  withTask(({ file, folders }) => {
    recordClarification(folders, 'COIN-1', {
      question: 'Which publisher IDs should be used?',
      answer: 'Waiting for IDs.',
      status: 'awaiting_user_input',
    });
    recordClarification(folders, 'COIN-1', {
      question: 'Which publisher IDs should be used?',
      answer: 'Publisher IDs supplied.',
    });

    const entries = readJson(file).tasks[0].userClarifications;
    assert.equal(entries.length, 1);
    assert.equal(entries[0].answer, 'Publisher IDs supplied.');
    assert.equal(entries[0].status, 'confirmed');
  });
});

test('records decisions already documented as policy without claiming user confirmation', () => {
  withTask(({ file, folders }) => {
    const result = recordClarification(folders, 'COIN-1', {
      question: 'How is experiment assignment handled?',
      answer: 'Voluntary self-selection; results are descriptive.',
      status: 'recorded_decision',
    });

    assert.equal(result.status, 'recorded_decision');
    assert.deepEqual(readJson(file).tasks[0].userClarifications, [result]);
  });
});

test('rejects missing questions, answers, and unknown tasks', () => {
  withTask(({ folders }) => {
    assert.throws(() => recordClarification(folders, 'COIN-1', { answer: 'Answer' }), /--question is required/);
    assert.throws(() => recordClarification(folders, 'COIN-1', { question: 'Question' }), /--answer is required/);
    assert.throws(
      () =>
        recordClarification(folders, 'COIN-404', {
          question: 'Question',
          answer: 'Answer',
        }),
      /Task COIN-404 not found/,
    );
  });
});
