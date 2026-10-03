/**
 * End-to-End Fix Workflow Example
 * 
 * Demonstrates a complete workflow from issue detection to resolution:
 * 1. Analyze workspace for issues
 * 2. Categorize and prioritize issues
 * 3. Attempt rule-based fixes
 * 4. Fall back to AI fixes for complex issues
 * 5. Validate all fixes
 * 6. Track everything in the execution ledger
 */

'use strict';

const {
  ToolRegistry,
  PermissionManager,
  ApprovalMode
} = require('../src/agent');

const {
  PipelineExecutor,
  ExecutionLedger,
  AutoFixPipeline,
  FixStrategy,
  AIIssueResolutionPipeline
} = require('../src/pipelines');

const { IssueCategorizationEngine } = require('../src/core/issue-categorizer');

/**
 * Complete end-to-end fix workflow
 */
async function endToEndFixWorkflow() {
  console.log('\n╔═══════════════════════════════════════════════════╗');
  console.log('║   End-to-End Automated Fix Workflow              ║');
  console.log('╚═══════════════════════════════════════════════════╝\n');

  const workspace = process.cwd();

  // ─────────────────────────────────────────────────────────────────
  // STEP 1: Initialize Components
  // ─────────────────────────────────────────────────────────────────
  console.log('Step 1: Initializing components...\n');

  const ledger = new ExecutionLedger({
    storePath: `${workspace}/.aqt-reports/pipelines`,
    redactSecrets: true
  });

  const permissionManager = new PermissionManager({
    workspace,
    mode: ApprovalMode.APPROVAL_REQUIRED,
    allowFileWrites: true,
    allowDeletes: false,
    requestApproval: async (request) => {
      console.log(`  ⚠️  Approval needed: ${request.operation.type} (risk: ${request.risk.level})`);
      // Auto-approve for demo (in real app, this would prompt user)
      return true;
    }
  });

  const toolRegistry = new ToolRegistry({ workspace });

  console.log('  ✅ Components initialized\n');

  // ─────────────────────────────────────────────────────────────────
  // STEP 2: Detect Issues
  // ─────────────────────────────────────────────────────────────────
  console.log('Step 2: Detecting code quality issues...\n');

  // Simulate detected issues (in real workflow, these come from linters)
  const detectedIssues = [
    {
      id: 'eslint-1',
      file: 'src/validation.js',
      line: 42,
      column: 10,
      rule: 'no-unused-vars',
      message: 'Variable "tempValue" is declared but never used',
      severity: 'error',
      source: 'eslint',
      fixable: true
    },
    {
      id: 'eslint-2',
      file: 'src/validation.js',
      line: 58,
      column: 5,
      rule: 'prefer-const',
      message: 'Identifier "result" is never reassigned. Use "const" instead of "let"',
      severity: 'warning',
      source: 'eslint',
      fixable: true
    },
    {
      id: 'eslint-3',
      file: 'src/api.js',
      line: 120,
      column: 15,
      rule: 'no-console',
      message: 'Unexpected console statement',
      severity: 'warning',
      source: 'eslint',
      fixable: false
    },
    {
      id: 'typescript-1',
      file: 'src/types.ts',
      line: 23,
      column: 18,
      rule: 'TS2322',
      message: 'Type "string" is not assignable to type "number"',
      severity: 'error',
      source: 'typescript',
      fixable: false
    }
  ];

  console.log(`  Found ${detectedIssues.length} issues across ${[...new Set(detectedIssues.map(i => i.file))].length} files\n`);

  // ─────────────────────────────────────────────────────────────────
  // STEP 3: Categorize and Prioritize
  // ─────────────────────────────────────────────────────────────────
  console.log('Step 3: Categorizing and prioritizing issues...\n');

  const categorizer = new IssueCategorizationEngine();
  const categorizedIssues = detectedIssues.map(issue => {
    const category = categorizer.categorize(issue);
    return { ...issue, category: category.category, priority: category.priority };
  });

  const fixableIssues = categorizedIssues.filter(i => i.fixable);
  const manualIssues = categorizedIssues.filter(i => !i.fixable);

  console.log(`  Fixable: ${fixableIssues.length}`);
  console.log(`  Require Manual Review: ${manualIssues.length}\n`);

  // ─────────────────────────────────────────────────────────────────
  // STEP 4: Apply Rule-Based Fixes
  // ─────────────────────────────────────────────────────────────────
  console.log('Step 4: Applying rule-based fixes...\n');

  // Mock rule-based fixer
  const mockRuleFixer = {
    fix: async (issue) => {
      // Simulate fix for simple rules
      if (issue.rule === 'no-unused-vars') {
        return {
          success: true,
          confidence: 1.0,
          duration: 5,
          patch: {
            line: issue.line,
            replacement: '  // Removed unused variable'
          }
        };
      }
      if (issue.rule === 'prefer-const') {
        return {
          success: true,
          confidence: 1.0,
          duration: 3,
          patch: {
            line: issue.line,
            replacement: '  const result = calculateResult();'
          }
        };
      }
      return { success: false, error: 'No rule available' };
    }
  };

  const autoFixPipeline = new AutoFixPipeline({
    workspace,
    strategy: FixStrategy.LOCAL_FIRST,
    dryRun: true, // Dry run for demo
    ruleBasedFixer: mockRuleFixer,
    executor: new PipelineExecutor({ ledger })
  });

  const fixResult = await autoFixPipeline.execute({
    issues: fixableIssues,
    taskId: 'AUTO-FIX-001',
    strategy: FixStrategy.RULE_ONLY // Try rules first
  });

  console.log('  Rule-Based Fix Results:');
  if (fixResult.output) {
    console.log(`    Total: ${fixResult.output.total || 0}`);
    console.log(`    Fixed: ${fixResult.output.fixed || 0}`);
    console.log(`    Failed: ${fixResult.output.failed || 0}`);
  }
  console.log(`    Run ID: ${fixResult.runId}\n`);

  // ─────────────────────────────────────────────────────────────────
  // STEP 5: AI-Powered Fix for Complex Issues
  // ─────────────────────────────────────────────────────────────────
  console.log('Step 5: Attempting AI-powered fixes for remaining issues...\n');

  // Get issues that weren't fixed by rules
  const remainingIssues = manualIssues.slice(0, 1); // Just one for demo

  if (remainingIssues.length > 0) {
    const aiPipeline = new AIIssueResolutionPipeline({
      workspace,
      strategy: 'local-first',
      executor: new PipelineExecutor({ ledger })
    });

    console.log(`  Processing ${remainingIssues.length} complex issues with AI...\n`);

    for (const issue of remainingIssues) {
      console.log(`  Issue: ${issue.id} - ${issue.message}`);
      
      // In real implementation, this would call actual AI models
      console.log(`    → Classifying issue...`);
      console.log(`    → Analyzing code context...`);
      console.log(`    → Searching documentation...`);
      console.log(`    → Generating fix...`);
      console.log(`    ✅ Fix proposed (requires review)\n`);
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // STEP 6: Generate Fix Summary Report
  // ─────────────────────────────────────────────────────────────────
  console.log('Step 6: Generating fix summary report...\n');

  const summary = ledger.getRunSummary(fixResult.runId);
  
  console.log('  Execution Summary:');
  console.log(`    Pipeline: ${summary.pipelineId}`);
  console.log(`    Status: ${summary.status}`);
  console.log(`    Duration: ${summary.duration}ms`);
  console.log(`    Stages Completed: ${summary.stages.length}`);
  console.log(`    Tool Calls: ${summary.metrics.toolCalls}`);
  console.log(`    Model Calls: ${summary.metrics.modelCalls}`);
  console.log(`    Total Cost: $${summary.metrics.totalCost.toFixed(4)}`);

  // ─────────────────────────────────────────────────────────────────
  // STEP 7: Query Historical Data
  // ─────────────────────────────────────────────────────────────────
  console.log('\nStep 7: Querying historical fix data...\n');

  const recentRuns = ledger.query({
    pipelineId: 'auto-fix',
    since: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString() // Last 7 days
  });

  console.log(`  Recent auto-fix runs: ${recentRuns.length}`);

  // ─────────────────────────────────────────────────────────────────
  // COMPLETE
  // ─────────────────────────────────────────────────────────────────
  console.log('\n╔═══════════════════════════════════════════════════╗');
  console.log('║   Workflow Complete! ✅                           ║');
  console.log('╚═══════════════════════════════════════════════════╝\n');

  return {
    detected: detectedIssues.length,
    fixable: fixableIssues.length,
    ruleFixed: fixResult.output?.fixed || 0,
    aiAttempted: remainingIssues.length,
    runId: fixResult.runId
  };
}

// Run if executed directly
if (require.main === module) {
  endToEndFixWorkflow()
    .then(result => {
      console.log('\nFinal Summary:');
      console.log(`  Issues Detected: ${result.detected}`);
      console.log(`  Fixable: ${result.fixable}`);
      console.log(`  Fixed by Rules: ${result.ruleFixed}`);
      console.log(`  AI Attempted: ${result.aiAttempted}`);
      console.log(`  Ledger Run ID: ${result.runId}\n`);
    })
    .catch(error => {
      console.error('\n❌ Workflow failed:', error.message);
      console.error(error.stack);
    });
}

module.exports = { endToEndFixWorkflow };
