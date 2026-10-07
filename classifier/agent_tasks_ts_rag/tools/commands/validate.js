'use strict';
// Task 1 + final: validates every task file against the template rules.
// Profiles: "original" = task-template.json + phase10-documentation.json, "final" = task-template-final.json.
const fs = require('fs');
const path = require('path');
const { ROOT, loadFolders, readJson } = require('../lib/common');
const catalog = require('../model-catalog.json');

const ENUMS = {
  status: ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'BLOCKED', 'CANCELLED'],
  priority: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'],
};
const TASK_REQUIRED = [
  'id',
  'name',
  'status',
  'priority',
  'estimatedHours',
  'value',
  'recommendedModel',
  'modelRationale',
  'dependencies',
  'deliverables',
  'tags',
];
// Header fields used by phase10-documentation.json
const FILE_REQUIRED = [
  'name',
  'description',
  'priority',
  'status',
  'completionPercentage',
  'createdOn',
  'updatedOn',
  'tasks',
  'summary',
];
const SUMMARY_REQUIRED = ['total', 'completed', 'pending', 'totalEstimatedHours', 'averageValue'];
const FINAL_TASK_EXTRA = ['modelAssignment', 'executionPlan', 'executionResult', 'jevRecommendation'];
const CLARIFICATION_STATUSES = new Set(['confirmed', 'recorded_decision', 'awaiting_user_input']);
const LEGACY_MODELS = new Set([
  'deepseek-v4-flash',
  'gpt-4o-mini',
  'claude-haiku-4',
  'o1-mini',
  'gpt-4.1',
  'deepseek-r1',
  'claude-opus-5',
]);
const ID_FORMAT = /^P\d+-T\d+$/;

function issue(level, rule, message) {
  return { level, rule, message };
}

function validateTask(t, profile, knownModels) {
  const out = [];
  for (const k of TASK_REQUIRED) if (!(k in t)) out.push(issue('error', 'missing-field', `missing "${k}"`));
  if (typeof t.id === 'string' && !ID_FORMAT.test(t.id))
    out.push(
      issue(
        'warn',
        'id-format',
        `id "${t.id}" is not P{phase}-T{n} (phase10 uses its own prefix, so a spec prefix is tolerated)`,
      ),
    );
  if ('status' in t && !ENUMS.status.includes(t.status)) out.push(issue('error', 'enum', `status "${t.status}"`));
  if ('priority' in t && !ENUMS.priority.includes(t.priority))
    out.push(issue('error', 'enum', `priority "${t.priority}"`));
  if ('estimatedHours' in t && !(typeof t.estimatedHours === 'number' && t.estimatedHours >= 1))
    out.push(issue('error', 'range', 'estimatedHours must be a number >= 1'));
  if ('value' in t && !(typeof t.value === 'number' && t.value >= 0 && t.value <= 100))
    out.push(issue('error', 'range', 'value must be 0-100'));
  if (Array.isArray(t.recommendedModel)) {
    if (t.recommendedModel.length < 1 || t.recommendedModel.length > 3)
      out.push(
        issue(
          'error',
          'recommendedModel-size',
          `recommendedModel has ${t.recommendedModel.length} entries (template: 1-3)`,
        ),
      );
    for (const m of t.recommendedModel) {
      if (profile === 'final' ? !knownModels.has(m) : !LEGACY_MODELS.has(m))
        out.push(
          issue(
            'warn',
            'unknown-model',
            `model "${m}" not in ${profile === 'final' ? 'model catalog' : 'template modelPricing'}`,
          ),
        );
    }
  } else if ('recommendedModel' in t) out.push(issue('error', 'type', 'recommendedModel must be an array'));
  if ('dependencies' in t && !Array.isArray(t.dependencies))
    out.push(issue('error', 'type', 'dependencies must be an array'));
  if ('deliverables' in t && !(Array.isArray(t.deliverables) && t.deliverables.length >= 1))
    out.push(issue('error', 'deliverables', 'deliverables needs >= 1 item'));
  if ('tags' in t && !Array.isArray(t.tags)) out.push(issue('error', 'type', 'tags must be an array'));
  if ('userClarifications' in t) {
    if (!Array.isArray(t.userClarifications)) {
      out.push(issue('error', 'type', 'userClarifications must be an array'));
    } else {
      for (const [index, clarification] of t.userClarifications.entries()) {
        if (
          !clarification ||
          typeof clarification.question !== 'string' ||
          !clarification.question.trim() ||
          typeof clarification.answer !== 'string' ||
          !clarification.answer.trim() ||
          !CLARIFICATION_STATUSES.has(clarification.status)
        ) {
          out.push(
            issue(
              'error',
              'user-clarification',
              `userClarifications[${index}] requires a question, answer, and supported status`,
            ),
          );
        }
      }
    }
  }
  if (t.status === 'COMPLETED') {
    if (!t.completedDate) out.push(issue('warn', 'completed-date', 'COMPLETED task has no completedDate'));
    if (!Array.isArray(t.artifacts)) out.push(issue('warn', 'artifacts', 'COMPLETED task has no artifacts[]'));
  }
  if (profile === 'final') {
    for (const k of FINAL_TASK_EXTRA) if (!(k in t)) out.push(issue('error', 'missing-field', `missing "${k}"`));
    if (t.status === 'COMPLETED' && !t.executionResult)
      out.push(issue('error', 'execution-result', 'COMPLETED task must have executionResult'));
    if (t.executionResult) {
      const r = t.executionResult;
      if (!r.model) out.push(issue('error', 'execution-result', 'executionResult.model missing'));
      if (!(typeof r.confidenceScore === 'number' && r.confidenceScore >= 0 && r.confidenceScore <= 1))
        out.push(issue('error', 'execution-result', 'executionResult.confidenceScore must be 0-1'));
      if (!('executionNotes' in r))
        out.push(issue('error', 'execution-result', 'executionResult.executionNotes missing'));
    }
  }
  return out;
}

function validateFile(rec, profile, knownModels) {
  const d = rec.data;
  const fileIssues = [];
  const taskIssues = [];
  if (rec.isMaster) {
    if (typeof d.totalTasks !== 'number') fileIssues.push(issue('error', 'master', 'master missing totalTasks'));
    const sum = d.chunks.reduce((s, c) => s + (c.taskCount || 0), 0);
    if (d.chunks.length && 'taskCount' in d.chunks[0] && sum !== d.totalTasks)
      fileIssues.push(issue('warn', 'master-count', `totalTasks=${d.totalTasks} but chunk taskCounts sum to ${sum}`));
    return { fileIssues, taskIssues, taskCount: 0, kind: 'master' };
  }
  for (const k of FILE_REQUIRED)
    if (!(k in d))
      fileIssues.push(issue('warn', 'file-header', `file header missing "${k}" (phase10-documentation.json)`));
  if (d.summary)
    for (const k of SUMMARY_REQUIRED)
      if (!(k in d.summary)) fileIssues.push(issue('warn', 'summary', `summary missing "${k}"`));
  const tasks = d.tasks || [];
  const ids = new Set();
  for (const t of tasks) {
    if (ids.has(t.id)) fileIssues.push(issue('error', 'duplicate-id', `duplicate id ${t.id}`));
    ids.add(t.id);
    const iss = validateTask(t, profile, knownModels);
    if (iss.length) taskIssues.push({ id: t.id, issues: iss });
  }
  return { fileIssues, taskIssues, taskCount: tasks.length, kind: 'tasks' };
}

function run(args) {
  const profile = args.profile === 'final' ? 'final' : 'original';
  const knownModels = new Set(catalog.models.map((m) => m.id).concat(['js-script']));
  const folders = loadFolders();
  const report = {
    profile,
    generated: new Date().toISOString(),
    templates:
      profile === 'final'
        ? ['tools/task-template-final.json']
        : ['advanced-quality-tool/tasks/task-template.json', 'advanced-quality-tool/tasks/phase10-documentation.json'],
    files: [],
    totals: { files: 0, tasks: 0, errors: 0, warnings: 0, conformingTasks: 0 },
  };
  const allIds = new Set();
  for (const f of folders.values()) for (const r of f.files) for (const t of r.data.tasks || []) allIds.add(t.id);
  for (const folder of folders.values()) {
    for (const rec of folder.files) {
      const res = validateFile(rec, profile, knownModels);
      for (const t of rec.data.tasks || []) {
        for (const dep of t.dependencies || [])
          if (!allIds.has(dep) && !/^[A-Z]+-\d+/.test(dep))
            res.fileIssues.push(issue('warn', 'dependency', `${t.id} depends on unknown "${dep}"`));
      }
      const errs = res.fileIssues
        .concat(res.taskIssues.flatMap((x) => x.issues))
        .filter((i) => i.level === 'error').length;
      const warns = res.fileIssues
        .concat(res.taskIssues.flatMap((x) => x.issues))
        .filter((i) => i.level === 'warn').length;
      const badTasks = res.taskIssues.filter((x) => x.issues.some((i) => i.level === 'error')).length;
      report.files.push({
        file: rec.rel.replace(/\\/g, '/'),
        kind: res.kind,
        tasks: res.taskCount,
        errors: errs,
        warnings: warns,
        fileIssues: res.fileIssues,
        taskIssues: res.taskIssues,
      });
      report.totals.files++;
      report.totals.tasks += res.taskCount;
      report.totals.errors += errs;
      report.totals.warnings += warns;
      report.totals.conformingTasks += res.taskCount - badTasks;
    }
  }
  return report;
}

function summarize(items) {
  const m = new Map();
  for (const i of items) {
    const k = `${i.level}|${i.rule}|${i.message.replace(/"[^"]*"/g, '"â€¦"').replace(/\b\d+\b/g, 'N')}`;
    m.set(k, (m.get(k) || 0) + 1);
  }
  return [...m.entries()]
    .map(([k, n]) => ({ n, level: k.split('|')[0], rule: k.split('|')[1], message: k.split('|').slice(2).join('|') }))
    .sort((a, b) => b.n - a.n);
}

function toMarkdown(r) {
  const L = [];
  L.push(
    `# Template Conformance Report (${r.profile} profile)`,
    '',
    `Generated: ${r.generated}`,
    '',
    `Validated against: ${r.templates.join(', ')}`,
    '',
  );
  L.push(
    `**Files:** ${r.totals.files} Â· **Tasks:** ${r.totals.tasks} Â· **Tasks without errors:** ${r.totals.conformingTasks}/${r.totals.tasks} Â· **Errors:** ${r.totals.errors} Â· **Warnings:** ${r.totals.warnings}`,
    '',
  );
  L.push('| File | Kind | Tasks | Errors | Warnings | Verdict |', '|---|---|---:|---:|---:|---|');
  for (const f of r.files)
    L.push(
      `| ${f.file} | ${f.kind} | ${f.tasks} | ${f.errors} | ${f.warnings} | ${f.errors ? 'âŒ deviates' : f.warnings ? 'âš ï¸ minor' : 'âœ… matches'} |`,
    );
  L.push('', '## Deviation summary (grouped)', '', '| Count | Level | Rule | Detail |', '|---:|---|---|---|');
  const all = r.files.flatMap((f) => f.fileIssues.concat(f.taskIssues.flatMap((x) => x.issues)));
  for (const s of summarize(all)) L.push(`| ${s.n} | ${s.level} | ${s.rule} | ${s.message} |`);
  return L.join('\n') + '\n';
}

module.exports = { run, toMarkdown, validateTask };

if (require.main === module) {
  const { parseArgs, writeJson } = require('../lib/common');
  const args = parseArgs(process.argv.slice(2));
  const r = run(args);
  const suffix = r.profile === 'final' ? 'FINAL' : 'ORIGINAL';
  if (args.write !== 'false') {
    writeJson(path.join(ROOT, `TEMPLATE_CONFORMANCE_${suffix}.json`), r);
    fs.writeFileSync(path.join(ROOT, `TEMPLATE_CONFORMANCE_${suffix}.md`), toMarkdown(r), 'utf8');
  }
  console.log(
    `[${r.profile}] files=${r.totals.files} tasks=${r.totals.tasks} ok=${r.totals.conformingTasks} errors=${r.totals.errors} warnings=${r.totals.warnings}`,
  );
  process.exitCode = r.totals.errors ? 1 : 0;
}
