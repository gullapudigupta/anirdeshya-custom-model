'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const {
  validateTaskContract,
  validatePlan,
  validatePatch,
  validateVerification,
  validateApproval,
  validateCompletion,
  WorkResultStatus
} = require('../../src/agent/contracts');
const { WorkspaceContext } = require('../../src/agent/workspace-context');
const { ConfiguredCheckRunner } = require('../../src/agent/check-runner');
const { VerificationRepairLoop, VerificationStates } = require('../../src/agent/verification-repair-loop');

describe('Phase 12 execution contracts', () => {
  test('rejects missing task descriptions and malformed acceptance criteria', () => {
    assert.strictEqual(validateTaskContract({
      schemaVersion: 1,
      description: ' ',
      acceptanceCriteria: ['criterion', ' CRITERION ']
    }).valid, false);
    assert.strictEqual(validateTaskContract({
      schemaVersion: 1,
      description: 'Implement a bounded feature',
      acceptanceCriteria: ['criterion']
    }).valid, true);
  });

  test('requires actionable steps, scoped files, checks, and approval metadata', () => {
    const validPlan = {
      schemaVersion: 1,
      steps: [{ id: 'edit', description: 'Implement change', dependencies: [] }],
      affectedFiles: ['src/example.js'],
      expectedChecks: [{ type: 'test', required: true }],
      metadata: { requiresApproval: false }
    };
    assert.strictEqual(validatePlan(validPlan).valid, true);
    assert.strictEqual(validatePlan({ ...validPlan, expectedChecks: [] }).valid, false);
    assert.strictEqual(validatePlan({
      ...validPlan,
      steps: [{ id: 'edit', description: 'Implement change', dependencies: ['missing'] }]
    }).valid, false);
  });

  test('does not accept scaffold or incomplete verification as completion', () => {
    const result = {
      schemaVersion: 1,
      status: WorkResultStatus.COMPLETED,
      changedFiles: ['src/example.js'],
      verifiedChangedFiles: ['src/example.js'],
      verification: { schemaVersion: 1, checks: { test: { status: 'passed', required: true } } }
    };
    assert.strictEqual(validateCompletion(result).valid, true);
    assert.strictEqual(validateCompletion({
      ...result,
      verification: { schemaVersion: 1, checks: { test: { status: 'unavailable', required: true } } }
    }).valid, false);
    assert.strictEqual(validateCompletion({ ...result, scaffold: true }).valid, false);
    for (const status of [WorkResultStatus.INCOMPLETE, WorkResultStatus.BLOCKED, WorkResultStatus.DENIED, WorkResultStatus.FAILED]) {
      assert.strictEqual(validateCompletion({ ...result, status }).valid, false);
    }
  });

  test('validates versioned patch, verification, and approval structures', () => {
    const digest = 'a'.repeat(64);
    assert.strictEqual(validatePatch({
      schemaVersion: 1,
      path: 'src/example.js',
      operation: 'modify',
      expectedHash: digest,
      content: 'updated'
    }).valid, true);
    assert.strictEqual(validatePatch({
      schemaVersion: 1,
      path: '../outside.js',
      operation: 'modify',
      expectedHash: digest,
      content: 'updated'
    }).valid, false);
    assert.strictEqual(validatePatch({
      schemaVersion: 1,
      path: 'src/empty.js',
      operation: 'create',
      expectedHash: null,
      content: '  '
    }).valid, false);
    assert.strictEqual(validatePatch({
      schemaVersion: 1,
      path: 'src/stub.js',
      operation: 'create',
      expectedHash: null,
      content: '// TODO: Implement functionality'
    }).valid, false);
    assert.strictEqual(validateVerification({
      schemaVersion: 1,
      checks: { test: { status: 'passed', required: true } }
    }).valid, true);
    assert.strictEqual(validateApproval({
      schemaVersion: 1,
      status: 'approved',
      planDigest: digest,
      patchDigest: digest
    }).valid, true);
  });

  test('accepts a real passing VerificationRepairLoop result', async () => {
    const loop = new VerificationRepairLoop({
      testRunner: { run: async () => ({ failed: 0, command: 'configured test', exitCode: 0 }) }
    });
    const verification = await loop.verify({ workspace: process.cwd() }, ['test']);
    assert.strictEqual(verification.overall, VerificationStates.PASS);
    assert.strictEqual(validateCompletion({
      schemaVersion: 1,
      status: WorkResultStatus.COMPLETED,
      changedFiles: ['src/example.js'],
      verifiedChangedFiles: ['src/example.js'],
      verification: { ...verification, checks: Object.fromEntries(Object.entries(verification.checks).map(([id, check]) => [
        id,
        { status: check.status, required: check.required }
      ])) }
    }).valid, true);
  });
});

describe('Phase 12 bounded workspace context', () => {
  test('collects hashes and enforces token budgets with explicit provenance', () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'aqt-context-'));
    try {
      fs.writeFileSync(path.join(workspace, 'a.js'), 'abcd', 'utf8');
      fs.writeFileSync(path.join(workspace, 'b.js'), 'more than the budget', 'utf8');
      const context = new WorkspaceContext({
        workspace,
        maxTokens: 4,
        countTokens: content => content.length
      }).collect(['a.js', 'b.js', 'missing.js']);
      assert.strictEqual(context.files.length, 1);
      assert.strictEqual(context.files[0].path, 'a.js');
      assert.strictEqual(context.files[0].hash, crypto.createHash('sha256').update('abcd').digest('hex'));
      assert.strictEqual(context.totalTokens, 4);
      assert.deepStrictEqual(context.truncated, [{ path: 'b.js', reason: 'context token limit exceeded' }]);
      assert.deepStrictEqual(context.missing, ['missing.js']);
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  test('rejects paths outside the workspace', () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'aqt-context-'));
    try {
      assert.throws(() => new WorkspaceContext({ workspace }).collect(['../outside.js']), /outside the workspace/);
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });
});

describe('Configured verification checks', () => {
  test('runs only configured command IDs without a shell', async () => {
    const runner = new ConfiguredCheckRunner({
      workspace: process.cwd(),
      checks: {
        node: { command: process.execPath, args: ['-e', 'process.stdout.write("ok")'] }
      }
    });
    const passed = await runner.run('node');
    const unavailable = await runner.run('untrusted command');
    assert.strictEqual(passed.status, 'passed');
    assert.strictEqual(passed.output, 'ok');
    assert.strictEqual(unavailable.status, 'unavailable');
    assert.strictEqual((await runner.run('node; malicious')).status, 'unavailable');
  });

  test('bounds, redacts, and times out configured verification output', async () => {
    const runner = new ConfiguredCheckRunner({
      workspace: process.cwd(),
      timeoutMs: 5000,
      maxOutputBytes: 64,
      checks: {
        redact: {
          command: process.execPath,
          args: ['-e', "process.stdout.write('API_KEY=supersecret')"]
        },
        timeout: {
          command: process.execPath,
          args: ['-e', 'setInterval(() => {}, 1000)'],
          timeoutMs: 30
        }
      }
    });
    const redacted = await runner.run('redact');
    const timedOut = await runner.run('timeout');
    assert.strictEqual(redacted.status, 'passed');
    assert.ok(!redacted.output.includes('supersecret'));
    assert.ok(redacted.output.includes('[REDACTED]'));
    assert.strictEqual(timedOut.status, 'timed-out');
  });

  test('does not mark unavailable required checks as passed', async () => {
    const loop = new VerificationRepairLoop();
    const result = await loop.verify({ workspace: process.cwd() }, ['test']);
    assert.strictEqual(result.checks.test.state, VerificationStates.SKIPPED);
    assert.strictEqual(result.overall, VerificationStates.SKIPPED);
  });
});
