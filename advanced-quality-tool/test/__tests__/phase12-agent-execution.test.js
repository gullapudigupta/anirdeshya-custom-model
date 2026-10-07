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
    assert.strictEqual(orchestrator.runStore.validateResume(result.itemId).status, 'loaded');
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

describe('Phase 12 verification and bounded repair', () => {
  let workspaces;
  beforeEach(() => { workspaces = []; });
  afterEach(() => {
    for (const workspace of workspaces) fs.rmSync(workspace, { recursive: true, force: true });
  });

  test('does not pass a plan with no declared verification checks', async () => {
    const root = createWorkspace();
    workspaces.push(root);
    const orchestrator = new WorkOrchestrator({
      workspace: root,
      planner: makePlanner({ expectedChecks: [] }),
      executor: makeExecutor(root),
      onApprovalRequired: async () => true
    });

    const result = await orchestrator.executeOne(makeWorkItem(orchestrator).id);
    assert.strictEqual(result.status, 'failed');
    assert.strictEqual(result.verification.checks.verification.status, 'unavailable');
  });

  test('runs a trusted configured verification command and records its evidence', async () => {
    const root = createWorkspace();
    workspaces.push(root);
    const orchestrator = new WorkOrchestrator({
      workspace: root,
      planner: makePlanner({ expectedChecks: [{ type: 'smoke', required: true }] }),
      checks: {
        smoke: {
          command: process.execPath,
          args: ['-e', "process.stdout.write('real check passed')"]
        }
      },
      executor: makeExecutor(root),
      onApprovalRequired: async () => true
    });

    const result = await orchestrator.executeOne(makeWorkItem(orchestrator).id);
    assert.strictEqual(result.status, 'completed');
    assert.strictEqual(result.verification.checks.smoke.status, 'passed');
    assert.match(result.verification.checks.smoke.command, /node/);
    assert.strictEqual(result.verification.checks.smoke.output, 'real check passed');
    assert.strictEqual(result.verification.checks.smoke.exitCode, 0);
  });

  test('feeds bounded check diagnostics to a repair attempt and completes only after checks pass', async () => {
    const root = createWorkspace();
    workspaces.push(root);
    let checkAttempts = 0;
    let repairContext;
    const orchestrator = new WorkOrchestrator({
      workspace: root,
      planner: makePlanner(),
      executor: async ({ step, context }) => {
        if (context.repairDiagnostics) repairContext = context.repairDiagnostics;
        const source = context.files.find(file => file.path === 'src/example.js');
        return {
          success: true,
          stepId: step.id,
          ...(checkAttempts > 0 ? { usage: { inputTokens: 100, outputTokens: 20 } } : {}),
          patches: [{
            schemaVersion: CONTRACT_VERSION,
            path: 'src/example.js',
            operation: 'modify',
            expectedHash: source.hash,
            content: checkAttempts === 0 ? 'first attempt\n' : 'repaired\n'
          }]
        };
      },
      checkRunner: {
        run: async id => {
          checkAttempts++;
          return checkAttempts === 1
            ? { id, status: 'failed', exitCode: 1, output: 'assertion failed '.repeat(500) }
            : { id, status: 'passed', exitCode: 0, output: 'ok' };
        }
      },
      onApprovalRequired: async () => true
    });

    const result = await orchestrator.executeOne(makeWorkItem(orchestrator).id);
    assert.strictEqual(result.status, 'completed');
    assert.strictEqual(checkAttempts, 2);
    assert.strictEqual(fs.readFileSync(path.join(root, 'src/example.js'), 'utf8'), 'repaired\n');
    assert.ok(repairContext.test.output.length <= 4000);
    assert.strictEqual(repairContext.test.status, 'failed');
  });

  test('stops persistent failures at the retry limit without resetting token usage', async () => {
    const root = createWorkspace();
    workspaces.push(root);
    let executorCalls = 0;
    let checkCalls = 0;
    const orchestrator = new WorkOrchestrator({
      workspace: root,
      planner: makePlanner(),
      executor: async ({ step, context }) => {
        executorCalls++;
        const source = context.files.find(file => file.path === 'src/example.js');
        return {
          success: true,
          stepId: step.id,
          ...(context.repairDiagnostics ? { usage: { inputTokens: 100, outputTokens: 25 } } : {}),
          patches: [{
            schemaVersion: CONTRACT_VERSION,
            path: 'src/example.js',
            operation: 'modify',
            expectedHash: source.hash,
            content: `attempt ${executorCalls}\n`
          }]
        };
      },
      checkRunner: {
        run: async id => {
          checkCalls++;
          return { id, status: 'failed', exitCode: 1, output: 'still failing' };
        }
      },
      onApprovalRequired: async () => true
    });
    const item = orchestrator.addWork({
      description: 'Persistently failing implementation',
      files: ['src/example.js'],
      maxRetries: 2
    });

    const result = await orchestrator.executeOne(item.id);
    assert.strictEqual(result.status, 'failed');
    assert.match(result.error, /Verification failed after 2 attempts/);
    assert.strictEqual(executorCalls, 2);
    assert.strictEqual(checkCalls, 2);
    assert.ok(item.repairTokensUsed > 0);
  });

  test('enforces repair token limits before invoking another model call', async () => {
    const root = createWorkspace();
    workspaces.push(root);
    let executorCalls = 0;
    const orchestrator = new WorkOrchestrator({
      workspace: root,
      planner: makePlanner(),
      maxRepairTokens: 10,
      executor: async ({ step, context }) => {
        executorCalls++;
        const source = context.files.find(file => file.path === 'src/example.js');
        return {
          success: true,
          stepId: step.id,
          patches: [{
            schemaVersion: CONTRACT_VERSION,
            path: 'src/example.js',
            operation: 'modify',
            expectedHash: source.hash,
            content: 'attempt\n'
          }]
        };
      },
      checkRunner: { run: async id => ({ id, status: 'failed', exitCode: 1 }) },
      onApprovalRequired: async () => true
    });

    const result = await orchestrator.executeOne(makeWorkItem(orchestrator).id);
    assert.strictEqual(result.status, 'failed');
    assert.strictEqual(result.code, 'REPAIR_TOKEN_LIMIT');
    assert.strictEqual(executorCalls, 1);
  });

  test('enforces repair cost limits before invoking another model call', async () => {
    const root = createWorkspace();
    workspaces.push(root);
    let executorCalls = 0;
    const orchestrator = new WorkOrchestrator({
      workspace: root,
      planner: makePlanner(),
      maxRepairCost: 0.000001,
      executor: async ({ step, context }) => {
        executorCalls++;
        const source = context.files.find(file => file.path === 'src/example.js');
        return {
          success: true,
          stepId: step.id,
          patches: [{
            schemaVersion: CONTRACT_VERSION,
            path: 'src/example.js',
            operation: 'modify',
            expectedHash: source.hash,
            content: 'attempt\n'
          }]
        };
      },
      checkRunner: { run: async id => ({ id, status: 'failed', exitCode: 1 }) },
      onApprovalRequired: async () => true
    });

    const result = await orchestrator.executeOne(makeWorkItem(orchestrator).id);
    assert.strictEqual(result.status, 'failed');
    assert.strictEqual(result.code, 'REPAIR_COST_LIMIT');
    assert.strictEqual(executorCalls, 1);
  });

  test('stops repairs when a previously passing required check regresses', async () => {
    const root = createWorkspace();
    workspaces.push(root);
    let callsByCheck = { test: 0, lint: 0 };
    let executorCalls = 0;
    const orchestrator = new WorkOrchestrator({
      workspace: root,
      planner: makePlanner({
        expectedChecks: [
          { type: 'test', required: true },
          { type: 'lint', required: true }
        ]
      }),
      executor: async ({ step, context }) => {
        executorCalls++;
        const source = context.files.find(file => file.path === 'src/example.js');
        return {
          success: true,
          stepId: step.id,
          ...(context.repairDiagnostics ? { usage: { inputTokens: 100, outputTokens: 20 } } : {}),
          patches: [{
            schemaVersion: CONTRACT_VERSION,
            path: 'src/example.js',
            operation: 'modify',
            expectedHash: source.hash,
            content: `attempt ${executorCalls}\n`
          }]
        };
      },
      checkRunner: {
        run: async id => {
          const attempt = callsByCheck[id]++;
          return {
            id,
            status: id === 'test'
              ? (attempt === 0 ? 'failed' : 'passed')
              : (attempt === 0 ? 'passed' : 'failed'),
            exitCode: attempt === 0 && id === 'test' || attempt > 0 && id === 'lint' ? 1 : 0
          };
        }
      },
      onApprovalRequired: async () => true
    });

    const result = await orchestrator.executeOne(makeWorkItem(orchestrator).id);
    assert.strictEqual(result.status, 'failed');
    assert.match(result.error, /caused a regression/);
    assert.strictEqual(executorCalls, 2);
  });

  test('cancels an in-flight repair without completing the run', async () => {
    const root = createWorkspace();
    workspaces.push(root);
    let executorCalls = 0;
    let repairSignal;
    const orchestrator = new WorkOrchestrator({
      workspace: root,
      planner: makePlanner(),
      executor: async ({ step, context, signal }) => {
        executorCalls++;
        if (executorCalls > 1) {
          repairSignal = signal;
          return new Promise((_resolve, reject) => signal.addEventListener('abort', () => {
            const error = new Error('cancelled');
            error.code = 'EXECUTION_CANCELLED';
            reject(error);
          }, { once: true }));
        }
        const source = context.files.find(file => file.path === 'src/example.js');
        return {
          success: true,
          stepId: step.id,
          patches: [{
            schemaVersion: CONTRACT_VERSION,
            path: 'src/example.js',
            operation: 'modify',
            expectedHash: source.hash,
            content: 'first attempt\n'
          }]
        };
      },
      checkRunner: { run: async id => ({ id, status: 'failed', exitCode: 1 }) },
      onApprovalRequired: async () => true
    });
    const item = makeWorkItem(orchestrator);
    const execution = orchestrator.executeOne(item.id);
    const started = Date.now();
    while (!repairSignal) {
      if (Date.now() - started > 2000) throw new Error('Repair executor did not start');
      await new Promise(resolve => setTimeout(resolve, 5));
    }

    orchestrator.cancel(item.id);
    const result = await execution;
    assert.strictEqual(repairSignal.aborted, true);
    assert.strictEqual(result.status, 'cancelled');
    assert.strictEqual(item.status, 'cancelled');
  });
});
