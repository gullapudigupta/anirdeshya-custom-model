'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WorkOrchestrator } = require('../../src/agent/work-orchestrator');
const { ToolRegistry } = require('../../src/agent/tool-registry');

let TEST_DIR;

function createPlanner(overrides = {}) {
  return {
    plan: async () => ({
      steps: [{ id: 'step-1', description: 'Edit the requested file', files: ['target.txt'] }],
      affectedFiles: ['target.txt'],
      expectedChecks: [],
      risks: [],
      metadata: { requiresApproval: false },
      ...overrides
    }),
    validatePlan: () => ({ valid: true, issues: [] })
  };
}

function createWork(orchestrator) {
  return orchestrator.addWork({
    taskId: 'permission-task',
    description: 'Edit a file with enforced action permissions',
    taskContract: {
      schemaVersion: 1,
      id: 'permission-task',
      description: 'Edit a file with enforced action permissions',
      acceptanceCriteria: ['The file is updated only after approval']
    }
  });
}

function createEditOrchestrator(options = {}) {
  const toolRegistry = new ToolRegistry({ workspace: TEST_DIR });
  const orchestrator = new WorkOrchestrator({
    workspace: TEST_DIR,
    planner: createPlanner(options.plan),
    toolRegistry,
    stepExecutor: async input => {
      await input.tools('edit_file', options.args || {
        path: 'target.txt',
        expectedHash: crypto.createHash('sha256').update('original').digest('hex'),
        content: 'updated'
      });
      return { success: true, stepId: input.step.id, output: {} };
    },
    ...options.orchestrator
  });
  return { orchestrator, toolRegistry };
}

describe('WorkOrchestrator action permission gates (P12-T007)', () => {
  beforeEach(() => {
    TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aqt-permission-gates-'));
    fs.writeFileSync(path.join(TEST_DIR, 'target.txt'), 'original');
  });

  afterEach(() => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  test('denied high-risk plan approval prevents all execution and records the decision', async () => {
    let executorCalls = 0;
    let approvalDetails;
    const { orchestrator } = createEditOrchestrator({
      plan: { risks: [{ level: 'critical', description: 'Potentially destructive scope' }] },
      orchestrator: {
        onApprovalRequired: async (item, plan, details) => {
          approvalDetails = details;
          return false;
        },
        stepExecutor: async () => {
          executorCalls++;
          return { success: true, stepId: 'step-1', output: {} };
        }
      }
    });
    const item = createWork(orchestrator);

    const result = await orchestrator.executeOne(item.id);

    assert.strictEqual(result.status, 'cancelled');
    assert.strictEqual(executorCalls, 0);
    assert.strictEqual(fs.readFileSync(path.join(TEST_DIR, 'target.txt'), 'utf8'), 'original');
    assert.strictEqual(approvalDetails.kind, 'plan');
    assert.ok(/^[a-f0-9]{64}$/.test(approvalDetails.planDigest));
    assert.ok(orchestrator.permissionManager.getAuditLog().some(entry =>
      entry.approval && entry.approval.outcome === 'denied'));
  });

  test('a changed approved plan is invalidated before execution', async () => {
    let executorCalls = 0;
    const { orchestrator } = createEditOrchestrator({
      plan: { risks: [{ level: 'high', description: 'Requires explicit approval' }] },
      orchestrator: {
        onApprovalRequired: async item => {
          item.plan = { ...item.plan, metadata: { requiresApproval: false } };
          return true;
        },
        stepExecutor: async () => {
          executorCalls++;
          return { success: true, stepId: 'step-1', output: {} };
        }
      }
    });
    const item = createWork(orchestrator);

    const result = await orchestrator.executeOne(item.id);

    assert.strictEqual(result.status, 'failed');
    assert.strictEqual(result.code, 'APPROVAL_INVALIDATED');
    assert.strictEqual(executorCalls, 0);
    assert.strictEqual(fs.readFileSync(path.join(TEST_DIR, 'target.txt'), 'utf8'), 'original');
  });

  test('broad plans require a plan-bound approval', async () => {
    let approvalDetails;
    const affectedFiles = Array.from({ length: 11 }, (_, index) => `src/file-${index}.js`);
    const { orchestrator } = createEditOrchestrator({
      plan: { affectedFiles },
      orchestrator: {
        onApprovalRequired: async (item, plan, details) => {
          approvalDetails = details;
          return true;
        },
        stepExecutor: async input => ({
          success: true,
          stepId: input.step.id,
          output: {}
        })
      }
    });
    const item = createWork(orchestrator);

    const result = await orchestrator.executeOne(item.id);

    assert.strictEqual(result.status, 'completed');
    assert.strictEqual(approvalDetails.kind, 'plan');
    assert.strictEqual(approvalDetails.planDigest, item.approval.planDigest);
  });

  test('destructive edits require approval bound to both plan and action digests', async () => {
    let approvalDetails;
    const { orchestrator } = createEditOrchestrator({
      orchestrator: {
        onApprovalRequired: async (item, plan, details) => {
          approvalDetails = details;
          return {
            approved: true,
            planDigest: details.planDigest,
            actionDigest: details.actionDigest
          };
        }
      }
    });
    const item = createWork(orchestrator);

    const result = await orchestrator.executeOne(item.id);

    assert.strictEqual(result.status, 'completed');
    assert.strictEqual(fs.readFileSync(path.join(TEST_DIR, 'target.txt'), 'utf8'), 'updated');
    assert.strictEqual(approvalDetails.kind, 'tool');
    assert.ok(/^[a-f0-9]{64}$/.test(approvalDetails.planDigest));
    assert.ok(/^[a-f0-9]{64}$/.test(approvalDetails.actionDigest));
    assert.ok(orchestrator.permissionManager.getAuditLog().some(entry =>
      entry.approval && entry.approval.outcome === 'approved' &&
      entry.approval.planDigest === approvalDetails.planDigest &&
      entry.approval.actionDigest === approvalDetails.actionDigest));
  });

  test('dependency-file creation requires explicit approval before the write', async () => {
    let approvalDetails;
    const toolRegistry = new ToolRegistry({ workspace: TEST_DIR });
    const orchestrator = new WorkOrchestrator({
      workspace: TEST_DIR,
      planner: createPlanner({ affectedFiles: ['package.json'] }),
      toolRegistry,
      onApprovalRequired: async (item, plan, details) => {
        approvalDetails = details;
        return false;
      },
      stepExecutor: async input => {
        await input.tools('edit_file', { path: 'package.json', content: '{"dependencies":{}}' });
        return { success: true, stepId: input.step.id, output: {} };
      }
    });
    const item = createWork(orchestrator);

    const result = await orchestrator.executeOne(item.id);

    assert.strictEqual(result.status, 'cancelled');
    assert.strictEqual(approvalDetails.kind, 'tool');
    assert.strictEqual(fs.existsSync(path.join(TEST_DIR, 'package.json')), false);
  });

  test('denying one tool action blocks subsequent writes in the same step', async () => {
    const toolRegistry = new ToolRegistry({ workspace: TEST_DIR });
    const orchestrator = new WorkOrchestrator({
      workspace: TEST_DIR,
      planner: createPlanner(),
      toolRegistry,
      onApprovalRequired: async () => false,
      stepExecutor: async input => {
        await input.tools('edit_file', {
          path: 'target.txt',
          expectedHash: crypto.createHash('sha256').update('original').digest('hex'),
          content: 'denied'
        });
        await input.tools('edit_file', { path: 'second.txt', content: 'must not be written' });
        return { success: true, stepId: input.step.id, output: {} };
      }
    });
    const item = createWork(orchestrator);

    const result = await orchestrator.executeOne(item.id);

    assert.strictEqual(result.status, 'cancelled');
    assert.strictEqual(fs.readFileSync(path.join(TEST_DIR, 'target.txt'), 'utf8'), 'original');
    assert.strictEqual(fs.existsSync(path.join(TEST_DIR, 'second.txt')), false);
  });

  test('sibling paths sharing the workspace prefix are denied', async () => {
    const registry = new ToolRegistry({ workspace: TEST_DIR });
    const siblingPath = path.join(`${TEST_DIR}-sibling`, 'outside.txt');
    const result = await registry.execute('read_file', {
      path: path.relative(TEST_DIR, siblingPath)
    });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.code, 'PATH_DENIED');
  });

  test('configured high-risk tool actions request approval', async () => {
    let approvalDetails;
    const toolRegistry = new ToolRegistry({ workspace: TEST_DIR });
    const orchestrator = new WorkOrchestrator({
      workspace: TEST_DIR,
      planner: createPlanner(),
      toolRegistry,
      permissionOptions: { highRiskActions: ['read_file'] },
      onApprovalRequired: async (item, plan, details) => {
        approvalDetails = details;
        return true;
      },
      stepExecutor: async input => {
        const result = await input.tools('read_file', { path: 'target.txt' });
        return { success: true, stepId: input.step.id, output: result.data };
      }
    });
    const item = createWork(orchestrator);

    const result = await orchestrator.executeOne(item.id);

    assert.strictEqual(result.status, 'completed');
    assert.strictEqual(approvalDetails.kind, 'tool');
    assert.strictEqual(approvalDetails.tool, 'read_file');
  });

  test('action changes while approval is pending invalidate consent without writing', async () => {
    const args = {
      path: 'target.txt',
      expectedHash: crypto.createHash('sha256').update('original').digest('hex'),
      content: 'approved content'
    };
    const { orchestrator } = createEditOrchestrator({
      args,
      orchestrator: {
        onApprovalRequired: async () => {
          await new Promise(resolve => setTimeout(resolve, 10));
          args.content = 'changed after approval request';
          return true;
        },
        approvalTimeoutMs: 100
      }
    });
    const item = createWork(orchestrator);

    const result = await orchestrator.executeOne(item.id);

    assert.strictEqual(result.status, 'cancelled');
    assert.strictEqual(fs.readFileSync(path.join(TEST_DIR, 'target.txt'), 'utf8'), 'original');
    assert.ok(orchestrator.permissionManager.getAuditLog().some(entry =>
      entry.approval && entry.approval.outcome === 'invalidated'));
  });

  test('approval timeout prevents writes and is recorded explicitly', async () => {
    const { orchestrator } = createEditOrchestrator({
      orchestrator: {
        approvalTimeoutMs: 20,
        onApprovalRequired: () => new Promise(() => {})
      }
    });
    const item = createWork(orchestrator);

    const result = await orchestrator.executeOne(item.id);

    assert.strictEqual(result.status, 'cancelled');
    assert.strictEqual(fs.readFileSync(path.join(TEST_DIR, 'target.txt'), 'utf8'), 'original');
    assert.ok(orchestrator.permissionManager.getAuditLog().some(entry =>
      entry.approval && entry.approval.outcome === 'timeout'));
  });

  test('cancellation during an approval prompt prevents the pending edit', async () => {
    let approvalStarted = false;
    const { orchestrator } = createEditOrchestrator({
      orchestrator: {
        approvalTimeoutMs: 1000,
        onApprovalRequired: () => {
          approvalStarted = true;
          return new Promise(() => {});
        }
      }
    });
    const item = createWork(orchestrator);
    const execution = orchestrator.executeOne(item.id);
    const startedAt = Date.now();
    while (!approvalStarted) {
      if (Date.now() - startedAt > 1000) throw new Error('approval request did not start');
      await new Promise(resolve => setTimeout(resolve, 5));
    }

    orchestrator.cancel(item.id);
    const result = await execution;

    assert.strictEqual(result.status, 'cancelled');
    assert.strictEqual(fs.readFileSync(path.join(TEST_DIR, 'target.txt'), 'utf8'), 'original');
    assert.ok(orchestrator.permissionManager.getAuditLog().some(entry =>
      entry.approval && entry.approval.outcome === 'cancelled'));
  });
});
