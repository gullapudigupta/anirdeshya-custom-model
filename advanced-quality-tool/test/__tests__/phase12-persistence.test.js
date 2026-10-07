'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { AgentRunStore } = require('../../src/agent/run-store');
const { WorkItem, WorkItemStatus } = require('../../src/agent/work-item');
const { CONTRACT_VERSION } = require('../../src/agent/contracts');
const { WorkOrchestrator } = require('../../src/agent/work-orchestrator');

describe('Phase 12 run persistence', () => {
  let workspace;

  beforeEach(() => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'aqt-p12-store-'));
  });

  afterEach(() => {
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  test('redacts credentials and omits source, patch, and tool output contents', () => {
    const store = new AgentRunStore({ workspace });
    const item = new WorkItem({ id: 'persist-run', description: 'Persist safely' });
    item.context = { files: [{ path: 'source.js', content: 'const privateSource = 42;' }] };
    item.output = {
      results: { implementation: 'const generatedSource = 43;' },
      appliedPatches: [{ path: 'source.js', type: 'modify', unifiedDiff: '-private source\n+new private source\n' }]
    };
    item.toolCalls = [{ tool: 'read_file', output: { content: 'private file contents' } }];
    item.events.push({ type: 'provider', metadata: { apiKey: 'sk-test-secret' } });

    const recordPath = store.save(item);
    const serialized = fs.readFileSync(recordPath, 'utf8');

    for (const privateValue of [
      'const privateSource = 42;',
      'const generatedSource = 43;',
      'private file contents',
      'new private source',
      'sk-test-secret'
    ]) {
      assert.ok(!serialized.includes(privateValue), `persisted record leaked ${privateValue}`);
    }
    assert.match(serialized, /sha256/);
    assert.match(serialized, /\[REDACTED\]/);
    assert.strictEqual(store.load(item.id).status, 'loaded');
    assert.strictEqual(store.load(item.id).resumable, true);
    assert.strictEqual(store.load(item.id).item.status, WorkItemStatus.QUEUED);
  });

  test('loads a complete run only while checkpoint workspace hashes remain current', () => {
    const filePath = path.join(workspace, 'changed.js');
    fs.writeFileSync(filePath, 'verified\n');
    const fileHash = crypto.createHash('sha256').update('verified\n').digest('hex');
    const item = new WorkItem({ id: 'verified-run', description: 'Verified result' });
    item.status = WorkItemStatus.COMPLETED;
    item.changedFiles = ['changed.js'];
    item.output = { verifiedChangedFiles: ['changed.js'], appliedPatches: [] };
    item.verificationResults = {
      schemaVersion: CONTRACT_VERSION,
      checks: { test: { status: 'passed', required: true } }
    };
    const store = new AgentRunStore({ workspace });
    store.save(item, { workspaceHashes: { 'changed.js': fileHash } });

    assert.strictEqual(store.validateResume(item.id).status, 'loaded');
    fs.writeFileSync(filePath, 'changed after checkpoint\n');
    assert.strictEqual(store.validateResume(item.id).status, 'recovery-required');
  });

  test('resumes a validated incomplete run without resetting its budgets or approving old plans', async () => {
    const filePath = path.join(workspace, 'source.js');
    fs.writeFileSync(filePath, 'before resume\n');
    const originalHash = crypto.createHash('sha256').update('before resume\n').digest('hex');
    const store = new AgentRunStore({ workspace });
    const checkpoint = new WorkItem({
      id: 'resume-run',
      taskId: 'resume-task',
      description: 'Resume a bounded implementation',
      files: ['source.js'],
      acceptanceCriteria: ['The resumed content is written'],
      taskContract: {
        schemaVersion: CONTRACT_VERSION,
        id: 'resume-task',
        description: 'Resume a bounded implementation',
        files: ['source.js'],
        acceptanceCriteria: ['The resumed content is written']
      },
      maxRetries: 3,
      repairTokensUsed: 50,
      repairCostUsed: 0.01,
      toolBudgetUsed: { calls: 3, outputBytes: 256 }
    });
    checkpoint.status = WorkItemStatus.WORKING;
    checkpoint.retryCount = 1;
    checkpoint.plan = { planVersion: 1, affectedFiles: ['source.js'] };
    checkpoint.approval = { planDigest: 'old-approved-digest' };
    store.save(checkpoint, { workspaceHashes: { 'source.js': originalHash } });

    const planner = {
      plan: async () => ({
        schemaVersion: CONTRACT_VERSION,
        planVersion: 1,
        steps: [{ id: 'edit', description: 'Update the file', dependencies: [] }],
        affectedFiles: ['source.js'],
        expectedChecks: [{ type: 'test', required: true }],
        verificationCommands: [{ checkId: 'test' }],
        acceptanceCriteria: ['The resumed content is written'],
        risks: [],
        metadata: { requiresApproval: false }
      }),
      validatePlan: () => ({ valid: true, issues: [] })
    };
    const orchestrator = new WorkOrchestrator({
      workspace,
      runStore: store,
      planner,
      toolRegistry: null,
      executor: async ({ step, context }) => ({
        success: true,
        stepId: step.id,
        usage: { inputTokens: 20, outputTokens: 10 },
        patches: [{
          schemaVersion: CONTRACT_VERSION,
          path: 'source.js',
          operation: 'modify',
          expectedHash: context.files[0].hash,
          content: 'after resume\n'
        }]
      }),
      checkRunner: { run: async id => ({ id, status: 'passed', exitCode: 0 }) },
      onApprovalRequired: async () => true
    });

    const resumed = orchestrator.resumeFromCheckpoint(checkpoint.id);
    assert.strictEqual(resumed.status, WorkItemStatus.QUEUED);
    assert.strictEqual(resumed.retryCount, 1);
    assert.strictEqual(resumed.repairTokensUsed, 50);
    assert.strictEqual(resumed._toolBudgetUsed.calls, 3);
    assert.strictEqual(resumed.approval, null);
    assert.strictEqual(resumed.plan, null);

    const result = await orchestrator.executeOne(resumed.id);
    assert.strictEqual(result.status, 'completed');
    assert.strictEqual(fs.readFileSync(filePath, 'utf8'), 'after resume\n');
    assert.strictEqual(store.validateResume(resumed.id).resumable, false);
    assert.throws(
      () => new WorkOrchestrator({ workspace, runStore: store }).resumeFromCheckpoint(resumed.id),
      /terminal work item/
    );
  });

  test('returns an explicit recovery state for malformed or tampered checkpoint records', () => {
    const store = new AgentRunStore({ workspace });
    const recordPath = store.save(new WorkItem({
      id: 'corrupt-run',
      description: 'Corrupt checkpoint'
    }));
    fs.writeFileSync(recordPath, '{"payload":');
    assert.strictEqual(store.load('corrupt-run').status, 'recovery-required');
  });

  test('rejects symlinked run storage outside the workspace', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'aqt-p12-store-outside-'));
    try {
      fs.symlinkSync(outside, path.join(workspace, '.aqt-reports'), 'junction');
      const store = new AgentRunStore({ workspace });
      assert.throws(() => store.save(new WorkItem({
        id: 'escaped-run',
        description: 'Must not persist outside the workspace'
      })), /symbolic link/);
      assert.deepStrictEqual(fs.readdirSync(outside), []);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});
