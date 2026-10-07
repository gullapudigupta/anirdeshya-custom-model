'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { CodeGenerator } = require('../../src/agent/code-generator');
const { DiffReviewSystem, hashContent } = require('../../src/agent/diff-review-system');

describe('reviewable workspace patches (P12-T006)', () => {
  let workspace;
  let outside;

  beforeEach(() => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'aqt-p12-t006-'));
    outside = fs.mkdtempSync(path.join(os.tmpdir(), 'aqt-p12-t006-outside-'));
  });

  afterEach(() => {
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });

  function createGenerator(operations, maxChangedFiles, permissionOptions = {}) {
    return new CodeGenerator({
      workspace,
      maxChangedFiles,
      permissionOptions,
      modelExecutor: {
        generatePatches: async input => {
          assert.deepStrictEqual(input.limits, { maxChangedFiles: maxChangedFiles || 20 });
          return { operations };
        }
      }
    });
  }

  function createPlan(files) {
    return {
      planVersion: 1,
      steps: [{ id: 'implement', description: 'Implement task' }],
      affectedFiles: files,
      newFiles: [],
      modifiedFiles: [],
      risks: [],
      metadata: { requiresApproval: true }
    };
  }

  async function generate(generator, files) {
    return generator.generate({
      id: 'patch-task',
      description: 'Implement the requested change',
      deliverables: ['Implement the requested change'],
      acceptanceCriteria: ['The requested file changes are present']
    }, { plan: createPlan(files) });
  }

  test('generates create, modify, and delete operations and applies review-approved contents', async () => {
    fs.mkdirSync(path.join(workspace, 'src'));
    fs.writeFileSync(path.join(workspace, 'src', 'edit.js'), 'module.exports = 1;\n');
    fs.writeFileSync(path.join(workspace, 'src', 'remove.js'), 'remove me\n');
    const operations = [
      { type: 'create', filePath: 'src/new.js', content: 'module.exports = 2;\n', reason: 'Add module' },
      { type: 'modify', filePath: 'src/edit.js', content: 'module.exports = 3;\n', reason: 'Update module' },
      { type: 'delete', filePath: 'src/remove.js', reason: 'Remove obsolete module' }
    ];
    const generator = createGenerator(operations, undefined, { allowDeletes: true });
    const result = await generate(generator, operations.map(operation => operation.filePath));

    assert.strictEqual(result.success, true);
    assert.deepStrictEqual(result.patches.map(patch => patch.type), ['create', 'modify', 'delete']);
    assert.strictEqual(result.patches[1].expectedHash, hashContent('module.exports = 1;\n'));

    let approvalRequest;
    const applied = await generator.applyPatches(result, {
      approvalGate: async request => {
        approvalRequest = request;
        return {
          approved: true,
          planDigest: request.planDigest,
          patchDigest: request.patchDigest
        };
      }
    });

    assert.strictEqual(approvalRequest.review.summary.total, 3);
    assert.ok(approvalRequest.review.files.every(file => file.diff.includes('@@')));
    assert.strictEqual(applied.success, true);
    assert.strictEqual(fs.readFileSync(path.join(workspace, 'src', 'new.js'), 'utf8'), 'module.exports = 2;\n');
    assert.strictEqual(fs.readFileSync(path.join(workspace, 'src', 'edit.js'), 'utf8'), 'module.exports = 3;\n');
    assert.strictEqual(fs.existsSync(path.join(workspace, 'src', 'remove.js')), false);
    assert.ok(generator.permissionManager.getAuditLog().some(entry =>
      entry.approval && entry.approval.outcome === 'approved'));
  });

  test('denied or mismatched plan/patch approval causes no workspace mutation', async () => {
    const generator = createGenerator([
      { type: 'create', filePath: 'created.js', content: 'module.exports = true;\n' }
    ]);
    const result = await generate(generator, ['created.js']);
    const denied = await generator.applyPatches(result, {
      approvalGate: async request => ({
        approved: true,
        planDigest: request.planDigest,
        patchDigest: 'wrong-digest'
      })
    });
    assert.strictEqual(denied.success, false);
    assert.strictEqual(denied.code, 'APPROVAL_DENIED');
    assert.strictEqual(fs.existsSync(path.join(workspace, 'created.js')), false);
  });

  test('stale source returns a conflict without overwriting user edits', async () => {
    fs.writeFileSync(path.join(workspace, 'source.js'), 'original\n');
    const generator = createGenerator([
      { type: 'modify', filePath: 'source.js', content: 'generated\n' }
    ]);
    const result = await generate(generator, ['source.js']);
    fs.writeFileSync(path.join(workspace, 'source.js'), 'user edit\n');
    let approvalCalls = 0;

    const applied = await generator.applyPatches(result, {
      approvalGate: async request => {
        approvalCalls++;
        return {
          approved: true,
          planDigest: request.planDigest,
          patchDigest: request.patchDigest
        };
      }
    });

    assert.strictEqual(applied.success, false);
    assert.strictEqual(applied.code, 'PATCH_CONFLICT');
    assert.strictEqual(approvalCalls, 0);
    assert.strictEqual(fs.readFileSync(path.join(workspace, 'source.js'), 'utf8'), 'user edit\n');
  });

  test('rejects traversal and symlink escape paths during generation', async () => {
    const traversal = createGenerator([
      { type: 'create', filePath: '../outside.js', content: 'unsafe\n' }
    ]);
    const traversalResult = await generate(traversal, ['../outside.js']);
    assert.strictEqual(traversalResult.success, false);
    assert.match(traversalResult.error, /outside workspace boundaries/);

    const linkPath = path.join(workspace, 'escape');
    fs.symlinkSync(outside, linkPath, 'junction');
    const linkedFile = path.join(outside, 'escape.js');
    fs.writeFileSync(linkedFile, 'outside\n');
    const symlinkGenerator = createGenerator([
      { type: 'modify', filePath: 'escape/escape.js', content: 'changed\n' }
    ]);
    const symlinkResult = await generate(symlinkGenerator, ['escape/escape.js']);
    assert.strictEqual(symlinkResult.success, false);
    assert.match(symlinkResult.error, /symbolic link|symlink/i);
    assert.strictEqual(fs.readFileSync(linkedFile, 'utf8'), 'outside\n');
  });

  test('rejects empty, malformed, conflicting, scaffold-only, and over-limit model patches', async () => {
    const invalidCases = [
      { operations: [] , files: ['one.js'], error: /non-empty structured operations/ },
      { operations: [{ type: 'modify', filePath: 'one.js', content: 'x' }], files: ['one.js'], error: /does not exist/ },
      { operations: [{ type: 'create', filePath: 'one.js', content: '' }], files: ['one.js'], error: /Empty create/ },
      { operations: [{ type: 'move', filePath: 'one.js', content: 'x' }], files: ['one.js'], error: /malformed patch operation/ },
      { operations: [{ type: 'create', filePath: 'one.js', content: 'TODO: Implement functionality' }], files: ['one.js'], error: /Scaffold-only/ },
      {
        operations: [
          { type: 'create', filePath: 'one.js', content: 'module.exports = 1;' },
          { type: 'create', filePath: 'one.js', content: 'module.exports = 2;' }
        ],
        files: ['one.js'],
        error: /Conflicting patch operations/
      }
    ];
    for (const invalidCase of invalidCases) {
      const result = await generate(createGenerator(invalidCase.operations), invalidCase.files);
      assert.strictEqual(result.success, false);
      assert.match(result.error, invalidCase.error);
    }

    const limited = createGenerator([
      { type: 'create', filePath: 'one.js', content: 'one\n' },
      { type: 'create', filePath: 'two.js', content: 'two\n' }
    ], 1);
    const limitedResult = await generate(limited, ['one.js', 'two.js']);
    assert.strictEqual(limitedResult.success, false);
    assert.match(limitedResult.error, /Changed-file limit/);
  });

  test('DiffReviewSystem rejects an incorrect source hash before adding a patch', () => {
    fs.writeFileSync(path.join(workspace, 'source.js'), 'actual\n');
    const system = new DiffReviewSystem({ workspace });
    assert.throws(() => system.addPatch({
      type: 'modify',
      filePath: 'source.js',
      originalContent: 'actual\n',
      modifiedContent: 'new\n',
      expectedHash: hashContent('different\n')
    }, { planDigest: 'a'.repeat(64), patchDigest: 'b'.repeat(64) }),
    /Expected content hash does not match/);
  });

  test('validation rejects malformed patch containers without throwing', () => {
    const generator = createGenerator([]);
    assert.strictEqual(generator.validate(null).valid, false);
    assert.strictEqual(generator.validate({
      plan: createPlan(['source.js']),
      patches: [null],
      traceability: { taskId: 'patch-task' }
    }).valid, false);
  });

  test('DiffReviewSystem refuses to apply a structured patch without bound approval', async () => {
    const system = new DiffReviewSystem({ workspace });
    system.addPatch({
      type: 'create',
      filePath: 'protected.js',
      originalContent: null,
      modifiedContent: 'approved content\n'
    }, { planDigest: 'a'.repeat(64), patchDigest: 'b'.repeat(64) });

    await assert.rejects(system.applyDiff(0), /requires approval bound to its plan and patch digests/);
    assert.strictEqual(fs.existsSync(path.join(workspace, 'protected.js')), false);
  });

  test('PermissionManager denial blocks a patch before approval is requested', async () => {
    fs.writeFileSync(path.join(workspace, 'delete-me.js'), 'keep unless allowed\n');
    const generator = createGenerator([
      { type: 'delete', filePath: 'delete-me.js' }
    ]);
    const result = await generate(generator, ['delete-me.js']);
    let approvalCalls = 0;
    const applied = await generator.applyPatches(result, {
      approvalGate: async () => {
        approvalCalls++;
        return { approved: true };
      }
    });

    assert.strictEqual(applied.success, false);
    assert.strictEqual(applied.code, 'PERMISSION_DENIED');
    assert.strictEqual(approvalCalls, 0);
    assert.strictEqual(fs.readFileSync(path.join(workspace, 'delete-me.js'), 'utf8'), 'keep unless allowed\n');
  });

  test('invalidates approval if the plan or operations change while the gate is pending', async () => {
    const generator = createGenerator([
      { type: 'create', filePath: 'approved.js', content: 'approved\n' }
    ]);
    const result = await generate(generator, ['approved.js']);
    const outcome = await generator.applyPatches(result, {
      approvalGate: async request => {
        result.plan.affectedFiles.push('unapproved.js');
        return {
          approved: true,
          planDigest: request.planDigest,
          patchDigest: request.patchDigest
        };
      }
    });
    assert.strictEqual(outcome.code, 'APPROVAL_INVALIDATED');
    assert.strictEqual(fs.existsSync(path.join(workspace, 'approved.js')), false);
  });
});
