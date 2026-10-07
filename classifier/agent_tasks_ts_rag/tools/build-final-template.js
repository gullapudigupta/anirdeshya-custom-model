'use strict';
// Regenerates tools/task-template-final.json from the two original templates + the model catalog.
const fs = require('fs');
const path = require('path');
const SRC =
  process.env.TEMPLATE_SRC || 'C:/sarah laptop/first app/mobileapp/anirdeshya-cutom-model/advanced-quality-tool/tasks/';
const tpl = JSON.parse(fs.readFileSync(path.join(SRC, 'task-template.json'), 'utf8'));
const p10 = JSON.parse(fs.readFileSync(path.join(SRC, 'phase10-documentation.json'), 'utf8'));
const cat = require('./model-catalog.json');

const exTask = {
  id: 'SPEC-1',
  name: 'Create ledger collection with server-only permissions',
  status: 'COMPLETED',
  completedDate: '2026-10-04',
  artifacts: ['functions/ledger/schema.json'],
  priority: 'CRITICAL',
  estimatedHours: 12,
  value: 95,
  recommendedModel: ['gpt-5', 'claude-opus', 'claude-sonnet'],
  modelRationale: 'Why this model, equal-grade fallbacks, and when to escalate.',
  dependencies: [],
  deliverables: ['Concrete, checkable deliverable'],
  tags: ['ledger', 'security'],
  userClarifications: [],
  modelAssignment: {
    source: 'docs/llm-model-comparison.md',
    category: 'critical-money',
    grade: 'A',
    costTier: 'premium',
    firstChoice: 'gpt-5',
    equalGradeAlternatives: ['claude-opus', 'claude-sonnet'],
    previous: { recommendedModel: ['gpt-4.1'], modelRationale: '(original text, kept for audit)' },
  },
  executionPlan: { order: 1, batch: 1, band: 'critical-logic', scriptable: false, estimatedCostUsd: 4.5 },
  executionResult: {
    model: 'gpt-5',
    provider: 'OpenAI',
    confidenceScore: 0.9,
    executionNotes: 'Free-form notes about the run, retries, escalations.',
    usedFirstChoice: true,
    executedAt: '2026-10-04T07:00:00.000Z',
  },
  jevRecommendation: {
    model: 'gpt-5',
    confidence: 0.8,
    reason: 'One-sentence reason from the JEV system.',
    gatewayModel: 'anthropic/claude-sonnet-4',
    queriedAt: '2026-10-04T07:00:00.000Z',
    agreesWithFirstChoice: true,
  },
  automation: { script: 'scaffold', files: [{ path: 'relative/path.md', template: 'md', title: 'Title' }] },
};
const pendingTask = {
  ...exTask,
  id: 'SPEC-2',
  name: 'Pending task: new properties start as null',
  status: 'PENDING',
  executionResult: null,
  jevRecommendation: null,
};
delete pendingTask.completedDate;
delete pendingTask.artifacts;
delete pendingTask.automation;

const out = {
  $schema: './task-schema.json',
  version: '2.0.0',
  description:
    'Final task template = task-template.json + phase10-documentation.json file header + model assignment, cost ordering, execution result, JEV recommendation, script automation and user clarifications.',
  usage:
    'Copy this file to start a spec task file. Run `node tools/cli.js validate --profile final` to check conformance.',
  metadata: {
    created: '2026-10-04',
    inheritsFrom: [
      'advanced-quality-tool/tasks/task-template.json',
      'advanced-quality-tool/tasks/phase10-documentation.json',
    ],
    modelCatalog: 'tools/model-catalog.json (derived from docs/llm-model-comparison.md)',
    legacyModelPricing: tpl.metadata.modelPricing,
  },
  fileHeaderTemplate: {
    description:
      'Header of every task file (from phase10-documentation.json). Chunked specs keep spec/chunkId/taskRange/folder; master files list chunks and carry executionPlan.',
    example: {
      name: 'Spec name',
      description: 'What this file covers',
      priority: 'MEDIUM',
      status: 'PENDING',
      completionPercentage: '0%',
      createdOn: '2026-10-04',
      updatedOn: '2026-10-04',
      tasks: ['(task objects)'],
      summary: { total: 0, completed: 0, pending: 0, totalEstimatedHours: 0, averageValue: 0 },
      executionPlan: {
        strategy: 'scaffold -> critical-logic -> followup, dependency-safe',
        generated: '2026-10-04',
        batches: 0,
        order: [{ order: 1, batch: 1, id: 'SPEC-1', band: 'scaffold', model: 'qwen-3', file: 'tasks.json' }],
      },
    },
  },
  exampleTaskCompleted: exTask,
  exampleTaskPending: pendingTask,
  newProperties: {
    modelAssignment:
      'Task 2: first-choice model picked from equal-grade groups in the model catalog; `previous` keeps the original recommendation.',
    executionPlan:
      'Task 4: order (1-based within the spec folder), batch (consecutive tasks sharing a band), band (scaffold | critical-logic | followup), scriptable, estimatedCostUsd.',
    executionResult:
      'Task 3: null until completed; then {model, provider, confidenceScore 0-1, executionNotes, usedFirstChoice, executedAt}. Write it with `node tools/cli.js complete`.',
    jevRecommendation:
      'Task 5: null until queried; then the JEV system answer {model, confidence, reason, gatewayModel, queriedAt, agreesWithFirstChoice}. Write it with `node tools/cli.js jev`.',
    automation:
      'Task 6 (optional): {script:"scaffold", files:[{path,template,...}]}; executed by `node tools/cli.js scaffold` with zero model tokens.',
    userClarifications:
      'Optional array of {question, answer, status} entries captured with `node tools/cli.js clarify`; status is confirmed, recorded_decision or awaiting_user_input.',
  },
  orderingRules: {
    bands: ['scaffold', 'critical-logic', 'followup'],
    principle:
      'Cheap/scripted creation first, then high-end models for critical logic, then low-cost models for the remaining work; dependencies always win over band.',
    batching: 'Stay in the current band while any task in it is ready, then move to the next band.',
    crossSpecOrder: 'EXECUTION_ORDER.md',
  },
  modelCatalogSummary: {
    equalGradeGroups: cat.equalGradeGroups,
    categories: Object.fromEntries(
      Object.entries(cat.categories).map(([k, v]) => [
        k,
        {
          band: v.band,
          costTier: v.costTier,
          firstChoice: v.firstChoice,
          equalGradeAlternatives: v.equalGradeAlternatives,
        },
      ]),
    ),
    escalation: cat.escalation,
  },
  taskCreationGuide: {
    requiredFields: [
      ...tpl.taskCreationGuide.requiredFields,
      {
        field: 'modelAssignment',
        type: 'object',
        description: 'First choice + equal-grade alternatives from the model catalog',
      },
      { field: 'executionPlan', type: 'object', description: 'order, batch, band, scriptable, estimatedCostUsd' },
      {
        field: 'executionResult',
        type: 'object|null',
        description: 'null until COMPLETED, then model/confidence/notes',
      },
      { field: 'jevRecommendation', type: 'object|null', description: 'null until the JEV system is queried' },
    ],
    optionalFields: [
      ...tpl.taskCreationGuide.optionalFields,
      { field: 'automation', type: 'object', description: 'Script-only execution spec (see newProperties.automation)' },
      {
        field: 'userClarifications',
        type: 'array',
        description:
          'Questions and answers captured through `node tools/cli.js clarify`; statuses are confirmed, recorded_decision or awaiting_user_input',
      },
    ],
    recommendedModelRule:
      '1-3 catalog ids, first choice first; remaining entries are equal-grade alternatives (not escalations).',
  },
  costEstimationGuide: {
    formula: 'estimatedTokens = estimatedHours * 100000; cost = tokens/1e6 * (0.7*input + 0.3*output)',
    modelCosts: Object.fromEntries(
      cat.models.map((m) => [
        m.id,
        { per1MInput: m.inputPerM, per1MOutput: m.outputPerM, grade: m.grade, estimated: m.estimated },
      ]),
    ),
  },
  quickReference: tpl.quickReference,
  headerSummaryRule: p10.summary,
};
fs.writeFileSync(path.join(__dirname, 'task-template-final.json'), JSON.stringify(out, null, 2) + '\n');
console.log('wrote tools/task-template-final.json');
