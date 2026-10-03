/**
 * Agent System Integration Example
 * 
 * Demonstrates how the Phase 9 agent components work together:
 * - Pipeline execution with ledger tracking
 * - Work orchestration with dependencies
 * - Tool execution with permissions
 * - Scope analysis and code generation
 * - Auto-fix pipeline with multiple strategies
 */

'use strict';

const path = require('path');

// Import agent system components
const {
  WorkOrchestrator,
  AgentPlanner,
  ToolRegistry,
  PermissionManager,
  ApprovalMode,
  TaskScopeAnalyzer,
  CodeGenerator
} = require('../src/agent');

const {
  PipelineExecutor,
  ExecutionLedger,
  AutoFixPipeline,
  FixStrategy,
  AIIssueResolutionPipeline
} = require('../src/pipelines');

/**
 * Example 1: Complete Agent Workflow
 * 
 * Shows task analysis → planning → approval → execution → verification
 */
async function example1_completeWorkflow() {
  console.log('\n=== Example 1: Complete Agent Workflow ===\n');

  const workspace = process.cwd();

  // 1. Analyze task scope
  const scopeAnalyzer = new TaskScopeAnalyzer();
  const task = {
    id: 'TASK-001',
    description: 'Add input validation to user registration endpoint',
    deliverables: [
      'Validate email format',
      'Validate password strength',
      'Add error messages for invalid inputs'
    ],
    acceptanceCriteria: [
      'Email must match RFC 5322 format',
      'Password must be at least 8 characters',
      'Clear error messages returned for each validation failure'
    ]
  };

  const scopeAnalysis = scopeAnalyzer.analyze(task);
  console.log('Scope Analysis:');
  console.log(`  Type: ${scopeAnalysis.scopeType}`);
  console.log(`  Issues: ${scopeAnalysis.issues.length}`);
  console.log(`  Decomposition Required: ${scopeAnalysis.decompositionRequired}`);

  const readiness = scopeAnalyzer.validateReadiness(task);
  if (!readiness.ready) {
    console.log(`\n❌ Task not ready: ${readiness.reason}`);
    return;
  }

  console.log('\n✅ Task is ready for implementation\n');

  // 2. Create execution plan
  const planner = new AgentPlanner({ workspace });
  const plan = await planner.plan({
    description: task.description,
    deliverables: task.deliverables
  });

  console.log('Execution Plan:');
  console.log(`  Steps: ${plan.steps.length}`);
  console.log(`  Affected Files: ${plan.affectedFiles.length}`);
  console.log(`  Risks: ${plan.risks.length}`);
  console.log(`  Requires Approval: ${plan.metadata.requiresApproval}`);

  // 3. Set up permissions
  const permissionManager = new PermissionManager({
    workspace,
    mode: ApprovalMode.APPROVAL_REQUIRED,
    requestApproval: async (request) => {
      console.log('\n📋 Approval Request:');
      console.log(`  Operation: ${request.operation.type}`);
      console.log(`  Risk Level: ${request.risk.level}`);
      console.log(`  Factors: ${request.risk.factors.join(', ')}`);
      // Auto-approve for demo
      return true;
    }
  });

  // 4. Set up tool registry with permissions
  const toolRegistry = new ToolRegistry({ workspace });

  // 5. Execute a tool with permission check
  console.log('\n🔧 Executing Tool: read_file\n');
  
  const readPermission = await permissionManager.checkPermission({
    type: 'read_file',
    params: { path: 'package.json' }
  });

  if (readPermission.allowed) {
    const result = await toolRegistry.execute('read_file', {
      path: 'package.json',
      limit: 10
    });
    console.log(`  Success: ${result.success}`);
    console.log(`  Lines Read: ${result.data.linesRead}`);
  }

  console.log('\n✅ Workflow Complete');
}

/**
 * Example 2: Work Orchestration with Dependencies
 * 
 * Demonstrates concurrent execution with dependency tracking
 */
async function example2_workOrchestration() {
  console.log('\n=== Example 2: Work Orchestration with Dependencies ===\n');

  const orchestrator = new WorkOrchestrator({
    workspace: process.cwd(),
    maxConcurrent: 2,
    onProgress: (event) => {
      if (event.type === 'work-start' || event.type === 'work-complete') {
        console.log(`  ${event.type}: ${event.item.description}`);
      }
    }
  });

  // Add work items with dependencies
  const work1 = orchestrator.addWork({
    description: 'Analyze codebase structure',
    priority: 'HIGH',
    dependencies: []
  });

  const work2 = orchestrator.addWork({
    description: 'Implement validation logic',
    priority: 'HIGH',
    dependencies: [work1.id]
  });

  const work3 = orchestrator.addWork({
    description: 'Add unit tests',
    priority: 'MEDIUM',
    dependencies: [work2.id]
  });

  const work4 = orchestrator.addWork({
    description: 'Update documentation',
    priority: 'LOW',
    dependencies: [work2.id]
  });

  console.log('Work Queue Status:');
  const status = orchestrator.getStatus();
  console.log(`  Total: ${status.total}`);
  console.log(`  Queued: ${status.queued}`);
  console.log(`  Active: ${status.active}\n`);

  // Note: In a real implementation, executeAll() would run actual work
  // console.log('Executing all work...\n');
  // const results = await orchestrator.executeAll();
  // console.log(`\n✅ Results: ${results.completed} completed, ${results.failed} failed`);

  console.log('✅ Orchestration Example Complete');
}

/**
 * Example 3: Pipeline Execution with Ledger
 * 
 * Shows how pipelines record execution to the ledger
 */
async function example3_pipelineExecution() {
  console.log('\n=== Example 3: Pipeline Execution with Ledger ===\n');

  const workspace = process.cwd();
  const ledger = new ExecutionLedger({
    storePath: path.join(workspace, '.aqt-reports', 'pipelines')
  });

  const executor = new PipelineExecutor({ ledger });

  // Execute a simple pipeline
  const result = await executor.execute('workspace-quality-analysis', {
    input: { workspace, files: [], linters: [] },
    taskId: 'DEMO-001',
    workspace,
    stageHandlers: {
      'resolve-workspace': async (ctx) => ({ workspace }),
      'detect-tools': async (ctx) => ({ tools: ['eslint', 'prettier'] }),
      'select-files': async (ctx) => ({ files: [] }),
      'run-linters': async (ctx) => ({ issues: [] }),
      'collect-output': async (ctx) => ({ output: [] }),
      'normalize-issues': async (ctx) => ({ normalized: [] }),
      'deduplicate': async (ctx) => ({ unique: [] }),
      'sort': async (ctx) => ({ sorted: [] }),
      'summarize': async (ctx) => ({ 
        total: 0, 
        errors: 0, 
        warnings: 0 
      })
    }
  });

  console.log('Pipeline Execution:');
  console.log(`  Run ID: ${result.runId}`);
  console.log(`  Status: ${result.status}`);
  console.log(`  Stages Completed: ${Object.keys(result.stageResults).length}`);

  // Query execution history
  const summary = ledger.getRunSummary(result.runId);
  console.log('\nExecution Summary:');
  console.log(`  Pipeline: ${summary.pipelineId}`);
  console.log(`  Duration: ${summary.duration}ms`);
  console.log(`  Stages: ${summary.stages.length}`);

  console.log('\n✅ Pipeline Example Complete');
}

/**
 * Example 4: Auto-Fix Pipeline with Multiple Strategies
 * 
 * Demonstrates different fix strategies and fallback behavior
 */
async function example4_autoFixPipeline() {
  console.log('\n=== Example 4: Auto-Fix Pipeline ===\n');

  // Mock issues
  const issues = [
    {
      id: 'issue-1',
      file: 'src/validation.js',
      line: 42,
      rule: 'no-unused-vars',
      message: 'Variable "temp" is unused',
      fixable: true
    },
    {
      id: 'issue-2',
      file: 'src/validation.js',
      line: 58,
      rule: 'prefer-const',
      message: 'Use const instead of let',
      fixable: true
    }
  ];

  // Mock fixers
  const mockRuleFixer = {
    fix: async (issue) => ({
      success: true,
      confidence: 1.0,
      patch: {
        line: issue.line,
        replacement: '  // Fixed by rule-based fixer'
      }
    })
  };

  const autoFixPipeline = new AutoFixPipeline({
    workspace: process.cwd(),
    strategy: FixStrategy.LOCAL_FIRST,
    dryRun: true, // Don't actually modify files
    ruleBasedFixer: mockRuleFixer
  });

  console.log('Running auto-fix with LOCAL_FIRST strategy...\n');

  const result = await autoFixPipeline.execute({
    issues,
    taskId: 'AUTOFIX-001'
  });

  console.log('Auto-Fix Results:');
  console.log(`  Run ID: ${result.runId}`);
  console.log(`  Status: ${result.status}`);
  if (result.output) {
    console.log(`  Total Issues: ${result.output.total || 0}`);
    console.log(`  Fixed: ${result.output.fixed || 0}`);
    console.log(`  Dry Run: ${result.output.dryRun || false}`);
  }

  console.log('\n✅ Auto-Fix Example Complete');
}

/**
 * Example 5: Code Generation from Task
 * 
 * Shows task-driven code generation with traceability
 */
async function example5_codeGeneration() {
  console.log('\n=== Example 5: Code Generation from Task ===\n');

  const codeGenerator = new CodeGenerator({
    workspace: process.cwd()
  });

  const task = {
    id: 'GEN-001',
    description: 'Create user authentication service',
    deliverables: [
      'Login method with JWT generation',
      'Logout method to invalidate tokens',
      'Token validation middleware'
    ],
    acceptanceCriteria: [
      'JWT tokens expire after 24 hours',
      'Passwords are hashed with bcrypt',
      'Invalid tokens return 401 status'
    ]
  };

  console.log('Generating code for task:', task.id);
  console.log('Description:', task.description);
  console.log('Deliverables:', task.deliverables.length, '\n');

  const result = await codeGenerator.generate(task);

  console.log('Generation Results:');
  console.log(`  Success: ${result.success}`);
  console.log(`  Plan Steps: ${result.plan?.steps.length || 0}`);
  console.log(`  Patches: ${result.patches.length}`);
  console.log(`  Traceability:`);
  console.log(`    Task ID: ${result.traceability.taskId}`);
  console.log(`    Files Modified: ${result.traceability.codeChanges?.filesModified || 0}`);
  console.log(`    Files Created: ${result.traceability.codeChanges?.filesCreated || 0}`);

  // Validate generation
  const validation = codeGenerator.validate(result);
  console.log(`\n  Validation: ${validation.valid ? '✅ PASS' : '❌ FAIL'}`);
  if (validation.issues.length > 0) {
    console.log('  Issues:');
    validation.issues.forEach(issue => {
      console.log(`    - [${issue.severity}] ${issue.message}`);
    });
  }

  console.log('\n✅ Code Generation Example Complete');
}

/**
 * Run all examples
 */
async function runAllExamples() {
  console.log('\n╔════════════════════════════════════════════════════════╗');
  console.log('║   Phase 9 Agent System Integration Examples          ║');
  console.log('╚════════════════════════════════════════════════════════╝');

  try {
    await example1_completeWorkflow();
    await example2_workOrchestration();
    await example3_pipelineExecution();
    await example4_autoFixPipeline();
    await example5_codeGeneration();

    console.log('\n╔════════════════════════════════════════════════════════╗');
    console.log('║   All Examples Completed Successfully! ✅             ║');
    console.log('╚════════════════════════════════════════════════════════╝\n');
  } catch (error) {
    console.error('\n❌ Example failed:', error.message);
    console.error(error.stack);
  }
}

// Run if executed directly
if (require.main === module) {
  runAllExamples().catch(console.error);
}

module.exports = {
  example1_completeWorkflow,
  example2_workOrchestration,
  example3_pipelineExecution,
  example4_autoFixPipeline,
  example5_codeGeneration,
  runAllExamples
};
