/**
 * Workspace Quality Analysis Pipeline Example (P9-T025)
 *
 * Demonstrates how to use the workspace quality analysis pipeline
 * to analyze code quality across a workspace.
 */

'use strict';

const { WorkspaceQualityAnalysis } = require('../src/pipelines/workspace-quality-analysis');
const path = require('path');

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  Workspace Quality Analysis Pipeline Example');
  console.log('═══════════════════════════════════════════════════════════\n');

  // Initialize the pipeline
  const analysis = new WorkspaceQualityAnalysis();

  // Example 1: Analyze current workspace with all available linters
  console.log('Example 1: Full Workspace Analysis\n');
  console.log('Running analysis on current workspace...\n');

  try {
    const result = await analysis.analyze({
      workspace: process.cwd(), // Use current directory
      files: [], // Auto-discover files
      linters: [], // Use all available linters
      taskId: 'EXAMPLE-001',
      onProgress: (event) => {
        // Progress callback
        switch (event.type) {
          case 'run-start':
            console.log(`▶ Started pipeline run: ${event.runId}`);
            break;
          case 'stage-start':
            console.log(`  ⏳ Starting stage: ${event.stageName}`);
            break;
          case 'stage-end':
            console.log(`  ✓ Completed stage: ${event.stageName} (${event.duration}ms)`);
            break;
          case 'stage-error':
            console.log(`  ✗ Stage failed: ${event.stageName} - ${event.error}`);
            break;
          case 'run-complete':
            console.log(`✓ Pipeline completed successfully`);
            break;
          case 'run-fail':
            console.log(`✗ Pipeline failed: ${event.error}`);
            break;
        }
      }
    });

    console.log('\n─── Analysis Results ───\n');
    console.log(`Status: ${result.status}`);
    console.log(`Run ID: ${result.runId}`);
    
    if (result.status === 'completed' && result.output) {
      const { summary, stats } = result.output;
      
      console.log('\n─── Summary ───');
      console.log(`Workspace: ${summary.workspace}`);
      console.log(`Project: ${summary.projectName} v${summary.projectVersion}`);
      console.log(`Files Analyzed: ${summary.analyzedFiles}`);
      console.log(`Total Issues: ${summary.totalIssues}`);
      console.log(`  - Errors: ${summary.bySeverity.error}`);
      console.log(`  - Warnings: ${summary.bySeverity.warning}`);
      console.log(`  - Info: ${summary.bySeverity.info}`);
      console.log(`Fixable Issues: ${summary.fixableIssues}`);
      console.log(`Duplicates Removed: ${summary.duplicatesRemoved}`);
      console.log(`Linters Run: ${summary.lintersRun}/${summary.totalLinters}`);
      
      console.log('\n─── Statistics ───');
      console.log(`Issues per File: ${stats.issuesPerFile}`);
      console.log(`Error Rate: ${stats.errorRate}%`);
      console.log(`Fixable Rate: ${stats.fixableRate}%`);
      
      if (summary.topRules.length > 0) {
        console.log('\n─── Top Issues by Rule ───');
        summary.topRules.slice(0, 5).forEach((item, index) => {
          console.log(`${index + 1}. ${item.rule}: ${item.count} occurrences`);
        });
      }
      
      if (summary.topFiles.length > 0) {
        console.log('\n─── Most Problematic Files ───');
        summary.topFiles.slice(0, 5).forEach((item, index) => {
          const relativePath = path.relative(summary.workspace, item.file);
          console.log(`${index + 1}. ${relativePath}: ${item.count} issues`);
        });
      }
    }

  } catch (error) {
    console.error('\n✗ Analysis failed:', error.message);
    console.error(error.stack);
  }

  // Example 2: Analyze specific files
  console.log('\n\n═══════════════════════════════════════════════════════════');
  console.log('Example 2: Analyze Specific Files\n');

  try {
    const specificFiles = [
      path.join(process.cwd(), 'src', 'pipelines', 'workspace-quality-analysis.js'),
      path.join(process.cwd(), 'src', 'pipelines', 'pipeline-executor.js')
    ];

    console.log('Analyzing specific files:');
    specificFiles.forEach(f => console.log(`  - ${path.relative(process.cwd(), f)}`));
    console.log('');

    const result = await analysis.analyze({
      workspace: process.cwd(),
      files: specificFiles,
      linters: ['eslint'], // Only run ESLint
      taskId: 'EXAMPLE-002'
    });

    if (result.status === 'completed' && result.output) {
      console.log(`\n✓ Found ${result.output.summary.totalIssues} issues in ${result.output.summary.analyzedFiles} files`);
    }

  } catch (error) {
    console.error('\n✗ Analysis failed:', error.message);
  }

  // Example 3: Query execution history
  console.log('\n\n═══════════════════════════════════════════════════════════');
  console.log('Example 3: Query Execution History\n');

  try {
    const history = analysis.executor.query({
      pipelineId: 'workspace-quality-analysis',
      limit: 5
    });

    console.log(`Found ${history.length} recent pipeline runs:\n`);
    
    history.forEach((run, index) => {
      console.log(`${index + 1}. Run ${run.runId.slice(0, 8)}...`);
      console.log(`   Status: ${run.status}`);
      console.log(`   Task: ${run.taskId || 'N/A'}`);
      console.log(`   Started: ${new Date(run.startTime).toLocaleString()}`);
      if (run.endTime) {
        const duration = new Date(run.endTime) - new Date(run.startTime);
        console.log(`   Duration: ${duration}ms`);
      }
      console.log('');
    });

  } catch (error) {
    console.error('\n✗ Query failed:', error.message);
  }

  console.log('═══════════════════════════════════════════════════════════');
}

// Run if executed directly
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { main };
