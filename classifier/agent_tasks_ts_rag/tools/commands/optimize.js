'use strict';
// Tasks 2, 3 (placeholder), 4, 5 (placeholder): assign equal-grade first-choice models, classify cost bands,
// order tasks scaffold -> critical-logic -> follow-up (dependency-safe), and add the new per-task properties.
const fs = require('fs');
const path = require('path');
const { ROOT, PRIORITY_RANK, loadFolders, folderTasks, writeJson } = require('../lib/common');
const catalog = require('../model-catalog.json');

const MODELS = Object.fromEntries(catalog.models.map((m) => [m.id, m]));
// Prices from task-template.json, used only to compute the "before" baseline.
const LEGACY = {
  'deepseek-v4-flash': [0.14, 0.28], 'gpt-4o-mini': [0.15, 0.6], 'claude-haiku-4': [1, 5], 'o1-mini': [3, 12],
  'gpt-4.1': [2, 8], 'deepseek-r1': [8, 32], 'claude-opus-5': [4, 20],
};
const BAND_ORDER = ['scaffold', 'critical-logic', 'followup'];

const RX = {
  sec: /security|\bauth|permission|rbac|\bmfa\b|encrypt|secret|credential|deny-by-default|rate.?limit|csrf|xss|injection|audit|step-up|\brole|\bsr\d+/,
  money: /ledger|wallet|idempot|atomic|refund|reconcil|transaction|\bssv\b|balance|payout|spend|fraud|anti-abuse|double-?(spend|grant)|\bgrant\b/,
  secCore: /permission|secret|credential|deny-by-default|\bmfa\b|encrypt|rbac|step-up|server-only/,
  arch: /architecture|engine|foundation|\bcore\b|shell|resolver|substrate|framework/,
  scaffoldName: /^(create|add|define|set ?up|scaffold|configure|init|initialize|register|seed|declare|provision|stub|publish)\b/,
  scriptableName: /^(create|define|publish)\b.*\b(collection|singleton|schema|folder|readme|file|manifest)\b/,
  notScriptable: /service|\bui\b|flow|crud|validat|sdk|engine|module|enforce/,
  scriptableTarget: /collection|folder|director|\bfile\b|readme|\.json|\.txt|constants|schema|template|manifest|stub|enum/,
  logicWord: /guard|protect|limit|ceiling|screening|safety|consent|kill-switch|quota|expir|reminder|rollout|\bgate\b|snapshot|back-?fill|provenance|governance|validat|enforce|verify|flow|handle|comput|calculat|reconcil|test|algorithm|rule|policy|logic|sync|cache|retry|permission|rate/,
  ui: /screen|\bui\b|widget|\bface|theme|\bpage\b|dashboard|\bview\b|button|animation|flutter|layout|banner|modal|sheet/,
  docsTests: /\btest|\bdoc|readme|report|runbook|checklist|cleanup|changelog|spec\b/,
};

function textOf(t) {
  return [t.name, (t.tags || []).join(' '), (t.deliverables || []).join(' ')].join(' ').toLowerCase();
}

function classify(t) {
  const text = textOf(t);
  const name = String(t.name || '').toLowerCase();
  const sec = RX.sec.test(text);
  const money = RX.money.test(text);
  const logic = RX.logicWord.test(text);
  const scaffoldName = RX.scaffoldName.test(name);
  const scriptable = RX.scriptableName.test(name) && !RX.notScriptable.test(name) && !logic && !sec && !money && t.priority !== 'CRITICAL' && (t.estimatedHours || 0) <= 10;
  if (scriptable) return 'scripted';
  if (t.priority === 'CRITICAL' && sec && RX.secCore.test(text) && (t.value || 0) >= 95) return 'critical-security-core';
  if (t.priority === 'CRITICAL' && sec) return 'critical-security';
  if (t.priority === 'CRITICAL' && money) return 'critical-money';
  if (t.priority === 'CRITICAL' && RX.arch.test(text)) return 'critical-architecture';
  if (scaffoldName && !logic && !sec && !money) return 'scaffold';
  if (t.priority === 'CRITICAL' || ((sec || money) && t.priority === 'HIGH')) return 'logic-reasoning';
  if (RX.docsTests.test(name)) return 'followup-docs-tests';
  if (RX.ui.test(text)) return 'followup-ui';
  return 'followup-backend';
}
function cost(modelId, hours) {
  const m = MODELS[modelId];
  const mTokens = (hours * 100000) / 1e6;
  return mTokens * (0.7 * m.inputPerM + 0.3 * m.outputPerM);
}

function legacyCost(modelId, hours) {
  const p = LEGACY[modelId] || LEGACY['gpt-4.1'];
  return ((hours * 100000) / 1e6) * (0.7 * p[0] + 0.3 * p[1]);
}

function orderFolder(items) {
  const byId = new Map(items.map((x, i) => [x.task.id, { ...x, idx: i }]));
  const remaining = new Set(byId.keys());
  const done = new Set();
  const result = [];
  let band = BAND_ORDER[0];
  let batch = 0;
  let lastBand = null;
  const ready = () => [...remaining].map((id) => byId.get(id)).filter((x) => (x.task.dependencies || []).every((d) => done.has(d) || !byId.has(d)));
  const rank = (x) => [PRIORITY_RANK[x.task.priority] ?? 9, -(x.task.value || 0), x.idx];
  while (remaining.size) {
    let cands = ready();
    let cycleBroken = false;
    if (!cands.length) {
      cands = [...remaining].map((id) => byId.get(id)).sort((a, b) => a.idx - b.idx).slice(0, 1);
      cycleBroken = true;
    }
    let pool = cands.filter((x) => x.band === band);
    if (!pool.length) {
      const start = BAND_ORDER.indexOf(band);
      for (let k = 1; k <= BAND_ORDER.length; k++) {
        const b = BAND_ORDER[(start + k) % BAND_ORDER.length];
        pool = cands.filter((x) => x.band === b);
        if (pool.length) { band = b; break; }
      }
    }
    pool.sort((a, b) => { const ra = rank(a), rb = rank(b); return ra[0] - rb[0] || ra[1] - rb[1] || ra[2] - rb[2]; });
    const pick = pool[0];
    if (band !== lastBand) { batch++; lastBand = band; }
    result.push({ ...pick, order: result.length + 1, batch, cycleBroken });
    remaining.delete(pick.task.id);
    done.add(pick.task.id);
  }
  return result;
}

function run() {
  const folders = loadFolders();
  const summary = [];
  const md = ['# Cost-Optimized Execution Order (per spec folder)', '', 'Generated by `node tools/cli.js optimize`. Within each folder: **scaffold (free/cheap)** â†’ **critical logic (premium/mid)** â†’ **follow-up (cheap)**, repeating only when dependencies force it. Cross-spec order stays in [EXECUTION_ORDER.md](EXECUTION_ORDER.md).', ''];
  let before = 0, after = 0, flagship = 0;
  for (const folder of folders.values()) {
    const items = folderTasks(folder).map((x) => {
      const category = classify(x.task);
      return { ...x, category, band: catalog.categories[category].band };
    });
    if (!items.length) continue;
    const ordered = orderFolder(items);
    for (const o of ordered) {
      const t = o.task;
      const cat = catalog.categories[o.category];
      const prev = t.modelAssignment?.previous || { recommendedModel: t.recommendedModel, modelRationale: t.modelRationale };
      const alts = cat.equalGradeAlternatives;
      const models = [cat.firstChoice, ...alts].slice(0, 3);
      const hours = t.estimatedHours || 1;
      const newCost = cost(cat.firstChoice, hours);
      const oldCost = legacyCost(prev.recommendedModel?.[0], hours);
      before += oldCost; after += newCost; flagship += cost('gpt-5.4', hours);
      t.recommendedModel = models;
      t.modelRationale = `${cat.why} First choice ${cat.firstChoice}; equal-grade fallbacks ${alts.join(', ')}.`;
      t.modelAssignment = {
        source: 'docs/llm-model-comparison.md',
        category: o.category,
        grade: MODELS[cat.firstChoice].grade,
        costTier: cat.costTier,
        firstChoice: cat.firstChoice,
        equalGradeAlternatives: alts,
        previous: prev,
      };
      t.executionPlan = {
        order: o.order,
        batch: o.batch,
        band: o.band,
        scriptable: o.category === 'scripted',
        estimatedCostUsd: Number(newCost.toFixed(3)),
        ...(o.cycleBroken ? { cycleBroken: true } : {}),
      };
      if (!('executionResult' in t)) t.executionResult = null;
      if (!('jevRecommendation' in t)) t.jevRecommendation = null;
    }
    const planList = ordered.map((o) => ({ order: o.order, batch: o.batch, id: o.task.id, band: o.band, model: o.task.modelAssignment.firstChoice, file: path.basename(o.file.rel) }));
    const plan = { strategy: 'scaffold -> critical-logic -> followup, dependency-safe', generated: new Date().toISOString().slice(0, 10), batches: ordered[ordered.length - 1].batch, order: planList };
    if (folder.master) folder.master.data.executionPlan = plan;
    else for (const f of folder.files) f.data.executionPlan = plan;
    // physically order tasks inside each file by the plan
    for (const f of folder.files) if (Array.isArray(f.data.tasks)) f.data.tasks.sort((a, b) => a.executionPlan.order - b.executionPlan.order);
    for (const f of folder.files) writeJson(f.file, f.data);

    const counts = ordered.reduce((m, o) => ((m[o.band] = (m[o.band] || 0) + 1), m), {});
    summary.push({ folder: folder.name, tasks: ordered.length, ...counts });
    md.push(`## ${folder.name} (${ordered.length} tasks, ${plan.batches} batches)`, '', '| # | Batch | Task | Band | First-choice model | Priority |', '|---:|---:|---|---|---|---|');
    for (const o of ordered) md.push(`| ${o.order} | ${o.batch} | ${o.task.id} ${String(o.task.name).replace(/\|/g, '/')} | ${o.band} | ${o.task.modelAssignment.firstChoice} | ${o.task.priority} |`);
    md.push('');
  }
  md.splice(3, 0, `**Estimated model cost (planning estimate: hours Ã— 100k tokens, 70/30 in/out):** all tasks on gpt-5 â‰ˆ $${flagship.toFixed(0)} Â· previous per-task first choices â‰ˆ $${before.toFixed(0)} Â· this plan â‰ˆ $${after.toFixed(0)}.`, '');
  fs.writeFileSync(path.join(ROOT, 'COST_OPTIMIZED_EXECUTION_ORDER.md'), md.join('\n') + '\n', 'utf8');
  return { summary, before, after, flagship };
}

module.exports = { run, classify };

if (require.main === module) {
  const r = run();
  console.table(r.summary);
  console.log(`cost allGpt5=$${r.flagship.toFixed(0)} previous=$${r.before.toFixed(0)} plan=$${r.after.toFixed(0)}`);
}

