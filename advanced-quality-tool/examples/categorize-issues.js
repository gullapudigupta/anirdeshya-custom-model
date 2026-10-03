/**
 * Example: Categorize and Filter Issues
 * 
 * This example shows how to use the categorization engine
 * to enrich, filter, and sort issues.
 */

const { LinterOrchestrator } = require('../src/integrations/linter-cli');
const {
  IssueCategorizationEngine,
  IssueFilterEngine,
  IssueSortEngine
} = require('../src/core/issue-categorizer');
const path = require('path');

async function main() {
  console.log('📊 Issue Categorization & Filtering\n');
  console.log('='.repeat(60));

  // Get project root
  const projectRoot = path.resolve(__dirname, '../../..');

  console.log(`\nProject root: ${projectRoot}`);
  console.log('Running linters and categorizing issues...\n');

  // Run linters
  const orchestrator = new LinterOrchestrator(projectRoot);
  const result = await orchestrator.runAll([], { verbose: false });

  if (result.totalIssues === 0) {
    console.log('✨ No issues found!\n');
    return;
  }

  console.log(`Found ${result.totalIssues} issues. Categorizing...\n`);

  // Categorize all issues
  const engine = new IssueCategorizationEngine({ autoEnrich: true });
  const categorized = engine.categorizeAll(result.issues);

  console.log('✅ Issues categorized and enriched!\n');

  // Example 1: Filter critical and error issues
  console.log('─'.repeat(60));
  console.log('1️⃣  High Priority (CRITICAL + ERROR):\n');

  const highPriority = new IssueFilterEngine()
    .bySeverity('CRITICAL', 'ERROR')
    .apply(categorized);

  console.log(`   Found ${highPriority.length} high-priority issues`);
  highPriority.slice(0, 3).forEach((issue, i) => {
    console.log(`   ${i + 1}. ${issue.title}`);
    console.log(`      ${issue.file}:${issue.startLine}`);
  });

  // Example 2: Filter security issues
  console.log('\n' + '─'.repeat(60));
  console.log('2️⃣  Security Issues:\n');

  const securityIssues = new IssueFilterEngine()
    .byCategory('SECURITY')
    .apply(categorized);

  console.log(`   Found ${securityIssues.length} security issues`);
  if (securityIssues.length > 0) {
    securityIssues.slice(0, 3).forEach((issue, i) => {
      console.log(`   ${i + 1}. ${issue.title}`);
      console.log(`      ${issue.severity} | ${issue.file}:${issue.startLine}`);
    });
  } else {
    console.log('   ✅ No security issues found!');
  }

  // Example 3: Auto-fixable issues
  console.log('\n' + '─'.repeat(60));
  console.log('3️⃣  Auto-Fixable Issues:\n');

  const fixable = new IssueFilterEngine()
    .byFixable(true)
    .apply(categorized);

  console.log(`   Found ${fixable.length} auto-fixable issues`);
  if (fixable.length > 0) {
    console.log(`   These can be fixed automatically!\n`);
    fixable.slice(0, 5).forEach((issue, i) => {
      console.log(`   ${i + 1}. ${issue.title} (${issue.autoFixLevel})`);
      console.log(`      ${issue.file}:${issue.startLine}`);
    });
  }

  // Example 4: TypeScript/Angular issues
  console.log('\n' + '─'.repeat(60));
  console.log('4️⃣  TypeScript/Angular Issues:\n');

  const tsIssues = new IssueFilterEngine()
    .byFileType('typescript', 'angular-component', 'angular-service')
    .apply(categorized);

  console.log(`   Found ${tsIssues.length} TypeScript/Angular issues`);

  // Example 5: Issues in specific directory
  console.log('\n' + '─'.repeat(60));
  console.log('5️⃣  Issues in src/app directory:\n');

  const appIssues = new IssueFilterEngine()
    .byFilePattern(/^src[\/\\]app/)
    .apply(categorized);

  console.log(`   Found ${appIssues.length} issues in src/app`);

  // Example 6: Combined filter - High priority + fixable
  console.log('\n' + '─'.repeat(60));
  console.log('6️⃣  High Priority + Auto-Fixable:\n');

  const highPriorityFixable = new IssueFilterEngine()
    .bySeverity('CRITICAL', 'ERROR', 'WARNING')
    .byFixable(true)
    .apply(categorized);

  console.log(`   Found ${highPriorityFixable.length} issues`);
  console.log(`   💡 These should be fixed first!\n`);
  highPriorityFixable.slice(0, 5).forEach((issue, i) => {
    console.log(`   ${i + 1}. ${issue.title}`);
    console.log(`      ${issue.severity} | ${issue.autoFixLevel} | ${issue.file}:${issue.startLine}`);
  });

  // Example 7: Sorting by priority
  console.log('\n' + '─'.repeat(60));
  console.log('7️⃣  Top 10 Issues by Priority:\n');

  const sortedByPriority = IssueSortEngine.byPriority(categorized).slice(0, 10);

  sortedByPriority.forEach((issue, i) => {
    console.log(`   ${i + 1}. ${issue.title}`);
    console.log(`      Priority: ${issue.priority} (${issue.priorityClass}) | ${issue.severity}`);
    console.log(`      ${issue.file}:${issue.startLine}`);
    console.log('');
  });

  // Summary
  console.log('='.repeat(60));
  console.log('📊 Summary:\n');
  console.log(`   Total issues: ${categorized.length}`);
  console.log(`   High priority: ${highPriority.length}`);
  console.log(`   Security: ${securityIssues.length}`);
  console.log(`   Auto-fixable: ${fixable.length}`);
  console.log(`   TypeScript/Angular: ${tsIssues.length}`);
  console.log('\n✅ Categorization complete!\n');
}

if (require.main === module) {
  main().catch(error => {
    console.error('Error:', error);
    process.exit(1);
  });
}

module.exports = { main };
