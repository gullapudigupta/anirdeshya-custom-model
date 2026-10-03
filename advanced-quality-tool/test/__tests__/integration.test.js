/**
 * Integration Tests — end-to-end analyze -> fix workflow (P1-T017)
 *
 * These tests exercise the real fixer stack against real files on disk, wired
 * exactly as the CLI wires them, but kept fully offline and deterministic:
 *   - No network, no external linter binaries. The PatternFixer performs pure
 *     regex transforms, so a real (non-dry-run) fix can be verified on disk.
 *   - All file I/O happens inside a per-test sandbox under os.tmpdir(), removed
 *     in afterEach so nothing leaks into the workspace.
 *
 * Coverage:
 *   1. Dry-run orchestration reports fixes without touching the file.
 *   2. Real fix normalizes file content (analyze -> fix -> verify on disk).
 *   3. Backup + rollback restores the original file end-to-end.
 *   4. Stats reflect the processed run.
 *   5. Mixed fixable/unfixable issues -> unfixable surfaces as remaining.
 *
 * @module test/integration
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { AutoFixEngine } = require('../../src/fixers/auto-fix-engine');
const { PatternFixer } = require('../../src/fixers/rule-based-fixer');

/**
 * A messy source file that the PatternFixer can normalize deterministically:
 *   - CRLF line endings          -> LF
 *   - trailing whitespace        -> removed
 *   - 3+ consecutive blank lines -> collapsed to one blank line
 *   - comma with no following space -> ", "
 */
const MESSY_CONTENT =
  'const a = 1;   \r\n' +
  'const list = [1,2,3];\r\n' +
  '\r\n' +
  '\r\n' +
  '\r\n' +
  'function add(x,y) {\r\n' +
  '  return x+y;   \r\n' +
  '}\r\n';

describe('Integration: analyze -> fix workflow', () => {
  let sandbox;

  beforeEach(() => {
    sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'aqt-int-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(sandbox, { recursive: true, force: true });
    } catch (_) {
      // best-effort cleanup
    }
  });

  function writeFixture(name, content) {
    const filePath = path.join(sandbox, name);
    fs.writeFileSync(filePath, content, 'utf8');
    return filePath;
  }

  test('dry-run reports fixes without modifying the file', async () => {
    const filePath = writeFixture('sample.txt', MESSY_CONTENT);

    // .txt routes through the fallback PatternFixer (no external tooling).
    const issues = [
      { id: 'i1', line: 1, ruleId: 'trailing-whitespace', fixable: true },
      { id: 'i2', line: 2, ruleId: 'space-after-comma', fixable: true }
    ];

    const engine = new AutoFixEngine({
      dryRun: true,
      backup: false,
      verbose: false,
      historyDir: path.join(sandbox, '.history')
    });

    const results = await engine.fixFiles({ [filePath]: issues });

    expect(results).toHaveLength(1);
    expect(results[0].fixedIssueCount).toBeGreaterThan(0);

    // File on disk must be untouched in dry-run mode.
    const onDisk = fs.readFileSync(filePath, 'utf8');
    expect(onDisk).toBe(MESSY_CONTENT);
  });

  test('real fix normalizes file content on disk', async () => {
    const filePath = writeFixture('messy.txt', MESSY_CONTENT);

    // Drive the PatternFixer exactly as RuleBasedFixEngine would for a
    // non-code extension, but with a real (non-dry-run) write.
    const fixer = new PatternFixer({ dryRun: false, backup: false, verbose: false });
    const result = await fixer.fixFile(filePath, []);

    expect(result.success).toBe(true);
    expect(result.fixedCount).toBeGreaterThan(0);

    const fixed = fs.readFileSync(filePath, 'utf8');

    // CRLF normalized to LF.
    expect(fixed.includes('\r')).toBe(false);
    // No trailing whitespace on any line.
    expect(/[ \t]+\n/.test(fixed)).toBe(false);
    // No run of 3+ newlines (blank lines collapsed).
    expect(/\n{3,}/.test(fixed)).toBe(false);
    // Space inserted after commas.
    expect(fixed).toContain('[1, 2, 3]');
    expect(fixed).toContain('add(x, y)');
  });

  test('backup + rollback restores the original file', async () => {
    const filePath = writeFixture('rollback.txt', MESSY_CONTENT);
    const backupRoot = path.join(sandbox, '.backup');

    const issues = [{ id: 'i1', line: 1, ruleId: 'trailing-whitespace', fixable: true }];

    const engine = new AutoFixEngine({
      dryRun: false,
      backup: true,
      backupDir: backupRoot,
      historyDir: path.join(sandbox, '.history'),
      verbose: false
    });

    const [result] = await engine.fixFiles({ [filePath]: issues });

    // A backup was created and content changed on disk.
    expect(result.backupPath).toBeDefined();
    expect(fs.existsSync(result.backupPath)).toBe(true);
    const afterFix = fs.readFileSync(filePath, 'utf8');
    expect(afterFix).not.toBe(MESSY_CONTENT);

    // Roll the session back and confirm the original content is restored.
    const sessionId = engine.currentSessionId;
    expect(sessionId).toBeDefined();
    await engine.rollback(sessionId);

    const restored = fs.readFileSync(filePath, 'utf8');
    expect(restored).toBe(MESSY_CONTENT);
  });

  test('stats reflect a completed fix run', async () => {
    const filePath = writeFixture('stats.txt', MESSY_CONTENT);
    const issues = [
      { id: 'i1', line: 1, ruleId: 'trailing-whitespace', fixable: true },
      { id: 'i2', line: 2, ruleId: 'space-after-comma', fixable: true }
    ];

    const engine = new AutoFixEngine({
      dryRun: true,
      backup: false,
      historyDir: path.join(sandbox, '.history'),
      verbose: false
    });

    await engine.fixFiles({ [filePath]: issues });
    const stats = engine.getStats();

    expect(stats.totalIssues).toBe(2);
    expect(stats.fixedByRule).toBeGreaterThan(0);
    expect(stats.successRate).toBeGreaterThan(0);
  });

  test('unfixable issues surface as remaining after a run', async () => {
    const filePath = writeFixture('mixed.txt', MESSY_CONTENT);

    // One rule-fixable issue and one that neither rules nor AI patterns target,
    // so it must remain unresolved end-to-end.
    const fixable = { id: 'fix-me', line: 1, ruleId: 'trailing-whitespace', fixable: true };
    const unfixable = { id: 'keep-me', line: 6, ruleId: 'some-unknown-semantic-rule' };

    const engine = new AutoFixEngine({
      dryRun: true,
      backup: false,
      historyDir: path.join(sandbox, '.history'),
      verbose: false
    });

    const [result] = await engine.fixFiles({ [filePath]: [fixable, unfixable] });

    const remainingIds = result.remainingIssues.map((i) => i.id);
    expect(remainingIds).toContain('keep-me');
    expect(remainingIds).not.toContain('fix-me');
  });
});
