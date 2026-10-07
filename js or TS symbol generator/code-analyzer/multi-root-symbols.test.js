const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const path = require('node:path');

const { QueryEngine } = require('./src/query-engine');
const { getAnalyzerRoots } = require('./src/analyzer-roots');

const ROOT = path.resolve(__dirname, '../..');

test('indexes symbols from every configured analyzer root', () => {
  const engine = new QueryEngine(ROOT);
  const roots = getAnalyzerRoots(ROOT);
  const stats = engine.buildIndex(roots);
  const indexedFiles = new Set(engine.getDatabase().symbols.map(symbol => symbol.file.replace(/\\/g, '/')));

  assert.deepEqual(roots.map(root => path.basename(root)), ['src', 'functions', 'projects', 'scripts']);
  assert.equal(fs.existsSync(path.join(ROOT, 'project')), false);
  assert.equal(fs.existsSync(path.join(ROOT, 'projects')), true);
  for (const rootName of ['src', 'functions', 'projects', 'scripts']) {
    assert.ok(
      [...indexedFiles].some(file => file.startsWith(`${rootName}/`)),
      `${rootName} should produce indexed symbols`
    );
  }
  assert.ok(![...indexedFiles].some(file => file.startsWith('project/')));
  assert.ok(stats.totalSymbols > 0);
});
