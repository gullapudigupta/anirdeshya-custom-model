const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { randomUUID } = require('crypto');
const { ExternalLanguageAnalyzer } = require('../../src/languages/external-language-analyzer');
const { PythonAnalyzer } = require('../../src/languages/python-analyzer');
const { CSharpAnalyzer } = require('../../src/languages/csharp-analyzer');
const { GoAnalyzer } = require('../../src/languages/go-analyzer');
const { RustAnalyzer } = require('../../src/languages/rust-analyzer');
const { PhpAnalyzer } = require('../../src/languages/php-analyzer');
const { RubyAnalyzer } = require('../../src/languages/ruby-analyzer');

describe('Additional language analyzers', () => {
  test('normalizes compiler-style output', () => {
    const analyzer = new ExternalLanguageAnalyzer({ language: 'go' });
    const issues = analyzer.parseText('main.go:12:4: warning: unused variable', 'main.go', 'govet');
    assert.strictEqual(issues.length, 1);
    assert.strictEqual(issues[0].severity, 'WARNING');
    assert.strictEqual(issues[0].line, 12);
    assert.strictEqual(issues[0].column, 4);
  });

  test('parses Cargo Clippy JSON diagnostic streams', () => {
    const analyzer = new ExternalLanguageAnalyzer({ language: 'rust' });
    const output = [
      JSON.stringify({
        reason: 'compiler-message',
        message: {
          message: 'unused variable',
          code: { code: 'unused_variables' },
          level: 'warning',
          spans: [{
            file_name: 'src/main.rs',
            line_start: 7,
            column_start: 9,
            is_primary: true
          }]
        }
      }),
      JSON.stringify({ reason: 'build-finished', success: true })
    ].join('\n');
    const issues = analyzer.parseOutput('clippy', output, 'src/main.rs', 'json');
    assert.strictEqual(issues.length, 1);
    assert.strictEqual(issues[0].filePath, 'src/main.rs');
    assert.strictEqual(issues[0].line, 7);
    assert.strictEqual(issues[0].column, 9);
    assert.strictEqual(issues[0].ruleId, 'unused_variables');
    assert.strictEqual(issues[0].severity, 'WARNING');
  });

  test('parses PHPCS message arrays without treating count fields as diagnostics', () => {
    const analyzer = new ExternalLanguageAnalyzer({ language: 'php' });
    const issues = analyzer.parseOutput('phpcs', JSON.stringify({
      files: {
        'src/example.php': {
          errors: 1,
          warnings: 0,
          messages: [{
            message: 'Expected one space after comma',
            source: 'Generic.Formatting.SpaceAfterComma',
            severity: 5,
            type: 'ERROR',
            line: 3,
            column: 12
          }]
        }
      }
    }), 'src/example.php', 'phpcs');
    assert.strictEqual(issues.length, 1);
    assert.strictEqual(issues[0].ruleId, 'Generic.Formatting.SpaceAfterComma');
    assert.strictEqual(issues[0].line, 3);
    assert.strictEqual(issues[0].severity, 'ERROR');
  });

  test('returns an explicit error when an external tool is unavailable', async () => {
    const missingTool = path.join(os.tmpdir(), `aqt-missing-${randomUUID()}`);
    const analyzer = new ExternalLanguageAnalyzer({
      language: 'test',
      tools: { missing: { command: missingTool, args: [], parser: 'text' } }
    });
    const result = await analyzer.analyzeFile('example.test');
    assert.strictEqual(result.count, 0);
    assert.match(result.error, /missing: Unable to run missing/);
  });

  test('reports unavailable Python tools instead of a clean analysis', async () => {
    const missingTool = path.join(os.tmpdir(), `aqt-missing-python-${randomUUID()}`);
    const analyzer = new PythonAnalyzer({
      pylintPath: missingTool,
      flake8: false,
      black: false,
      mypy: false,
      bandit: false
    });
    const result = await analyzer.analyzeFile('example.py');
    assert.strictEqual(result.count, 0);
    assert.match(result.error, /pylint command failed/);
  });

  test('reports unavailable .NET tooling instead of a clean analysis', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aqt-csharp-'));
    const projectFile = path.join(root, 'sample.csproj');
    const sourceFile = path.join(root, 'Sample.cs');
    fs.writeFileSync(projectFile, '<Project />');
    fs.writeFileSync(sourceFile, 'class Sample { }\n');
    try {
      const analyzer = new CSharpAnalyzer({
        dotnetPath: path.join(root, `missing-dotnet-${randomUUID()}`)
      });
      const result = await analyzer.analyzeFile(sourceFile);
      assert.strictEqual(result.count, 0);
      assert.match(result.error, /dotnet:/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('exposes the supported language names', () => {
    assert.strictEqual(new GoAnalyzer().language, 'go');
    assert.strictEqual(new RustAnalyzer().language, 'rust');
    assert.strictEqual(new PhpAnalyzer().language, 'php');
    assert.strictEqual(new RubyAnalyzer().language, 'ruby');
  });
});