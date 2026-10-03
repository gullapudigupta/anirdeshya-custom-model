/**
 * Phase 11 Integration Test Runner
 * Runs only the phase11-integration test suite to avoid
 * interference from long-running tests in the main suite.
 *
 * Usage: node test/run-phase11.js
 */

'use strict';

const path = require('path');
const { results } = require('./harness');

const testFile = path.join(__dirname, '__tests__', 'phase11-integration.test.js');

console.log('Running Phase 11 Integration Tests...\n');

(async () => {
  require(testFile);

  // Wait for all async tests to settle (async tests run in microtasks)
  await new Promise((r) => setTimeout(r, 15000));

  console.log('\n----------------------------------------');
  console.log(`Passed: ${results.passed}  Failed: ${results.failed}`);

  if (results.failed > 0) {
    console.log('\nFailures:');
    for (const f of results.failures) {
      console.log(`  ✗ ${f.label}: ${f.message}`);
    }
    process.exit(1);
  }

  console.log('\n✅ All Phase 11 integration tests passed!');
  process.exit(0);
})();
