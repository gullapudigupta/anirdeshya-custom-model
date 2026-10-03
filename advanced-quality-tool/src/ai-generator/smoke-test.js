/**
 * Smoke test for the Phase 6 AI Issue Generator foundations.
 * Run: node src/ai-generator/smoke-test.js
 * No external deps; validates classify -> context -> prompt pipeline.
 */
'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const {
  IssueClassifier, CodeContextAnalyzer, ContextAggregator,
  PromptBuilder, LineEditor, prepareFix
} = require('./index');

// Use this very file as the source so the context analyzer has real lines to read.
const selfFile = path.relative(process.cwd(), __filename);

const issue = {
  id: 'test-issue-1',
  type: 'STYLE-001',
  title: "Missing semicolon",
  message: "Missing semicolon.",
  file: selfFile,
  startLine: 20,
  endLine: 20,
  severity: 'WARNING',
  category: 'STYLE',
  fileType: 'javascript',
  autoFixLevel: 'AUTO',
  priority: 78,
  rule: 'semi'
};

// 1. Classifier
const classifier = new IssueClassifier();
const classification = classifier.classify(issue);
assert.ok(classification.explanation.what, 'what missing');
assert.ok(classification.explanation.why, 'why missing');
assert.ok(classification.explanation.how, 'how missing');
assert.ok(classification.summaryTokens <= 100, 'summary over token limit');
assert.strictEqual(classification.fixComplexity, 'trivial', 'semi should be trivial');
console.log('✓ classifier:', classification.summary, '| score=', classification.score);

// 2. Context analyzer
const analyzer = new CodeContextAnalyzer({ rootDir: process.cwd() });
const context = analyzer.analyze(issue);
assert.ok(context.snippet.text.length > 0, 'snippet empty');
assert.ok(context.tokens <= 300, 'context over 300 token budget: ' + context.tokens);
console.log('✓ context: lines', context.snippet.startLine + '-' + context.snippet.endLine, '| tokens=', context.tokens);

// 3. Prompt builder
const builder = new PromptBuilder();
const prompt = builder.build(classification, context);
assert.ok(prompt.user.includes('OUTPUT FORMAT'), 'output contract missing');
assert.ok(prompt.user.includes('CODE CONTEXT'), 'code context missing');
assert.ok(prompt.withinBudget, 'prompt over budget');
assert.ok(/\d+\| /.test(prompt.user), 'prompt should contain numbered lines');
console.log('✓ prompt: tokens=', prompt.tokens, '| withinBudget=', prompt.withinBudget);

// 4. Convenience pipeline
const bundle = prepareFix(issue, { rootDir: process.cwd() });
assert.ok(bundle.classification && bundle.context && bundle.prompt, 'prepareFix incomplete');
console.log('✓ prepareFix pipeline OK');

// 5. Context aggregator (P6-T006)
const aggregator = new ContextAggregator();
const agg = aggregator.aggregate({
  codeContext: context,
  classification,
  fragments: [
    { source: 'docs', title: 'ESLint semi rule', text: 'The semi rule enforces semicolons at the end of statements.', score: 0.8 },
    { source: 'docs', title: 'ESLint semi rule dup', text: 'The semi rule enforces semicolons at the end of statements.', score: 0.7 }, // dup
    { source: 'stackoverflow', title: 'Missing semicolon fix', text: 'Add a semicolon to terminate the statement.', score: 0.6 }
  ]
});
assert.ok(agg.withinBudget, 'aggregate over budget');
assert.ok(agg.fragments.length >= 2, 'aggregate should keep multiple fragments');
assert.ok(agg.fragments.length < 5, 'aggregate should have deduplicated the duplicate doc');
console.log('✓ aggregator:', agg.summary, '| tokens=', agg.tokens);

// 6. Line editor (P6-T010) — parse, validate, apply to a temp file, then rollback
const tmpFile = require('path').join(os.tmpdir(), 'aqt-line-editor-test.js');
fs.writeFileSync(tmpFile, ['const a = 1', 'const b = 2', 'const c = 3'].join('\n'), 'utf8');

const editor = new LineEditor({ rootDir: os.tmpdir() });
const plan = editor.parseEditPlan('```json\n{"edits":[{"startLine":2,"endLine":2,"replacement":"const b = 20;"}],"explanation":"fix b"}\n```');
assert.strictEqual(plan.edits.length, 1, 'parse edit plan failed');

const validation = editor.validate(tmpFile, plan);
assert.ok(validation.valid, 'edit plan should validate: ' + validation.errors.join('; '));

const applyRes = editor.applyToFile(tmpFile, plan);
assert.ok(applyRes.applied, 'edit not applied');
const afterApply = fs.readFileSync(tmpFile, 'utf8');
assert.ok(afterApply.includes('const b = 20;'), 'replacement not written');
assert.ok(afterApply.includes('const a = 1') && afterApply.includes('const c = 3'), 'other lines corrupted');
console.log('✓ line-editor applied edit, backup at', require('path').basename(applyRes.backupPath));

// rollback restores original
const rolled = editor.rollback(tmpFile, applyRes.backupPath);
assert.ok(rolled, 'rollback failed');
const afterRollback = fs.readFileSync(tmpFile, 'utf8');
assert.ok(afterRollback.includes('const b = 2') && !afterRollback.includes('const b = 20;'), 'rollback did not restore');
console.log('✓ line-editor rollback restored original');

// out-of-bounds edit is rejected
const badValidation = editor.validate(tmpFile, { edits: [{ startLine: 99, endLine: 99, replacement: 'x' }], explanation: '' });
assert.ok(!badValidation.valid, 'out-of-bounds edit should be rejected');
console.log('✓ line-editor rejects out-of-bounds edit');

// cleanup
fs.unlinkSync(tmpFile);
if (applyRes.backupPath) { try { fs.unlinkSync(applyRes.backupPath); } catch {} }

console.log('\nAll smoke tests passed.');
