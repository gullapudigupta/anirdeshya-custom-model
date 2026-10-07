/**
 * Zero-dependency test runner.
 *
 * Loads the harness (which installs Jest-like globals), then requires every
 * *.test.js file under test/ so their describe/test blocks execute. Exits
 * non-zero if any assertion fails so it works in CI and `npm test`.
 *
 * Usage: node test/run.js
 *
 * @module test/run
 */

const fs = require('fs');
const path = require('path');
const { results, runTests, setCurrentFile } = require('./harness');

function findTests(dir) {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      found.push(...findTests(full));
    } else if (entry.name.endsWith('.test.js')) {
      found.push(full);
    }
  }
  return found;
}

const testDir = __dirname;
const files = findTests(testDir).sort();

if (files.length === 0) {
  console.log('No test files (*.test.js) found under', testDir);
  process.exit(0);
}

console.log(`Running ${files.length} test file(s)\n`);

(async () => {
  for (const file of files) {
    console.log(path.relative(testDir, file));
    try {
      setCurrentFile(file);
      require(file);
    } catch (err) {
      results.failed++;
      results.failures.push({ label: file, message: err.message });
      console.log(`  \u2717 failed to load: ${err.message}`);
    }
    console.log('');
  }

  await runTests();

  console.log('----------------------------------------');
  console.log(`Passed: ${results.passed}  Failed: ${results.failed}`);
  if (results.failed > 0) {
    console.log('\nFailures:');
    for (const f of results.failures) {
      console.log(`  - ${f.label}: ${f.message}`);
    }
    process.exit(1);
  }
  process.exit(0);
})();
