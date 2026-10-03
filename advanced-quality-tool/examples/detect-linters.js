/**
 * Example: Detect Available Linters
 * 
 * This example shows how to detect which linters are installed
 * in your project and available for use.
 */

const { LinterOrchestrator } = require('../src/integrations/linter-cli');
const path = require('path');

async function main() {
  console.log('🔍 Detecting Available Linters\n');
  console.log('=' .repeat(50));

  // Get project root (adjust this path as needed)
  const projectRoot = path.resolve(__dirname, '../../..');

  console.log(`\nProject root: ${projectRoot}\n`);

  // Create orchestrator
  const orchestrator = new LinterOrchestrator(projectRoot);

  // Detect available linters
  const available = orchestrator.detectAvailableLinters();

  console.log('Available linters:');
  console.log('─'.repeat(50));

  for (const [name, isAvailable] of Object.entries(available)) {
    const icon = isAvailable ? '✅' : '❌';
    const status = isAvailable ? 'Available' : 'Not installed';
    console.log(`${icon} ${name.padEnd(20)} ${status}`);
  }

  console.log('\n' + '─'.repeat(50));

  // Count available linters
  const availableCount = Object.values(available).filter(v => v).length;
  const totalCount = Object.keys(available).length;

  console.log(`\n📊 Summary: ${availableCount}/${totalCount} linters available\n`);

  if (availableCount === 0) {
    console.log('⚠️  No linters found! Install at least one:');
    console.log('   npm install --save-dev eslint');
    console.log('   npm install --save-dev prettier');
    console.log('   npm install --save-dev stylelint');
  } else {
    console.log('✨ You can now run analysis with these linters!');
    console.log('   node examples/run-analysis.js');
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error('Error:', error);
    process.exit(1);
  });
}

module.exports = { main };
