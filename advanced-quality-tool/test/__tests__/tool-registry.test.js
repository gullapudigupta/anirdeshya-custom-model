/**
 * Tests for ToolRegistry (P12-T003)
 *
 * Covers: exposed-tool allowlisting, unknown/invalid-argument handling,
 * hash-guarded edits, the allowlisted check runner (no shell text), and
 * get_diagnostics never claiming zero issues when diagnostics were not
 * actually collected.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ToolRegistry } = require('../../src/agent/tool-registry');

let TEST_DIR;

function sha256(content) {
  return require('crypto').createHash('sha256').update(content, 'utf8').digest('hex');
}

describe('ToolRegistry exposed tool surface', () => {
  beforeEach(() => {
    TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aqt-tool-registry-'));
  });

  afterEach(() => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  test('only exposes read/search/edit/check tools to model execution', () => {
    const registry = new ToolRegistry({ workspace: TEST_DIR });
    const exposedNames = registry.listExposedTools().map(t => t.name).sort();

    assert.deepStrictEqual(exposedNames, [
      'edit_file',
      'get_diagnostics',
      'list_files',
      'read_file',
      'run_check',
      'search_files',
      'search_text'
    ]);
  });

  test('does not expose execute_command and has no tool that runs arbitrary shell text', () => {
    const registry = new ToolRegistry({ workspace: TEST_DIR });
    const allNames = registry.listTools().map(t => t.name);

    assert.ok(!allNames.includes('execute_command'), 'execute_command must not be registered at all');
    const exposed = registry.listExposedTools();
    for (const tool of exposed) {
      const paramNames = Object.keys(tool.parameters || {});
      assert.ok(!paramNames.includes('command'), `exposed tool '${tool.name}' must not accept a shell command parameter`);
    }
  });

  test('write_file remains registered for internal use but is not exposed', () => {
    const registry = new ToolRegistry({ workspace: TEST_DIR });
    const all = registry.listTools();
    const writeFile = all.find(t => t.name === 'write_file');
    assert.ok(writeFile, 'write_file should still be registered');
    assert.strictEqual(writeFile.exposed, false);
    assert.ok(!registry.listExposedTools().some(t => t.name === 'write_file'));
  });

  test('unknown tool calls are explicit, not thrown', async () => {
    const registry = new ToolRegistry({ workspace: TEST_DIR });
    const result = await registry.execute('delete_everything', {});
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.code, 'UNKNOWN_TOOL');
  });

  test('invalid arguments are explicit, not thrown', async () => {
    const registry = new ToolRegistry({ workspace: TEST_DIR });
    const result = await registry.execute('read_file', {});
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.code, 'INVALID_ARGUMENTS');
  });

  test('tool execution is rejected for paths outside the workspace', async () => {
    const registry = new ToolRegistry({ workspace: TEST_DIR });
    const result = await registry.execute('read_file', { path: '../outside.txt' });
    assert.strictEqual(result.success, false);
  });
});

describe('ToolRegistry edit_file hash guard', () => {
  beforeEach(() => {
    TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aqt-tool-registry-edit-'));
  });

  afterEach(() => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  test('creates a new file when no expectedHash is supplied', async () => {
    const registry = new ToolRegistry({ workspace: TEST_DIR });
    const result = await registry.execute('edit_file', { path: 'new.txt', content: 'hello' });
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.data.created, true);
    assert.strictEqual(fs.readFileSync(path.join(TEST_DIR, 'new.txt'), 'utf8'), 'hello');
  });

  test('rejects creating a file that already exists without a hash', async () => {
    fs.writeFileSync(path.join(TEST_DIR, 'existing.txt'), 'original');
    const registry = new ToolRegistry({ workspace: TEST_DIR });
    const result = await registry.execute('edit_file', { path: 'existing.txt', content: 'overwritten' });
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.code, 'HASH_REQUIRED');
    assert.strictEqual(fs.readFileSync(path.join(TEST_DIR, 'existing.txt'), 'utf8'), 'original');
  });

  test('applies the edit when expectedHash matches the current file content', async () => {
    const filePath = path.join(TEST_DIR, 'existing.txt');
    fs.writeFileSync(filePath, 'original');
    const registry = new ToolRegistry({ workspace: TEST_DIR });

    const read = await registry.execute('read_file', { path: 'existing.txt' });
    assert.strictEqual(read.data.fileHash, sha256('original'));

    const edit = await registry.execute('edit_file', {
      path: 'existing.txt',
      expectedHash: read.data.fileHash,
      content: 'updated'
    });
    assert.strictEqual(edit.success, true);
    assert.strictEqual(fs.readFileSync(filePath, 'utf8'), 'updated');
  });

  test('rejects the edit when the file changed since it was read (stale hash)', async () => {
    const filePath = path.join(TEST_DIR, 'existing.txt');
    fs.writeFileSync(filePath, 'original');
    const registry = new ToolRegistry({ workspace: TEST_DIR });

    const read = await registry.execute('read_file', { path: 'existing.txt' });

    // Simulate a concurrent change after the read.
    fs.writeFileSync(filePath, 'changed-by-someone-else');

    const edit = await registry.execute('edit_file', {
      path: 'existing.txt',
      expectedHash: read.data.fileHash,
      content: 'should-not-apply'
    });

    assert.strictEqual(edit.success, false);
    assert.strictEqual(edit.code, 'STALE_FILE');
    assert.strictEqual(fs.readFileSync(filePath, 'utf8'), 'changed-by-someone-else');
  });
});

describe('ToolRegistry run_check allowlist', () => {
  beforeEach(() => {
    TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aqt-tool-registry-check-'));
  });

  afterEach(() => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  test('rejects unknown check ids explicitly', async () => {
    const registry = new ToolRegistry({ workspace: TEST_DIR });
    const result = await registry.execute('run_check', { checkId: 'rm -rf /' });
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.code, 'UNKNOWN_CHECK');
  });

  test('does not accept a command/shell-text argument at all', () => {
    const registry = new ToolRegistry({ workspace: TEST_DIR });
    const runCheck = registry.getTool('run_check');
    assert.ok(!Object.keys(runCheck.parameters).includes('command'));
  });

  test('reports a check unavailable rather than fabricating a pass when not configured', async () => {
    // No package.json in this empty workspace, so the "build" and "test" npm-script
    // checks must be explicit about being unavailable, never silently "passed".
    const registry = new ToolRegistry({ workspace: TEST_DIR });
    const result = await registry.execute('run_check', { checkId: 'build' });
    assert.strictEqual(result.success, true); // the tool call itself succeeded
    assert.strictEqual(result.data.available, false);
    assert.ok(result.data.reason);
  });

  test('runs a configured npm script check through a fixed argv, not shell text', async () => {
    fs.writeFileSync(path.join(TEST_DIR, 'package.json'), JSON.stringify({
      name: 'fixture',
      scripts: { test: 'node -e "console.log(1)"' }
    }));
    const registry = new ToolRegistry({ workspace: TEST_DIR, checkTimeout: 15000 });
    const result = await registry.execute('run_check', { checkId: 'test' });
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.data.available, true);
    assert.strictEqual(result.data.passed, true);
  });

  test('check runners are injectable for deterministic testing', async () => {
    const registry = new ToolRegistry({
      workspace: TEST_DIR,
      checkRunners: {
        lint: async () => ({ checkId: 'lint', available: true, passed: false, summary: { total: 2, errors: 1, warnings: 1 } })
      }
    });
    const result = await registry.execute('run_check', { checkId: 'lint' });
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.data.passed, false);
    assert.strictEqual(result.data.summary.total, 2);
  });
});

describe('ToolRegistry get_diagnostics', () => {
  beforeEach(() => {
    TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aqt-tool-registry-diag-'));
  });

  afterEach(() => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  test('reports unavailable instead of zero issues when no linters are configured', async () => {
    const registry = new ToolRegistry({ workspace: TEST_DIR });
    const result = await registry.execute('get_diagnostics', { files: [] });
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.data.available, false);
    assert.strictEqual(result.data.diagnostics, null);
    assert.strictEqual(result.data.summary, null);
    assert.ok(result.data.reason);
  });

  test('collects real diagnostics from an available linter instead of a stub result', async () => {
    // Make ESLintIntegration.isAvailable() detect a linter by creating the
    // node_modules/.bin shim it looks for, and have that shim emit real
    // ESLint-shaped JSON so the orchestrator path is exercised end-to-end.
    const binDir = path.join(TEST_DIR, 'node_modules', '.bin');
    fs.mkdirSync(binDir, { recursive: true });
    const eslintJson = JSON.stringify([
      {
        filePath: path.join(TEST_DIR, 'src', 'app.js'),
        messages: [
          { ruleId: 'no-unused-vars', severity: 2, message: 'unused var', line: 1, column: 1 }
        ]
      }
    ]);

    if (process.platform === 'win32') {
      // Write the JSON payload to its own file and have the shim cat it out,
      // sidestepping cmd.exe's awkward quote-escaping rules for `echo`.
      const payloadPath = path.join(binDir, 'eslint-output.json');
      fs.writeFileSync(payloadPath, eslintJson);
      fs.writeFileSync(path.join(binDir, 'eslint.cmd'), `@type "${payloadPath}"\r\n`);
    } else {
      const shimPath = path.join(binDir, 'eslint');
      fs.writeFileSync(shimPath, `#!/bin/sh\ncat <<'EOF'\n${eslintJson}\nEOF\n`);
      fs.chmodSync(shimPath, 0o755);
    }

    // LinterIntegration.exec() spawns the bare binary name and relies on PATH
    // resolution (not an explicit node_modules/.bin path), so the shim must
    // be discoverable on PATH for this process's children.
    const originalPath = process.env.PATH;
    process.env.PATH = `${binDir}${path.delimiter}${originalPath}`;

    let result;
    try {
      const registry = new ToolRegistry({ workspace: TEST_DIR });
      result = await registry.execute('get_diagnostics', { files: [] });
    } finally {
      process.env.PATH = originalPath;
    }

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.data.available, true, 'should detect the shimmed eslint binary as an available linter');
    assert.ok(Array.isArray(result.data.diagnostics));
    assert.ok(result.data.diagnostics.length > 0, 'should return real diagnostics collected from the linter, not a fabricated empty result');
    assert.ok(result.data.summary);
    assert.strictEqual(result.data.summary.total, result.data.diagnostics.length);
  });
});


describe('ToolRegistry execution logging', () => {
  beforeEach(() => {
    TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aqt-tool-registry-log-'));
  });

  afterEach(() => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  test('logs correlate tool executions with task and step context', async () => {
    const registry = new ToolRegistry({ workspace: TEST_DIR });
    fs.writeFileSync(path.join(TEST_DIR, 'a.txt'), 'content');
    await registry.execute('read_file', { path: 'a.txt' }, { itemId: 'item-1', taskId: 'task-1', stepId: 'step-1' });

    const log = registry.getExecutionLog();
    const entry = log[log.length - 1];
    assert.strictEqual(entry.tool, 'read_file');
    assert.strictEqual(entry.itemId, 'item-1');
    assert.strictEqual(entry.taskId, 'task-1');
    assert.strictEqual(entry.stepId, 'step-1');
    assert.strictEqual(entry.success, true);
    assert.ok(typeof entry.duration === 'number');
  });
});
