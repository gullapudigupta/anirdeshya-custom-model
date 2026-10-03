/**
 * C# Support Tests (P2-T007)
 *
 * Covers the C# analyzer's parsing/classification/offline detection and the C#
 * auto-fixer's transforms + backup/rollback — all offline and deterministic
 * (no dotnet toolchain required). File I/O is sandboxed under os.tmpdir().
 *
 * @module test/csharp
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  CSharpAnalyzer,
  mapRoslynSeverity,
  categorizeRule,
  isRuleFixable
} = require('../../src/languages/csharp-analyzer');
const { CSharpPatternFixer, CSharpFixEngine } = require('../../src/fixers/csharp-fixer');

describe('CSharpAnalyzer', () => {
  let analyzer;

  beforeEach(() => {
    analyzer = new CSharpAnalyzer({ verbose: false });
  });

  describe('Severity mapping', () => {
    test('maps roslyn severities to canonical set', () => {
      expect(mapRoslynSeverity('error')).toBe('ERROR');
      expect(mapRoslynSeverity('warning')).toBe('WARNING');
      expect(mapRoslynSeverity('info')).toBe('INFO');
      expect(mapRoslynSeverity('hidden')).toBe('INFO');
      expect(mapRoslynSeverity('unknown')).toBe('INFO');
    });
  });

  describe('Rule categorization', () => {
    test('classifies rule-id prefixes', () => {
      expect(categorizeRule('SA1200')).toBe('STYLE');
      expect(categorizeRule('CA1822')).toBe('CODE_ANALYSIS');
      expect(categorizeRule('IDE0005')).toBe('STYLE');
      expect(categorizeRule('S1118')).toBe('SONAR');
      expect(categorizeRule('CS0246')).toBe('COMPILER');
      expect(categorizeRule('XX999')).toBe('GENERAL');
    });

    test('flags fixable style rules', () => {
      expect(isRuleFixable('SA1028')).toBe(true);
      expect(isRuleFixable('IDE0005')).toBe(true);
      expect(isRuleFixable('CS0246')).toBe(false);
      expect(isRuleFixable('S1118')).toBe(false);
    });
  });

  describe('Build output parsing', () => {
    test('parses MSBuild diagnostics into normalized issues', () => {
      const output = [
        "C:\\proj\\Program.cs(12,5): warning SA1200: Using directive should appear within a namespace [C:\\proj\\App.csproj]",
        "C:\\proj\\Program.cs(3,1): error CS0246: The type or namespace 'Foo' could not be found [C:\\proj\\App.csproj]",
        "C:\\proj\\Widget.cs(40,9): warning S1118: Add a private constructor [C:\\proj\\App.csproj]",
        'Some unrelated build line that should be ignored'
      ].join('\n');

      const issues = analyzer.parseBuildOutput(output);

      expect(issues).toHaveLength(3);

      const sa = issues.find((i) => i.ruleId === 'SA1200');
      expect(sa.severity).toBe('WARNING');
      expect(sa.tool).toBe('stylecop');
      expect(sa.category).toBe('STYLE');
      expect(sa.line).toBe(12);
      expect(sa.column).toBe(5);
      expect(sa.fixable).toBe(true); // SA1xxx layout/style rules are dotnet-format fixable

      const cs = issues.find((i) => i.ruleId === 'CS0246');
      expect(cs.severity).toBe('ERROR');
      expect(cs.tool).toBe('roslyn');

      const sonar = issues.find((i) => i.ruleId === 'S1118');
      expect(sonar.tool).toBe('sonar');
      expect(sonar.category).toBe('SONAR');
    });

    test('deduplicates repeated diagnostics from multi-target builds', () => {
      const line =
        "C:\\proj\\A.cs(1,1): warning SA1028: trailing whitespace [C:\\proj\\A.csproj]";
      const issues = analyzer.parseBuildOutput(`${line}\n${line}\n${line}`);
      expect(issues).toHaveLength(1);
    });
  });

  describe('Offline format detection', () => {
    // The sandbox is created per-test (not via a nested beforeEach) so it does
    // not depend on nested-describe hook ordering in the lightweight harness.
    function withSandbox(fn) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aqt-cs-an-'));
      try {
        return fn(dir);
      } finally {
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
      }
    }

    test('detects trailing whitespace, tabs, and missing final newline', () => {
      withSandbox((sandbox) => {
        const file = path.join(sandbox, 'Sample.cs');
        // trailing space on line 1, a tab-indented line, no final newline
        fs.writeFileSync(file, 'class A {   \n\tint x = 1;\n}', 'utf8');

        const issues = analyzer.detectFormatIssues(file);
        const ids = issues.map((i) => i.ruleId);

        expect(ids).toContain('SA1028'); // trailing whitespace
        expect(ids).toContain('SA1027'); // tabs
        expect(ids).toContain('SA1518'); // final newline
        expect(issues.every((i) => i.fixable === true)).toBe(true);
      });
    });

    test('clean file yields no format issues', () => {
      withSandbox((sandbox) => {
        const file = path.join(sandbox, 'Clean.cs');
        fs.writeFileSync(file, 'class A\n{\n    int x = 1;\n}\n', 'utf8');
        expect(analyzer.detectFormatIssues(file)).toHaveLength(0);
      });
    });
  });

  describe('File discovery', () => {
    test('matches .cs files and excludes bin/obj', () => {
      expect(analyzer.matchPattern('src/Program.cs', '**/*.cs')).toBe(true);
      expect(analyzer.matchPattern('Program.cs', '**/*.cs')).toBe(true);
      expect(analyzer.matchPattern('bin/Debug/App.cs', '**/bin/**')).toBe(true);
      expect(analyzer.matchPattern('obj/App.cs', '**/obj/**')).toBe(true);
      expect(analyzer.matchPattern('src/App.js', '**/*.cs')).toBe(false);
    });
  });
});

describe('C# Auto-Fix', () => {
  let sandbox;

  const MESSY_CS =
    'using System;\r\n' +
    'class Program   \r\n' +
    '{\r\n' +
    '\tstatic void Main()\r\n' +
    '\t{\r\n' +
    '\t\tConsole.WriteLine("hi");   \r\n' +
    '\t}\r\n' +
    '}';

  beforeEach(() => {
    sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'aqt-cs-fix-'));
  });
  afterEach(() => {
    try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch (_) {}
  });

  test('dry-run reports fixes without modifying the file', async () => {
    const file = path.join(sandbox, 'Dry.cs');
    fs.writeFileSync(file, MESSY_CS, 'utf8');

    const fixer = new CSharpPatternFixer({ dryRun: true, backup: false });
    const result = await fixer.fixFile(file);

    expect(result.success).toBe(true);
    expect(result.fixedCount).toBeGreaterThan(0);
    expect(fs.readFileSync(file, 'utf8')).toBe(MESSY_CS);
  });

  test('real fix normalizes C# content on disk', async () => {
    const file = path.join(sandbox, 'Fix.cs');
    fs.writeFileSync(file, MESSY_CS, 'utf8');

    const fixer = new CSharpPatternFixer({ dryRun: false, backup: false, indentSize: 4 });
    const result = await fixer.fixFile(file);

    expect(result.success).toBe(true);
    const fixed = fs.readFileSync(file, 'utf8');

    expect(fixed.includes('\r')).toBe(false);        // CRLF -> LF
    expect(/[ \t]+\n/.test(fixed)).toBe(false);       // no trailing whitespace
    expect(fixed.includes('\t')).toBe(false);         // tabs -> spaces
    expect(fixed.endsWith('\n')).toBe(true);          // final newline
    expect(fixed).toContain('    static void Main()'); // 4-space indent
  });

  test('backup + rollback restores the original file', async () => {
    const file = path.join(sandbox, 'Roll.cs');
    fs.writeFileSync(file, MESSY_CS, 'utf8');

    const fixer = new CSharpPatternFixer({
      dryRun: false,
      backup: true,
      backupDir: path.join(sandbox, '.backup')
    });

    const result = await fixer.fixFile(file);
    expect(result.backupPath).toBeDefined();
    expect(fs.existsSync(result.backupPath)).toBe(true);
    expect(fs.readFileSync(file, 'utf8')).not.toBe(MESSY_CS);

    await fixer.restoreBackup(file, result.backupPath);
    expect(fs.readFileSync(file, 'utf8')).toBe(MESSY_CS);
  });

  test('engine fixes multiple files and reports stats', async () => {
    const a = path.join(sandbox, 'A.cs');
    const b = path.join(sandbox, 'B.cs');
    fs.writeFileSync(a, MESSY_CS, 'utf8');
    fs.writeFileSync(b, 'class B {}\n', 'utf8'); // already clean

    const engine = new CSharpFixEngine({ dryRun: false, backup: false });
    const results = await engine.fixFiles({ [a]: [], [b]: [] });
    const stats = engine.getStats(results);

    expect(stats.totalFiles).toBe(2);
    expect(stats.successfulFiles).toBe(2);
    expect(stats.totalFixes).toBeGreaterThan(0);
  });
});
