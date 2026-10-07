'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PluginManager } = require('../../src/plugins/plugin-system');

const EXAMPLES_DIR = path.resolve(__dirname, '../../examples/plugins');

async function loadExamples() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aqt-example-plugins-'));
  fs.cpSync(EXAMPLES_DIR, root, { recursive: true });
  const manager = new PluginManager({ pluginDirs: [root] });
  await manager.initialize();
  return { manager, root };
}

describe('Example plugins', () => {
  let manager;
  let root;

  beforeAll(async () => {
    ({ manager, root } = await loadExamples());
  });

  afterAll(() => {
    if (root) fs.rmSync(root, { recursive: true, force: true });
  });

  test('every example loads through the plugin manager', () => {
    const ids = manager.listPlugins().map(plugin => plugin.id).sort();
    assert.deepStrictEqual(ids, [
      'analysis-hook',
      'custom-analyzer',
      'custom-fix-strategy',
      'custom-reporter',
      'no-todo-rule',
      'slack-notification'
    ]);
    assert.strictEqual(manager.getStats().pluginsFailed, 0);
  });

  test('custom analyzer and no-todo rules report issues from provided source', async () => {
    const source = `const a = 1; // TODO\n${'x'.repeat(130)}\n`;
    const issues = await manager.runCustomRules('src/sample.js', null, { source });
    const rules = issues.map(issue => issue.ruleId).sort();
    assert.deepStrictEqual(rules, ['custom-analyzer:max-line-length', 'no-todo-rule:no-todo-marker']);
    const longLine = issues.find(issue => issue.ruleId === 'custom-analyzer:max-line-length');
    assert.strictEqual(longLine.line, 2);
  });

  test('rules report nothing for clean source', async () => {
    const issues = await manager.runCustomRules('src/clean.js', null, { source: 'const ok = true;\n' });
    assert.deepStrictEqual(issues, []);
  });

  test('custom reporter renders a severity summary only when requested', async () => {
    const issues = [
      { severity: 'HIGH', message: 'a' },
      { severity: 'low', message: 'b' },
      { severity: 'high', message: 'c|d' }
    ];
    const report = await manager.executeHook('formatReport', { format: 'severity-summary', issues });
    assert.match(report.output, /Total issues: 3/);
    assert.match(report.output, /\| high \| 2 \|/);
    assert.match(report.output, /\| low \| 1 \|/);

    const untouched = await manager.executeHook('formatReport', { format: 'json', issues });
    assert.strictEqual(untouched.output, undefined);
  });

  test('slack notification prepares an escaped payload for severe issues only', async () => {
    const result = await manager.executeHook('afterAnalysis', {
      issues: [
        { severity: 'critical', message: '<script>&', file: 'src/a.js', line: 3 },
        { severity: 'low', message: 'ignored' }
      ]
    });
    assert.strictEqual(result.notifications.length, 1);
    const notification = result.notifications[0];
    assert.strictEqual(notification.channel, 'slack');
    assert.match(notification.payload.text, /1 critical\/high-severity issue/);
    const body = notification.payload.blocks[1].text.text;
    assert.match(body, /&lt;script&gt;&amp;/);
    assert.doesNotMatch(body, /ignored/);

    const none = await manager.executeHook('afterAnalysis', { issues: [{ severity: 'low', message: 'x' }] });
    assert.strictEqual(none.notifications, undefined);
  });

  test('custom fix strategy suggests reviewable fixes without changing other issues', async () => {
    const result = await manager.executeHook('beforeFix', {
      issues: [
        { ruleId: 'no-trailing-spaces', line: 4, sourceLine: 'const a = 1;   ' },
        { ruleId: 'no-trailing-spaces', line: 5, sourceLine: 'const b = 2;' },
        { ruleId: 'other-rule', line: 6, sourceLine: 'x  ' }
      ]
    });
    assert.deepStrictEqual(result.issues[0].suggestedFix, {
      strategy: 'custom-trailing-whitespace',
      line: 4,
      replacement: 'const a = 1;',
      requiresReview: true
    });
    assert.strictEqual(result.issues[1].suggestedFix, undefined);
    assert.strictEqual(result.issues[2].suggestedFix, undefined);
  });
});
