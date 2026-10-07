'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WorkOrchestrator } = require('../../src/agent/work-orchestrator');
const { ToolRegistry } = require('../../src/agent/tool-registry');
const { CONTRACT_VERSION } = require('../../src/agent/contracts');

function createWorkspace() {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'aqt-agent-run-'));
  fs.mkdirSync(path.join(workspace, 'src'), { recursive: true });
  fs.writeFileSync(path.join(workspace, 'src/example.js'), 'original\n', 'utf8');
  return workspace;
}

function makePlanner(overrides = {}) {
  return {
    async plan() {
      return {
        schemaVersion: CONTRACT_VERSION,
        steps: [{ id: 'edit', description: 'Implement requested change', dependencies: [] }],
        affectedFiles: ['src/example.js'],
        expectedChecks: [{ type: 'test', required: true }],
        risks: [],
        metadata: { requiresApproval: false },
        ...overrides
      };
    },
    validatePlan() { return { valid: true, issues: [] }; }
  };
}

function makeWorkItem(orchestrator) {
  return orchestrator.addWork({
    description: 'Update the example module',
    acceptanceCriteria: ['The updated source is present and the test passes'],
    files: ['src/example.js']
  });
}

function makeExecutor(workspace, mutateBeforeReturn = null) {
  return async ({ step, context }) => {
    const source = context.files.find(file => file.path === 'src/example.js');
    if (mutateBeforeReturn) mutateBeforeReturn(workspace);
    return {
      success: true,
      stepId: step.id,
      patches: [{
        schemaVersion: CONTRACT_VERSION,
        path: 'src/example.js',
        operation: 'modify',
        expectedHash: source.hash,
        content: 'implemented\n'
      }]
    };
  };
}

describe('Supervised code-generation execution', () => {
  let workspaces;
  beforeEach(() => { workspaces = []; });
  afterEach(() => {
    for (const workspace of workspaces) fs.rmSync(workspace, { recursive: true, force: true });
  });
  const workspace = () => {
    const root = createWorkspace();
    workspaces.push(root);
    return root;
  };

  test('does not invoke a provider or complete when no executor is configured', async () => {
    const root = workspace();
    const orchestrator = new WorkOrchestrator({ workspace: root, planner: makePlanner() });
    const result = await orchestrator.executeOne(makeWorkItem(orchestrator).id);
    assert.strictEqual(result.status, 'failed');
    assert.match(result.error, /No agent executor is configured/);
    assert.strictEqual(fs.readFileSync(path.join(root, 'src/example.js'), 'utf8'), 'original\n');
  });

  test('applies only approved hash-guarded patches and runs configured checks', async () => {
    const root = workspace();
    let approvalDetails;
    let executorRequest;
    const orchestrator = new WorkOrchestrator({
      workspace: root,
      planner: makePlanner(),
      executor: async request => {
        executorRequest = request;
        return makeExecutor(root)(request);
      },
      checkRunner: { run: async id => ({ id, status: 'passed', exitCode: 0, output: 'ok' }) },
      onApprovalRequired: async (_item, _plan, details) => {
        approvalDetails = details;
        return true;
      }
    });
    const result = await orchestrator.executeOne(makeWorkItem(orchestrator).id);
    assert.strictEqual(result.status, 'completed');
    assert.strictEqual(fs.readFileSync(path.join(root, 'src/example.js'), 'utf8'), 'implemented\n');
    assert.match(approvalDetails.patchDigest, /^[a-f0-9]{64}$/);
    assert.match(approvalDetails.diffs[0].unifiedDiff, /implemented/);
    assert.strictEqual(result.verification.checks.test.status, 'passed');
    assert.strictEqual(executorRequest.task.description, 'Update the example module');
    assert.strictEqual(executorRequest.plan.steps[0].id, 'edit');
    assert.strictEqual(executorRequest.step.id, 'edit');
    assert.strictEqual(executorRequest.context.files[0].path, 'src/example.js');
    assert.ok(executorRequest.signal instanceof AbortSignal);
  });

  test('rejects malformed structured executor output before marking a step complete', async () => {
    const root = workspace();
    const progressTypes = [];
    const orchestrator = new WorkOrchestrator({
      workspace: root,
      planner: makePlanner(),
      executor: async ({ step }) => ({ success: true, stepId: step.id, patches: [{}] }),
      onProgress: event => progressTypes.push(event.type)
    });
    const result = await orchestrator.executeOne(makeWorkItem(orchestrator).id);

    assert.strictEqual(result.status, 'failed');
    assert.match(result.error, /invalid patch/i);
    assert.ok(!progressTypes.includes('step-complete'));
    assert.strictEqual(fs.readFileSync(path.join(root, 'src/example.js'), 'utf8'), 'original\n');
  });

  test('reports executor failures without a success-shaped result', async () => {
    const root = workspace();
    const orchestrator = new WorkOrchestrator({
      workspace: root,
      planner: makePlanner(),
      executor: async () => { throw new Error('Configured provider failed'); }
    });
    const result = await orchestrator.executeOne(makeWorkItem(orchestrator).id);

    assert.strictEqual(result.status, 'failed');
    assert.match(result.error, /Configured provider failed/);
    assert.ok(!Object.prototype.hasOwnProperty.call(result, 'output'));
  });

  test('reports executor timeouts explicitly', async () => {
    const root = workspace();
    const orchestrator = new WorkOrchestrator({
      workspace: root,
      planner: makePlanner(),
      executorTimeoutMs: 10,
      executor: async () => new Promise(() => {})
    });
    const result = await orchestrator.executeOne(makeWorkItem(orchestrator).id);

    assert.strictEqual(result.status, 'failed');
    assert.match(result.error, /timed out after 10ms/);
  });

  test('passes cancellation to the executor and reports cancelled work', async () => {
    const root = workspace();
    let executorSignal;
    const orchestrator = new WorkOrchestrator({
      workspace: root,
      planner: makePlanner(),
      executor: async ({ signal }) => {
        executorSignal = signal;
        return new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
      }
    });
    const item = makeWorkItem(orchestrator);
    const execution = orchestrator.executeOne(item.id);
    const started = Date.now();
    while (!executorSignal) {
      if (Date.now() - started > 2000) throw new Error('Executor did not start');
      await new Promise(resolve => setTimeout(resolve, 5));
    }

    orchestrator.cancel(item.id);
    const result = await execution;
    assert.strictEqual(executorSignal.aborted, true);
    assert.strictEqual(result.status, 'cancelled');
  });

  test('approval denial leaves the workspace unchanged', async () => {
    const root = workspace();
    const orchestrator = new WorkOrchestrator({
      workspace: root,
      planner: makePlanner(),
      executor: makeExecutor(root),
      checkRunner: { run: async id => ({ id, status: 'passed' }) },
      onApprovalRequired: async () => false
    });
    const result = await orchestrator.executeOne(makeWorkItem(orchestrator).id);
    assert.strictEqual(result.status, 'denied');
    assert.strictEqual(fs.readFileSync(path.join(root, 'src/example.js'), 'utf8'), 'original\n');
  });

  test('stale source hashes cannot overwrite user edits', async () => {
    const root = workspace();
    const orchestrator = new WorkOrchestrator({
      workspace: root,
      planner: makePlanner(),
      executor: makeExecutor(root, workspaceRoot => {
        fs.writeFileSync(path.join(workspaceRoot, 'src/example.js'), 'user edit\n', 'utf8');
      }),
      checkRunner: { run: async id => ({ id, status: 'passed' }) },
      onApprovalRequired: async () => true
    });
    const result = await orchestrator.executeOne(makeWorkItem(orchestrator).id);
    assert.strictEqual(result.status, 'failed');
    assert.match(result.error, /Stale source/);
    assert.strictEqual(fs.readFileSync(path.join(root, 'src/example.js'), 'utf8'), 'user edit\n');
  });

  test('missing required verification is not represented as a pass', async () => {
    const root = workspace();
    const orchestrator = new WorkOrchestrator({
      workspace: root,
      planner: makePlanner(),
      executor: makeExecutor(root),
      checkRunner: { run: async id => ({ id, status: 'unavailable', error: 'not configured' }) },
      onApprovalRequired: async () => true
    });
    const result = await orchestrator.executeOne(makeWorkItem(orchestrator).id);
    assert.strictEqual(result.status, 'failed');
    assert.strictEqual(result.verification.checks.test.status, 'unavailable');
  });
});

describe('Model-visible tool boundaries', () => {
  let workspaces;
  beforeEach(() => { workspaces = []; });
  afterEach(() => {
    for (const workspace of workspaces) fs.rmSync(workspace, { recursive: true, force: true });
  });

  test('excludes arbitrary command and direct-write tools and surfaces unavailable diagnostics', async () => {
    const root = createWorkspace();
    workspaces.push(root);
    const registry = new ToolRegistry({ workspace: root });
    const names = registry.getModelTools().map(tool => tool.name);
    assert.ok(!names.includes('execute_command'));
    assert.ok(!names.includes('write_file'));
    const diagnostics = await registry.execute('get_diagnostics');
    assert.strictEqual(diagnostics.success, false);
    assert.match(diagnostics.error, /not configured/);
    assert.ok(registry.getExecutionLog().some(entry => entry.tool === 'get_diagnostics' && !entry.success));
  });

  test('hash-guarded edit rejects stale file content', async () => {
    const root = createWorkspace();
    workspaces.push(root);
    const registry = new ToolRegistry({ workspace: root });
    const initial = fs.readFileSync(path.join(root, 'src/example.js'), 'utf8');
    const expectedHash = crypto.createHash('sha256').update(initial).digest('hex');
    fs.writeFileSync(path.join(root, 'src/example.js'), 'changed externally\n', 'utf8');
    const result = await registry.execute('edit_file', {
      path: 'src/example.js',
      expectedHash,
      content: 'agent edit\n'
    }, { applyPatch: async () => ({ applied: true }) });
    assert.strictEqual(result.success, false);
    assert.match(result.error, /Stale source/);
  });
});
