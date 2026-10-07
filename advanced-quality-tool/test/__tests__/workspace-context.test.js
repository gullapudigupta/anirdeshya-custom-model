'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { WorkspaceContext } = require('../../src/agent/workspace-context');
const { WorkOrchestrator } = require('../../src/agent/work-orchestrator');

async function withWorkspace(run) {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'aqt-workspace-context-'));
  try {
    return await run(workspace);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}

describe('WorkspaceContext (P12-T004)', () => {
  test('discovers relevant files with bounded search, language and symbol metadata', () => withWorkspace((workspace) => {
    fs.mkdirSync(path.join(workspace, 'src'));
    fs.writeFileSync(
      path.join(workspace, 'src', 'quartz-widget.js'),
      'class QuartzWidget {}\nfunction createQuartzWidget() {}\n'
    );
    fs.mkdirSync(path.join(workspace, 'node_modules'));
    fs.writeFileSync(path.join(workspace, 'node_modules', 'ignored.js'), 'QuartzWidget');

    const result = new WorkspaceContext({ workspace }).collect([], { query: 'implement QuartzWidget' });

    assert.deepStrictEqual(result.files.map(file => file.path), ['src/quartz-widget.js']);
    assert.strictEqual(result.files[0].language, 'javascript');
    assert.deepStrictEqual(result.files[0].symbols.map(symbol => symbol.name), [
      'QuartzWidget',
      'createQuartzWidget'
    ]);
    assert.ok(result.search.matches.some(match => match.path === 'src/quartz-widget.js'));
    assert.strictEqual(result.provenance[0].hash, crypto.createHash('sha256')
      .update(result.files[0].content).digest('hex'));
    assert.strictEqual(result.totalTokens, result.files[0].tokens);
  }));

  test('honors file and token budgets and reports missing, ignored, and oversized inputs', () => withWorkspace((workspace) => {
    fs.writeFileSync(path.join(workspace, 'small.js'), 'x'.repeat(80));
    fs.writeFileSync(path.join(workspace, 'large.js'), 'x'.repeat(120));
    fs.writeFileSync(path.join(workspace, 'unicode.js'), 'é'.repeat(10));
    const collector = new WorkspaceContext({
      workspace,
      maxFileBytes: 100,
      maxTotalBytes: 100,
      maxTokens: 6
    });

    const result = collector.collect([
      'small.js',
      'large.js',
      'missing.js',
      'node_modules/hidden.js'
    ]);

    assert.ok(result.totalTokens <= 6);
    assert.ok(result.totalBytes <= 100);
    assert.ok(result.truncated.some(file => file.path === 'small.js'));
    assert.ok(result.truncated.some(file => file.path === 'large.js'));
    assert.deepStrictEqual(result.missing, ['missing.js']);
    assert.deepStrictEqual(result.excluded, [{ path: 'node_modules/hidden.js', reason: 'ignored path' }]);

    const unicodeResult = new WorkspaceContext({
      workspace,
      maxTotalBytes: 5,
      maxTokens: 5
    }).collect(['unicode.js']);
    assert.ok(unicodeResult.totalBytes <= 5);
    assert.ok(unicodeResult.totalTokens <= 5);
  }));

  test('keeps search discovery inside an explicit file scope', () => withWorkspace((workspace) => {
    fs.writeFileSync(path.join(workspace, 'scoped.js'), 'class QuartzWidget {}\n');
    fs.writeFileSync(path.join(workspace, 'unscoped.js'), 'class QuartzWidgetElsewhere {}\n');

    const result = new WorkspaceContext({ workspace }).collect(['scoped.js'], { query: 'QuartzWidget' });

    assert.deepStrictEqual(result.files.map(file => file.path), ['scoped.js']);
    assert.deepStrictEqual(result.search.matches, []);
    assert.strictEqual(result.search.scannedFiles, 0);
  }));

  test('rejects paths outside the workspace and explicit file-count overflow', () => withWorkspace((workspace) => {
    const collector = new WorkspaceContext({ workspace, maxFiles: 1 });
    assert.throws(() => collector.collect([path.resolve(workspace, '..', 'outside.js')]), /outside the workspace/);
    assert.throws(() => collector.collect(['one.js', 'two.js']), /file limit exceeded/);
  }));

  test('wires gathered context and provenance into task execution results', async () => withWorkspace(async (workspace) => {
    fs.mkdirSync(path.join(workspace, 'src'));
    fs.writeFileSync(path.join(workspace, 'src', 'quartz-widget.js'), 'class QuartzWidget {}\n');
    let plannerContext;
    let executorContext;
    const planner = {
      plan: async ({ context }) => {
        plannerContext = context;
        return {
          steps: [{ id: 'step-1', description: 'Inspect', files: context.files }],
          affectedFiles: context.files,
          expectedChecks: [],
          risks: [],
          metadata: { requiresApproval: false }
        };
      },
      validatePlan: () => ({ valid: true, issues: [] })
    };
    const orchestrator = new WorkOrchestrator({
      workspace,
      planner,
      stepExecutor: async (input) => {
        executorContext = input.context;
        return { success: true, stepId: input.step.id, output: 'done' };
      }
    });
    const item = orchestrator.addWork({
      taskId: 'context-task',
      description: 'Implement QuartzWidget'
    });

    const result = await orchestrator.executeOne(item.id);

    assert.strictEqual(result.status, 'completed');
    assert.deepStrictEqual(plannerContext.files, ['src/quartz-widget.js']);
    assert.strictEqual(executorContext.files[0].hash, item.context.provenance[0].hash);
    assert.strictEqual(result.contextProvenance[0].path, 'src/quartz-widget.js');
    assert.strictEqual(result.contextProvenance[0].hash, item.context.files[0].hash);
  }));
});
