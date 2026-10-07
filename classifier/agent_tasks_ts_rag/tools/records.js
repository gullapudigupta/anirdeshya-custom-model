#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { ROOT, parseArgs, readJson, writeJson } = require('./lib/common');

const CHUNK_SIZE = 50;
const TYPES = {
  bug: { directory: 'bugs', plural: 'bugs', prefix: 'BUG', label: 'bug' },
  cr: { directory: 'crs', plural: 'crs', prefix: 'CR', label: 'change request' },
};
const PRIORITIES = new Set(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']);
const STATUSES = new Set(['OPEN', 'IN_PROGRESS', 'BLOCKED', 'RESOLVED', 'CLOSED']);

function fail(message) {
  throw new Error(message);
}

function requiredString(args, key, optionName) {
  const value = args[key];
  if (typeof value !== 'string' || !value.trim()) {
    fail(`Missing required --${optionName} value.`);
  }
  return value.trim();
}

function typeConfig(type) {
  const config = TYPES[type];
  if (!config) fail(`Unknown record type '${type}'. Use 'bug' or 'cr'.`);
  return config;
}

function masterPath(root, config) {
  return path.join(root, config.directory, `${config.plural}.json`);
}

function loadMaster(root, config) {
  const file = masterPath(root, config);
  if (!fs.existsSync(file)) {
    fail(`Master file not found: ${file}`);
  }
  const master = readJson(file);
  if (master.recordType !== config.label || master.chunkSize !== CHUNK_SIZE || !Array.isArray(master.chunks)) {
    fail(`Invalid master file structure: ${file}`);
  }
  return { file, master };
}

function loadChunks(root, config, master) {
  const directory = path.join(root, config.directory);
  const chunks = master.chunks.map((entry, index) => {
    if (!entry || typeof entry.file !== 'string' || path.basename(entry.file) !== entry.file || !entry.file.endsWith('.json')) {
      fail(`Invalid chunk file entry at index ${index} in ${config.plural}.json.`);
    }
    const file = path.join(directory, entry.file);
    const data = readJson(file);
    if (data.recordType !== config.label || !Array.isArray(data.records)) {
      fail(`Invalid chunk structure: ${file}`);
    }
    if (data.records.length > CHUNK_SIZE || data.records.length === 0) {
      fail(`Chunk must contain between 1 and ${CHUNK_SIZE} records: ${file}`);
    }
    if (index < master.chunks.length - 1 && data.records.length !== CHUNK_SIZE) {
      fail(`Only the last chunk may contain fewer than ${CHUNK_SIZE} records: ${file}`);
    }
    return { entry, file, data };
  });

  const total = chunks.reduce((count, chunk) => count + chunk.data.records.length, 0);
  if (total !== master.totalRecords) {
    fail(`Master record count (${master.totalRecords}) does not match chunk total (${total}).`);
  }
  const ids = new Set();
  for (const chunk of chunks) {
    for (const record of chunk.data.records) {
      if (!record || typeof record.id !== 'string' || ids.has(record.id)) {
        fail(`Missing or duplicate record ID in ${chunk.file}.`);
      }
      ids.add(record.id);
    }
  }
  return chunks;
}

function chunkMetadata(config, index, records, fileName) {
  return {
    chunkId: `${config.plural}-chunk-${index + 1}`,
    file: fileName,
    recordCount: records.length,
    firstRecordId: records[0].id,
    lastRecordId: records[records.length - 1].id,
  };
}

function saveMaster(masterFile, master, chunks, config, now) {
  master.chunks = chunks.map((chunk, index) =>
    chunkMetadata(config, index, chunk.data.records, path.basename(chunk.file)),
  );
  master.totalRecords = chunks.reduce((count, chunk) => count + chunk.data.records.length, 0);
  master.updatedAt = now;
  writeJson(masterFile, master);
}

function locateRecord(chunks, id) {
  for (const chunk of chunks) {
    const record = chunk.data.records.find((item) => item.id === id);
    if (record) return { chunk, record };
  }
  fail(`Record '${id}' was not found.`);
}

function addRecord(root, type, args) {
  const config = typeConfig(type);
  const { file: masterFile, master } = loadMaster(root, config);
  const chunks = loadChunks(root, config, master);
  const existingNumbers = chunks.flatMap((chunk) =>
    chunk.data.records.map((record) => {
      const match = new RegExp(`^${config.prefix}-(\\d+)$`).exec(record.id);
      if (!match) fail(`Unexpected record ID '${record.id}' in ${chunk.file}.`);
      return Number(match[1]);
    }),
  );
  const number = existingNumbers.length ? Math.max(...existingNumbers) + 1 : 1;
  const id = `${config.prefix}-${number}`;
  const title = requiredString(args, 'title', 'title');
  const description = requiredString(args, 'description', 'description');
  const previousTaskReference = requiredString(args, 'previous-task', 'previous-task');
  const priority = String(args.priority || 'MEDIUM').toUpperCase();
  if (!PRIORITIES.has(priority)) fail(`Invalid priority '${priority}'. Use ${[...PRIORITIES].join(', ')}.`);

  const now = new Date().toISOString();
  const record = {
    id,
    number,
    name: title,
    description,
    previousTaskReference,
    status: 'OPEN',
    priority,
    createdOn: now,
    updatedOn: now,
    comments: [],
  };
  let chunk = chunks[chunks.length - 1];
  if (!chunk || chunk.data.records.length === CHUNK_SIZE) {
    const fileName = `${config.plural}_chunk_${chunks.length + 1}.json`;
    const file = path.join(root, config.directory, fileName);
    if (fs.existsSync(file)) fail(`Refusing to overwrite an unindexed chunk file: ${file}`);
    chunk = {
      file,
      data: {
        recordType: config.label,
        chunkId: `${config.plural}-chunk-${chunks.length + 1}`,
        records: [],
      },
    };
    chunks.push(chunk);
  }
  chunk.data.records.push(record);
  writeJson(chunk.file, chunk.data);
  master.createdAt = master.createdAt || now;
  saveMaster(masterFile, master, chunks, config, now);
  return record;
}

function updateRecord(root, type, id, args) {
  const config = typeConfig(type);
  const { file: masterFile, master } = loadMaster(root, config);
  const chunks = loadChunks(root, config, master);
  const { chunk, record } = locateRecord(chunks, id);
  let changed = false;

  if (args.title !== undefined) {
    record.name = requiredString(args, 'title', 'title');
    changed = true;
  }
  if (args.description !== undefined) {
    record.description = requiredString(args, 'description', 'description');
    changed = true;
  }
  if (args['previous-task'] !== undefined) {
    record.previousTaskReference = requiredString(args, 'previous-task', 'previous-task');
    changed = true;
  }
  if (args.priority !== undefined) {
    const priority = String(args.priority).toUpperCase();
    if (!PRIORITIES.has(priority)) fail(`Invalid priority '${priority}'. Use ${[...PRIORITIES].join(', ')}.`);
    record.priority = priority;
    changed = true;
  }
  if (args.status !== undefined) {
    const status = String(args.status).toUpperCase();
    if (!STATUSES.has(status)) fail(`Invalid status '${status}'. Use ${[...STATUSES].join(', ')}.`);
    record.status = status;
    changed = true;
  }
  if (!changed) fail('Provide at least one of --title, --description, --previous-task, --priority, or --status.');

  const now = new Date().toISOString();
  record.updatedOn = now;
  writeJson(chunk.file, chunk.data);
  saveMaster(masterFile, master, chunks, config, now);
  return record;
}

function addComment(root, type, id, args) {
  const config = typeConfig(type);
  const { file: masterFile, master } = loadMaster(root, config);
  const chunks = loadChunks(root, config, master);
  const { chunk, record } = locateRecord(chunks, id);
  const text = requiredString(args, 'text', 'text');
  if (record.comments === undefined) record.comments = [];
  if (!Array.isArray(record.comments)) fail(`Comments must be an array on record '${id}'.`);
  const number = record.comments.length + 1;
  const comment = {
    id: `${id}-C${number}`,
    text,
    createdAt: new Date().toISOString(),
    replies: [],
  };
  if (typeof args.author === 'string' && args.author.trim()) comment.author = args.author.trim();
  record.comments.push(comment);
  const now = new Date().toISOString();
  record.updatedOn = now;
  writeJson(chunk.file, chunk.data);
  saveMaster(masterFile, master, chunks, config, now);
  return comment;
}

function addReply(root, type, id, commentId, args) {
  const config = typeConfig(type);
  const { file: masterFile, master } = loadMaster(root, config);
  const chunks = loadChunks(root, config, master);
  const { chunk, record } = locateRecord(chunks, id);
  const comments = record.comments === undefined ? [] : record.comments;
  if (!Array.isArray(comments)) fail(`Comments must be an array on record '${id}'.`);
  const comment = comments.find((item) => item.id === commentId);
  if (!comment) fail(`Comment '${commentId}' was not found on record '${id}'.`);
  if (!Array.isArray(comment.replies)) fail(`Replies must be an array on comment '${commentId}'.`);
  const text = requiredString(args, 'text', 'text');
  const reply = {
    id: `${commentId}-R${comment.replies.length + 1}`,
    text,
    createdAt: new Date().toISOString(),
  };
  if (typeof args.author === 'string' && args.author.trim()) reply.author = args.author.trim();
  comment.replies.push(reply);
  const now = new Date().toISOString();
  record.updatedOn = now;
  writeJson(chunk.file, chunk.data);
  saveMaster(masterFile, master, chunks, config, now);
  return reply;
}

function usage() {
  return [
    'Usage:',
    '  node tools/records.js add <bug|cr> --title <text> --description <text> --previous-task <task-id> [--priority CRITICAL|HIGH|MEDIUM|LOW]',
    '  node tools/records.js update <bug|cr> <id> [--title <text>] [--description <text>] [--previous-task <task-id>] [--priority <priority>] [--status OPEN|IN_PROGRESS|BLOCKED|RESOLVED|CLOSED]',
    '  node tools/records.js comment <bug|cr> <id> --text <text> [--author <name>]',
    '  node tools/records.js reply <bug|cr> <id> <comment-id> --text <text> [--author <name>]',
  ].join('\n');
}

function run(args, root = ROOT) {
  const [command, type, id, commentId] = args._;
  if (command === 'add') return addRecord(root, type, args);
  if (command === 'update') {
    if (!id) fail(usage());
    return updateRecord(root, type, id, args);
  }
  if (command === 'comment') {
    if (!id) fail(usage());
    return addComment(root, type, id, args);
  }
  if (command === 'reply') {
    if (!id || !commentId) fail(usage());
    return addReply(root, type, id, commentId, args);
  }
  fail(usage());
}

if (require.main === module) {
  try {
    const result = run(parseArgs(process.argv.slice(2)));
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { run };
