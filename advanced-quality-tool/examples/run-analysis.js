/**
 * Example: Run Full Analysis
 * 
 * This example shows how to run all available linters
 * and get a comprehensive analysis of your codebase.
 */

const { LinterOrchestrator } = require('../src/integrations/linter-cli');
const { getIssueStats, exportIssues } = require('../src/integrations/issue-normalizer');
const path = require('path');
const fs = require('fs');

async function main() {
  console.log('🔍 Running Full Code Analysis\n');
  console.log('='.repeat(60));

  // Get project root (adjust this path as needed)
  const projectRoot = path.resolve(__dirname, '../../..');

  console.log(`\nProject root: ${projectRoot}`);
  console.log('Running all available linters...\n');

  // Create orchestrator
  const orchestrator = new LinterOrchestrator(projectRoot);

  // Run all linters
  const result = await orchestrator.runAll([], { verbose: true });

  console.log('\n' + '='.repeat(60));
  console.log('📊 Analysis Results\n');

  // Display summary
  console.log('Issues by linter:');
  console.log('─'.repeat(60));
  for (const [linter, data] of Object.entries(result.summary)) {
    if (data.success) {
      const icon = data.issueCount > 0 ? '⚠️ ' : '✅';
      console.log(`${icon} ${linter.padEnd(20)} ${data.issueCount} issues`);
    } else {
      console.log(`❌ ${linter.padEnd(20)} Failed: ${data.error}`);
    }
  }

  if (result.totalIssues === 0) {
    console.log('\n✨ No issues found! Your code is clean.\n');
    return;
  }

  // Get statistics
  const stats = getIssueStats(result.issues);

  console.log('\n' + '─'.repeat(60));
  console.log('By Severity:');
  console.log('─'.repeat(60));
  for (const [severity, count] of Object.entries(stats.bySeverity)) {
    if (count > 0) {
      const icon = {
        'CRITICAL': '🔴',
        'ERROR': '🟠',
        'WARNING': '🟡',
        'INFO': '🔵',
        'SUGGESTION': '⚪'
      }[severity] || '•';
      console.log(`${icon} ${severity.padEnd(15)} ${count}`);
    }
  }

  console.log('\n' + '─'.repeat(60));
  console.log('By Category:');
  console.log('─'.repeat(60));
  for (const [category, count] of Object.entries(stats.byCategory)) {
    if (count > 0) {
      console.log(`  ${category.padEnd(20)} ${count}`);
    }
  }

  console.log('\n' + '─'.repeat(60));
  console.log('By File Type:');
  console.log('─'.repeat(60));
  for (const [fileType, count] of Object.entries(stats.byFileType)) {
    if (count > 0) {
      console.log(`  ${fileType.padEnd(20)} ${count}`);
    }
  }

  console.log('\n' + '─'.repeat(60));
  console.log(`\n📈 Total: ${result.totalIssues} issues`);
  console.log(`🔧 Auto-fixable: ${stats.fixable} issues`);
  console.log(`🔴 Critical: ${stats.critical} issues`);

  // Save results to file
  const outputDir = path.join(projectRoot, '.aqt-results');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Save JSON
  const jsonPath = path.join(outputDir, 'analysis-results.json');
  fs.writeFileSync(jsonPath, JSON.stringify(result.issues, null, 2));
  console.log(`\n💾 Results saved to: ${jsonPath}`);

  // Save HTML report
  const htmlPath = path.join(outputDir, 'report.html');
  const html = exportIssues(result.issues, 'html');
  fs.writeFileSync(htmlPath, html);
  console.log(`📄 HTML report saved to: ${htmlPath}`);

  // Save Markdown report
  const mdPath = path.join(outputDir, 'report.md');
  const markdown = exportIssues(result.issues, 'markdown');
  fs.writeFileSync(mdPath, markdown);
  console.log(`📝 Markdown report saved to: ${mdPath}`);

  console.log('\n✅ Analysis complete!\n');

  // Show top issues
  if (result.issues.length > 0) {
    console.log('🔝 Top 5 Issues:\n');
    result.issues.slice(0, 5).forEach((issue, i) => {
      console.log(`${i + 1}. ${issue.title}`);
      console.log(`   ${issue.file}:${issue.startLine}`);
      console.log(`   ${issue.severity} | ${issue.category}`);
      console.log('');
    });
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error('Error:', error);
    process.exit(1);
  });
}

module.exports = { main };
