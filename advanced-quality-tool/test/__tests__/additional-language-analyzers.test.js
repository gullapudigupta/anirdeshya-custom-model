const assert = require('assert');
const { ExternalLanguageAnalyzer } = require('../../src/languages/external-language-analyzer');
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

  test('exposes the supported language names', () => {
    assert.strictEqual(new GoAnalyzer().language, 'go');
    assert.strictEqual(new RustAnalyzer().language, 'rust');
    assert.strictEqual(new PhpAnalyzer().language, 'php');
    assert.strictEqual(new RubyAnalyzer().language, 'ruby');
  });
});