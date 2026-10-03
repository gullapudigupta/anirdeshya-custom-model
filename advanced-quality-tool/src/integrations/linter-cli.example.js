/**
 * Example usage and tests for Linter CLI Integration
 */

const { LinterOrchestrator } = require('./linter-cli');
const path = require('path');

// Example 1: Run all available linters
async function exampleRunAll() {
  const projectRoot = path.resolve(__dirname, '../..');
  const orchestrator = new LinterOrchestrator(projectRoot);

  console.log('🔍 Running all available linters...\n');

  const result = await orchestrator.runAll([], { verbose: true });

  console.log('\n📊 Summary:');
  console.log(`  Total issues found: ${result.totalIssues}`);
  console.log(`\n  By linter:`);

  for (const [linter, data] of Object.entries(result.summary)) {
    if (data.success) {
      console.log(`    ${linter}: ${data.issueCount} issues`);
    } else {
      console.log(`    ${linter}: FAILED - ${data.error}`);
    }
  }

  // Group by severity
  const bySeverity = result.issues.reduce((acc, issue) => {
    acc[issue.severity] = (acc[issue.severity] || 0) + 1;
    return acc;
  }, {});

  console.log(`\n  By severity:`);
  for (const [severity, count] of Object.entries(bySeverity)) {
    console.log(`    ${severity}: ${count}`);
  }

  // Group by category
  const byCategory = result.issues.reduce((acc, issue) => {
    acc[issue.category] = (acc[issue.category] || 0) + 1;
    return acc;
  }, {});

  console.log(`\n  By category:`);
  for (const [category, count] of Object.entries(byCategory)) {
    console.log(`    ${category}: ${count}`);
  }

  return result;
}

// Example 2: Run specific linter
async function exampleRunESLint() {
  const projectRoot = path.resolve(__dirname, '../..');
  const orchestrator = new LinterOrchestrator(projectRoot);

  console.log('🔍 Running ESLint only...\n');

  const result = await orchestrator.runLinter('eslint');

  console.log(`Found ${result.issueCount} issues`);

  // Show first 5 issues
  result.issues.slice(0, 5).forEach((issue, i) => {
    console.log(`\n${i + 1}. ${issue.title}`);
    console.log(`   File: ${issue.file}:${issue.startLine}`);
    console.log(`   Severity: ${issue.severity}`);
    console.log(`   Category: ${issue.category}`);
    console.log(`   Rule: ${issue.rule}`);
  });

  return result;
}

// Example 3: Detect available linters
function exampleDetectLinters() {
  const projectRoot = path.resolve(__dirname, '../..');
  const orchestrator = new LinterOrchestrator(projectRoot);

  const available = orchestrator.detectAvailableLinters();

  console.log('🔍 Available linters:');
  for (const [name, isAvailable] of Object.entries(available)) {
    const icon = isAvailable ? '✓' : '✗';
    console.log(`  ${icon} ${name}`);
  }

  return available;
}

// Example 4: Run linters on specific files
async function exampleRunOnFiles() {
  const projectRoot = path.resolve(__dirname, '../..');
  const orchestrator = new LinterOrchestrator(projectRoot);

  const files = [
    'src/app/app.component.ts',
    'src/app/app.component.css'
  ];

  console.log(`🔍 Running linters on specific files: ${files.join(', ')}\n`);

  const result = await orchestrator.runAll(files, { verbose: true });

  console.log(`\nFound ${result.totalIssues} issues in specified files`);

  return result;
}

// Example 5: Filter by severity
function exampleFilterBySeverity(issues, severity = 'ERROR') {
  return issues.filter(issue => issue.severity === severity);
}

// Example 6: Group issues by file
function exampleGroupByFile(issues) {
  return issues.reduce((acc, issue) => {
    if (!acc[issue.file]) {
      acc[issue.file] = [];
    }
    acc[issue.file].push(issue);
    return acc;
  }, {});
}

// Example 7: Get fixable issues
function exampleGetFixableIssues(issues) {
  return issues.filter(issue => 
    issue.autoFixLevel === 'AUTO' || issue.autoFixLevel === 'RULE'
  );
}

// Example 8: Integration with existing analyzer
async function exampleIntegrateWithExistingAnalyzer() {
  const projectRoot = path.resolve(__dirname, '../..');
  const orchestrator = new LinterOrchestrator(projectRoot);

  // Run external linters
  const externalIssues = await orchestrator.runAll([], { verbose: false });

  // Simulate internal analyzer issues (from existing code-analyzer)
  const internalIssues = [
    // These would come from your existing analyzers
    // (complexity, angular-patterns, security, etc.)
  ];

  // Merge all issues
  const allIssues = [
    ...externalIssues.issues,
    ...internalIssues
  ];

  // Remove duplicates (same file + line + type)
  const uniqueIssues = [];
  const seen = new Set();

  for (const issue of allIssues) {
    const key = `${issue.file}:${issue.startLine}:${issue.type}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniqueIssues.push(issue);
    }
  }

  console.log(`📊 Total issues: ${uniqueIssues.length}`);
  console.log(`   External linters: ${externalIssues.issues.length}`);
  console.log(`   Internal analyzers: ${internalIssues.length}`);
  console.log(`   Duplicates removed: ${allIssues.length - uniqueIssues.length}`);

  return uniqueIssues;
}

// Command-line interface
if (require.main === module) {
  const command = process.argv[2] || 'all';

  const commands = {
    'all': exampleRunAll,
    'eslint': exampleRunESLint,
    'detect': exampleDetectLinters,
    'files': exampleRunOnFiles,
    'integrate': exampleIntegrateWithExistingAnalyzer
  };

  const fn = commands[command];

  if (!fn) {
    console.error(`Unknown command: ${command}`);
    console.error(`Available commands: ${Object.keys(commands).join(', ')}`);
    process.exit(1);
  }

  fn().then(() => {
    console.log('\n✓ Done');
  }).catch(error => {
    console.error('\n✗ Error:', error);
    process.exit(1);
  });
}

module.exports = {
  exampleRunAll,
  exampleRunESLint,
  exampleDetectLinters,
  exampleRunOnFiles,
  exampleFilterBySeverity,
  exampleGroupByFile,
  exampleGetFixableIssues,
  exampleIntegrateWithExistingAnalyzer
};
