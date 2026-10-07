'use strict';
// Task 5: ask the JEV system model (Vercel AI Gateway, same config as tools/jev-ai/jev-ai-mcp-server.js)
// which catalog model should run a task, and store the answer in task.jevRecommendation.
const fs = require('fs');
const path = require('path');
const { loadFolders, folderTasks, findTask, writeJson } = require('../lib/common');
const catalog = require('../model-catalog.json');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

function loadEnvFile(file) {
  try {
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* optional */ }
}
loadEnvFile(path.join(REPO_ROOT, '.env.local'));
loadEnvFile(path.join(REPO_ROOT, '.env'));

const API_URL = process.env.JEV_AI_URL || 'https://ai-gateway.vercel.sh/v1/chat/completions';
const GATEWAY_MODEL = process.env.JEV_AI_MODEL || 'anthropic/claude-sonnet-4';
const IDS = catalog.models.map((m) => m.id);

function buildPrompt(task) {
  const models = catalog.models.map((m) => `${m.id} (grade ${m.grade}, $${m.inputPerM}/${m.outputPerM} per 1M)`).join('\n');
  return [
    'Pick the single cheapest model that can still complete this task reliably. Prefer js-script when the work is purely mechanical.',
    `Allowed model ids:\n${models}`,
    `Task: ${JSON.stringify({ id: task.id, name: task.name, priority: task.priority, estimatedHours: task.estimatedHours, tags: task.tags, deliverables: task.deliverables })}`,
    'Reply with ONLY a JSON object: {"model":"<allowed id>","confidence":<0..1>,"reason":"<one sentence>"}',
  ].join('\n\n');
}

async function askJev(task) {
  const key = process.env.AI_GATEWAY_API_KEY;
  if (!key) throw new Error('AI_GATEWAY_API_KEY is not set (env or gitignored .env.local); refusing to fabricate a Jev answer');
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: GATEWAY_MODEL, messages: [{ role: 'user', content: buildPrompt(task) }], max_tokens: 300 }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Gateway ${res.status}: ${body.slice(0, 300)}`);
  const text = JSON.parse(body).choices?.[0]?.message?.content ?? '';
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error(`Jev reply was not JSON: ${text.slice(0, 200)}`);
  const parsed = JSON.parse(m[0]);
  if (!IDS.includes(parsed.model)) throw new Error(`Jev returned unknown model "${parsed.model}"`);
  const confidence = Number(parsed.confidence);
  return {
    model: parsed.model,
    confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : null,
    reason: String(parsed.reason || ''),
    gatewayModel: GATEWAY_MODEL,
    queriedAt: new Date().toISOString(),
    agreesWithFirstChoice: task.modelAssignment ? task.modelAssignment.firstChoice === parsed.model : null,
  };
}

async function run(args) {
  const folders = loadFolders();
  let targets;
  if (args._[0]) {
    const hit = findTask(folders, args._[0]);
    if (!hit) throw new Error(`Task ${args._[0]} not found`);
    targets = [hit];
  } else {
    targets = [...folders.values()].flatMap((f) => folderTasks(f).map((x) => ({ ...x, folder: f })));
    if (args.folder) targets = targets.filter((x) => x.folder.name === args.folder);
    if (!args.refresh) targets = targets.filter((x) => !x.task.jevRecommendation);
    if (args.limit) targets = targets.slice(0, Number(args.limit));
  }
  if (args['dry-run']) {
    for (const x of targets.slice(0, 1)) console.log(buildPrompt(x.task));
    console.log(`(dry run: ${targets.length} task(s) would be queried; nothing sent)`);
    return;
  }
  if (args.response) {
    // Store an answer obtained elsewhere (e.g. the jev-ai MCP tool ask_jev_ai) without calling the gateway.
    if (targets.length !== 1) throw new Error('--response needs exactly one task id');
    const parsed = JSON.parse(args.response);
    if (!IDS.includes(parsed.model)) throw new Error(`Unknown model "${parsed.model}"`);
    const t = targets[0].task;
    t.jevRecommendation = { model: parsed.model, confidence: Number(parsed.confidence) || null, reason: String(parsed.reason || ''), gatewayModel: parsed.gatewayModel || 'mcp:jev-ai', queriedAt: new Date().toISOString(), agreesWithFirstChoice: t.modelAssignment ? t.modelAssignment.firstChoice === parsed.model : null };
    writeJson(targets[0].file.file, targets[0].file.data);
    console.log(JSON.stringify(t.jevRecommendation, null, 2));
    return;
  }
  const touched = new Set();
  for (const x of targets) {
    try {
      x.task.jevRecommendation = await askJev(x.task);
      touched.add(x.file);
      console.log(`${x.task.id}: jev -> ${x.task.jevRecommendation.model} (${x.task.jevRecommendation.confidence})`);
    } catch (e) {
      console.error(`${x.task.id}: ${e.message}`);
      if (/not set|Gateway 401|Gateway 403/.test(e.message)) break;
    }
  }
  for (const f of touched) writeJson(f.file, f.data);
}

module.exports = { run, buildPrompt, askJev };

if (require.main === module) {
  const { parseArgs } = require('../lib/common');
  run(parseArgs(process.argv.slice(2))).catch((e) => { console.error(e.message); process.exit(1); });
}
