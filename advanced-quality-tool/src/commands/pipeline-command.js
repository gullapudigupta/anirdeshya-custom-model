/**
 * Pipeline Command - CLI handler for pipeline management and execution
 * 
 * Usage:
 *   aqt pipeline list [options]
 *   aqt pipeline info <name> [options]
 *   aqt pipeline run <name> [options]
 *   aqt pipeline status <execution-id> [options]
 *   aqt pipeline replay <execution-id> [options]
 * 
 * Options:
 *   --format, -f      Output format: 'json', 'table', 'summary' (default: 'table')
 *   --input, -i       JSON input for pipeline run
 *   --workspace, -w   Workspace path (default: current directory)
 *   --task-id         Associated task ID
 *   --watch           Watch pipeline execution in real-time
 *   --verbose, -v     Verbose output
 *   --help, -h        Show help
 *
 * @module commands/pipeline-command
 */

'use strict';

const { getRegistry, PipelineRegistry } = require('../pipelines/pipeline-registry');
const { PipelineExecutor } = require('../pipelines/pipeline-executor');
const { ExecutionLedger, RunStatus } = require('../pipelines/execution-ledger');
const path = require('path');

/**
 * Main command router
 */
async function run(args) {
  const [subcommand, ...subArgs] = args;
  
  if (!subcommand || subcommand === '--help' || subcommand === '-h') {
    printHelp();
    return;
  }

  switch (subcommand) {
    case 'list':
    case 'ls':
      return listPipelines(subArgs);
    case 'info':
      return pipelineInfo(subArgs);
    case 'run':
    case 'execute':
      return runPipeline(subArgs);
    case 'status':
      return pipelineStatus(subArgs);
    case 'replay':
      return replayPipeline(subArgs);
    case 'history':
      return pipelineHistory(subArgs);
    default:
      console.error(`\n❌ Unknown subcommand: ${subcommand}\n`);
      printHelp();
      process.exit(1);
  }
}

/**
 * List all registered pipelines
 */
async function listPipelines(args) {
  const options = parseOptions(args);
  
  console.log('\n📋 Registered Pipelines\n');
  
  const registry = getRegistry();
  const pipelines = registry.list();
  
  if (pipelines.length === 0) {
    console.log('  No pipelines registered.\n');
    return;
  }

  if (options.format === 'json') {
    console.log(JSON.stringify(pipelines, null, 2));
    return;
  }

  // Table format
  console.log('  ID                              | Name                              | Version | Stages');
  console.log('  ' + '-'.repeat(95));
  
  for (const pipeline of pipelines) {
    const id = pipeline.id.padEnd(30);
    const name = pipeline.name.substring(0, 32).padEnd(32);
    const version = pipeline.version.padEnd(7);
    const stages = pipeline.stages.length;
    console.log(`  ${id} | ${name} | ${version} | ${stages} stages`);
  }
  
  console.log(`\n  Total: ${pipelines.length} pipeline(s)\n`);
  
  if (options.verbose) {
    console.log('  Pipeline Details:\n');
    for (const pipeline of pipelines) {
      console.log(`  ${pipeline.name} (${pipeline.id})`);
      console.log(`    Description: ${pipeline.metadata?.description || 'N/A'}`);
      console.log(`    Stages: ${pipeline.stages.join(' → ')}`);
      console.log('');
    }
  }
}

/**
 * Show detailed pipeline information
 */
async function pipelineInfo(args) {
  const options = parseOptions(args);
  const pipelineId = options.positional[0];
  
  if (!pipelineId) {
    console.error('\n❌ Pipeline ID is required.\n');
    console.log('Usage: aqt pipeline info <pipeline-id>\n');
    process.exit(1);
  }
  
  const registry = getRegistry();
  const pipeline = registry.get(pipelineId);
  
  if (!pipeline) {
    console.error(`\n❌ Pipeline '${pipelineId}' not found.\n`);
    console.log('Available pipelines: aqt pipeline list\n');
    process.exit(1);
  }
  
  if (options.format === 'json') {
    console.log(JSON.stringify(pipeline, null, 2));
    return;
  }
  
  console.log(`\n📦 Pipeline: ${pipeline.name}\n`);
  console.log(`  ID:          ${pipeline.id}`);
  console.log(`  Version:     ${pipeline.version}`);
  console.log(`  Registered:  ${pipeline.registeredAt || 'N/A'}`);
  console.log(`\n  Description: ${pipeline.metadata?.description || 'N/A'}`);
  
  console.log('\n  Stages:');
  pipeline.stages.forEach((stage, idx) => {
    console.log(`    ${idx + 1}. ${stage}`);
  });
  
  if (pipeline.schema) {
    console.log('\n  Input Schema:');
    if (pipeline.schema.input) {
      Object.entries(pipeline.schema.input).forEach(([key, type]) => {
        const optional = type.endsWith('?');
        console.log(`    - ${key}: ${type.replace('?', '')} ${optional ? '(optional)' : '(required)'}`);
      });
    }
    
    console.log('\n  Output Schema:');
    if (pipeline.schema.output) {
      Object.entries(pipeline.schema.output).forEach(([key, type]) => {
        console.log(`    - ${key}: ${type}`);
      });
    }
  }
  
  if (pipeline.verification) {
    console.log('\n  Verification:');
    console.log(`    Required: ${pipeline.verification.required ? 'Yes' : 'No'}`);
  }
  
  console.log('');
}

/**
 * Execute a pipeline
 */
async function runPipeline(args) {
  const options = parseOptions(args);
  const pipelineId = options.positional[0];
  
  if (!pipelineId) {
    console.error('\n❌ Pipeline ID is required.\n');
    console.log('Usage: aqt pipeline run <pipeline-id> [options]\n');
    process.exit(1);
  }
  
  const registry = getRegistry();
  const pipeline = registry.get(pipelineId);
  
  if (!pipeline) {
    console.error(`\n❌ Pipeline '${pipelineId}' not found.\n`);
    console.log('Available pipelines: aqt pipeline list\n');
    process.exit(1);
  }
  
  console.log(`\n🚀 Executing Pipeline: ${pipeline.name}\n`);
  console.log(`  Pipeline ID: ${pipelineId}`);
  console.log(`  Workspace:   ${options.workspace || process.cwd()}`);
  console.log(`  Task ID:     ${options.taskId || 'N/A'}`);
  
  // Parse input
  let input = {};
  if (options.input) {
    try {
      input = typeof options.input === 'string' ? JSON.parse(options.input) : options.input;
    } catch (e) {
      console.error(`\n❌ Invalid JSON input: ${e.message}\n`);
      process.exit(1);
    }
  }
  
  console.log(`  Input:       ${JSON.stringify(input)}`);
  console.log('');
  
  // Create executor
  const ledger = new ExecutionLedger();
  const executor = new PipelineExecutor({ registry, ledger });
  
  // Progress tracking
  let currentStage = null;
  const startTime = Date.now();
  
  const onProgress = options.watch ? (event) => {
    switch (event.type) {
      case 'run-start':
        console.log(`\n  ▶ Run started: ${event.runId}`);
        break;
      case 'stage-start':
        currentStage = event.stageName;
        console.log(`\n  ⏳ Stage: ${event.stageName}`);
        break;
      case 'stage-end':
        if (event.success) {
          console.log(`  ✅ Stage completed (${event.duration}ms)`);
        } else {
          console.log(`  ❌ Stage failed (${event.duration}ms)`);
        }
        break;
      case 'run-complete':
        console.log(`\n  ✅ Pipeline completed successfully`);
        break;
      case 'run-fail':
        console.log(`\n  ❌ Pipeline failed: ${event.error}`);
        break;
      case 'run-cancel':
        console.log(`\n  ⚠️ Pipeline cancelled`);
        break;
    }
  } : null;
  
  try {
    // For demonstration, we'll create a mock execution
    // In real usage, stage handlers would be provided by the calling context
    const stageHandlers = createMockStageHandlers(pipeline, options);
    
    const result = await executor.execute(pipelineId, {
      input,
      taskId: options.taskId,
      workspace: options.workspace || process.cwd(),
      stageHandlers,
      onProgress
    });
    
    const totalDuration = Date.now() - startTime;
    
    console.log('\n  ─────────────────────────────────────');
    console.log(`  Run ID:     ${result.runId}`);
    console.log(`  Status:     ${result.status}`);
    console.log(`  Duration:   ${totalDuration}ms`);
    
    if (result.error) {
      console.log(`  Error:      ${result.error}`);
    }
    
    if (result.output && options.verbose) {
      console.log('\n  Output:');
      console.log(JSON.stringify(result.output, null, 4));
    }
    
    console.log('');
    
    // Exit with appropriate code
    if (result.status === RunStatus.COMPLETED) {
      process.exit(0);
    } else if (result.status === RunStatus.CANCELLED) {
      process.exit(130); // Standard exit code for Ctrl+C
    } else {
      process.exit(1);
    }
    
  } catch (error) {
    console.error(`\n❌ Execution failed: ${error.message}\n`);
    if (options.verbose) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

/**
 * Get pipeline execution status
 */
async function pipelineStatus(args) {
  const options = parseOptions(args);
  const runId = options.positional[0];
  
  if (!runId) {
    console.error('\n❌ Run ID is required.\n');
    console.log('Usage: aqt pipeline status <run-id>\n');
    process.exit(1);
  }
  
  const ledger = new ExecutionLedger();
  const summary = ledger.getRunSummary(runId);
  
  if (!summary) {
    console.error(`\n❌ Run '${runId}' not found.\n`);
    console.log('View recent runs: aqt pipeline history\n');
    process.exit(1);
  }
  
  if (options.format === 'json') {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }
  
  const statusIcon = {
    [RunStatus.COMPLETED]: '✅',
    [RunStatus.RUNNING]: '⏳',
    [RunStatus.FAILED]: '❌',
    [RunStatus.CANCELLED]: '⚠️',
    [RunStatus.QUEUED]: '📋'
  }[summary.status] || '❓';
  
  console.log(`\n${statusIcon} Pipeline Execution: ${runId}\n`);
  console.log(`  Pipeline:    ${summary.pipelineId}`);
  console.log(`  Status:      ${summary.status}`);
  console.log(`  Workspace:   ${summary.workspace || 'N/A'}`);
  console.log(`  Task ID:     ${summary.taskId || 'N/A'}`);
  console.log(`  Started:     ${summary.started}`);
  
  if (summary.completed) {
    console.log(`  Completed:   ${summary.completed}`);
    console.log(`  Duration:    ${summary.duration}ms`);
  }
  
  if (summary.error) {
    console.log(`  Error:       ${summary.error}`);
  }
  
  if (summary.stages && summary.stages.length > 0) {
    console.log('\n  Stages:');
    for (const stage of summary.stages) {
      const stageIcon = stage.result?.success ? '✅' : (stage.completed ? '❌' : '⏳');
      console.log(`    ${stageIcon} ${stage.name}`);
      if (stage.duration) {
        console.log(`       Duration: ${stage.duration}ms`);
      }
      if (stage.result?.error) {
        console.log(`       Error: ${stage.result.error}`);
      }
    }
  }
  
  if (summary.metrics) {
    console.log('\n  Metrics:');
    console.log(`    Tool Calls:    ${summary.metrics.toolCalls || 0}`);
    console.log(`    Model Calls:   ${summary.metrics.modelCalls || 0}`);
    console.log(`    Total Tokens:  ${summary.metrics.totalTokens || 0}`);
    console.log(`    Total Cost:    $${(summary.metrics.totalCost || 0).toFixed(4)}`);
    console.log(`    Files Changed: ${summary.metrics.filesChanged || 0}`);
  }
  
  console.log('');
}

/**
 * Replay a previous pipeline execution
 */
async function replayPipeline(args) {
  const options = parseOptions(args);
  const runId = options.positional[0];
  
  if (!runId) {
    console.error('\n❌ Run ID is required.\n');
    console.log('Usage: aqt pipeline replay <run-id>\n');
    process.exit(1);
  }
  
  console.log(`\n🔄 Replaying Pipeline Execution: ${runId}\n`);
  
  const ledger = new ExecutionLedger();
  const summary = ledger.getRunSummary(runId);
  
  if (!summary) {
    console.error(`\n❌ Run '${runId}' not found.\n`);
    process.exit(1);
  }
  
  console.log(`  Original Pipeline: ${summary.pipelineId}`);
  console.log(`  Original Status:   ${summary.status}`);
  console.log(`  Original Duration: ${summary.duration}ms`);
  console.log('');
  
  // Get the original run events
  const events = ledger.getRun(runId);
  const startEvent = events.find(e => e.type === 'run-start');
  
  if (!startEvent) {
    console.error('\n❌ Could not find original run start event.\n');
    process.exit(1);
  }
  
  // Re-execute with the same input
  console.log('  Re-executing with original input...\n');
  
  // For now, we'll just show what would be replayed
  // Full replay would require re-running with the same stage handlers
  console.log('  Original Input:');
  console.log(JSON.stringify(startEvent.input, null, 4));
  console.log('\n  Original Context:');
  console.log(JSON.stringify(startEvent.context, null, 4));
  
  console.log('\n  Note: Full replay requires the same stage handlers to be available.');
  console.log('  Use the API or SDK for programmatic replay with custom handlers.\n');
}

/**
 * Show pipeline execution history
 */
async function pipelineHistory(args) {
  const options = parseOptions(args);
  
  console.log('\n📜 Pipeline Execution History\n');
  
  const ledger = new ExecutionLedger();
  const criteria = {};
  
  if (options.pipelineId) {
    criteria.pipelineId = options.pipelineId;
  }
  if (options.since) {
    criteria.since = options.since;
  }
  if (options.status) {
    criteria.status = options.status;
  }
  
  const events = ledger.query(criteria);
  
  // Group by run
  const runs = new Map();
  for (const event of events) {
    if (!runs.has(event.runId)) {
      runs.set(event.runId, []);
    }
    runs.get(event.runId).push(event);
  }
  
  if (runs.size === 0) {
    console.log('  No pipeline executions found.\n');
    return;
  }
  
  if (options.format === 'json') {
    const summaries = Array.from(runs.keys()).map(runId => ledger.getRunSummary(runId));
    console.log(JSON.stringify(summaries, null, 2));
    return;
  }
  
  console.log('  Run ID                         | Pipeline                    | Status     | Started');
  console.log('  ' + '-'.repeat(85));
  
  const sortedRuns = Array.from(runs.entries())
    .sort((a, b) => {
      const aStart = a[1].find(e => e.type === 'run-start')?.timestamp || '';
      const bStart = b[1].find(e => e.type === 'run-start')?.timestamp || '';
      return bStart.localeCompare(aStart);
    })
    .slice(0, 20); // Show last 20 runs
  
  for (const [runId, runEvents] of sortedRuns) {
    const startEvent = runEvents.find(e => e.type === 'run-start');
    const endEvent = runEvents.find(e => e.status);
    
    if (!startEvent) continue;
    
    const runIdShort = runId.substring(0, 30).padEnd(30);
    const pipelineId = startEvent.pipelineId.substring(0, 27).padEnd(27);
    const status = (endEvent?.status || 'running').padEnd(10);
    const started = new Date(startEvent.timestamp).toLocaleString().substring(0, 19);
    
    const statusIcon = {
      'completed': '✅',
      'running': '⏳',
      'failed': '❌',
      'cancelled': '⚠️'
    }[endEvent?.status] || '❓';
    
    console.log(`  ${runIdShort} | ${pipelineId} | ${statusIcon} ${status} | ${started}`);
  }
  
  console.log(`\n  Total: ${runs.size} execution(s)`);
  console.log('\n  View details: aqt pipeline status <run-id>');
  console.log('  Replay run:   aqt pipeline replay <run-id>\n');
}

/**
 * Create mock stage handlers for demonstration
 */
function createMockStageHandlers(pipeline, options) {
  const handlers = {};
  
  for (const stageName of pipeline.stages) {
    handlers[stageName] = async (context) => {
      // Simulate stage execution
      await new Promise(resolve => setTimeout(resolve, 100));
      
      return {
        stage: stageName,
        status: 'completed',
        timestamp: new Date().toISOString()
      };
    };
  }
  
  return handlers;
}

/**
 * Parse command options
 */
function parseOptions(args) {
  const options = {
    positional: [],
    format: 'table',
    workspace: process.cwd(),
    input: null,
    taskId: null,
    pipelineId: null,
    since: null,
    status: null,
    watch: false,
    verbose: false
  };
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === '--format' || arg === '-f') {
      options.format = args[++i];
    } else if (arg === '--workspace' || arg === '-w') {
      options.workspace = args[++i];
    } else if (arg === '--input' || arg === '-i') {
      options.input = args[++i];
    } else if (arg === '--task-id') {
      options.taskId = args[++i];
    } else if (arg === '--pipeline-id') {
      options.pipelineId = args[++i];
    } else if (arg === '--since') {
      options.since = args[++i];
    } else if (arg === '--status') {
      options.status = args[++i];
    } else if (arg === '--watch') {
      options.watch = true;
    } else if (arg === '--verbose' || arg === '-v') {
      options.verbose = true;
    } else if (!arg.startsWith('-')) {
      options.positional.push(arg);
    }
  }
  
  return options;
}

/**
 * Print help
 */
function printHelp() {
  console.log(`
📖 Pipeline Command Help

Usage:
  aqt pipeline <subcommand> [options]

Subcommands:
  list                List all registered pipelines
  info <id>           Show detailed pipeline information
  run <id>            Execute a pipeline
  status <run-id>     Show execution status
  replay <run-id>     Replay a previous execution
  history             Show execution history

Options:
  --format, -f <format>   Output format: 'json', 'table' (default: 'table')
  --workspace, -w <path>  Workspace path (default: current directory)
  --input, -i <json>      JSON input for pipeline run
  --task-id <id>          Associated task ID
  --pipeline-id <id>      Filter history by pipeline ID
  --since <date>          Filter history since date
  --status <status>       Filter history by status
  --watch                 Watch pipeline execution in real-time
  --verbose, -v           Verbose output
  --help, -h              Show this help

Examples:
  aqt pipeline list
  aqt pipeline list --format json
  aqt pipeline info workspace-quality-analysis
  aqt pipeline run auto-fix --workspace ./src --watch
  aqt pipeline run auto-fix --input '{"strategy":"rule-only"}'
  aqt pipeline status run-1697123456789-abc123
  aqt pipeline replay run-1697123456789-abc123
  aqt pipeline history --pipeline-id auto-fix
  aqt pipeline history --since "2024-01-01"

Available Pipelines:
  - workspace-quality-analysis  : Analyze workspace code quality
  - issue-enrichment            : Categorize and enrich issues
  - auto-fix                    : Rule and AI auto-fix
  - ai-issue-resolution         : AI-powered issue resolution
  - ai-code-review              : AI code review
  - watch-and-fix               : Continuous watch and auto-fix
  - ci-quality-gate             : CI/CD quality gate
  - language-analysis           : Multi-language analyzer
  - security-scan               : Security scanning
  - quality-metrics             : Performance and quality metrics
  - vscode-quality-feedback     : VS Code diagnostics
  - chat-interaction            : Chat UI interaction
  - cli-command                 : CLI command execution
  - dashboard-reporting         : Dashboard and trends
  - pipeline-replay             : Pipeline replay testing
  - documentation-generation    : Documentation generation

Note:
  - Pipeline execution requires appropriate stage handlers
  - Use the API or SDK for programmatic execution with custom handlers
  - All executions are recorded in .aqt-reports/pipelines/
`);
}

module.exports = {
  run,
  printHelp
};
