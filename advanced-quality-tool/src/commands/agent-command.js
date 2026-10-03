/**
 * Agent Command - CLI handler for autonomous agent operations
 * 
 * Usage:
 *   aqt agent start <description> [options]
 *   aqt agent status <work-id> [options]
 *   aqt agent list [options]
 *   aqt agent cancel <work-id> [options]
 *   aqt agent approve <work-id> [options]
 *   aqt agent logs <work-id> [options]
 * 
 * Options:
 *   --workspace, -w   Workspace path (default: current directory)
 *   --files           Files to include in the work
 *   --priority        Priority: 'critical', 'high', 'medium', 'low' (default: 'medium')
 *   --auto-approve    Automatically approve high-risk operations
 *   --max-files       Maximum files to modify (default: 50)
 *   --format, -f      Output format: 'json', 'table' (default: 'table')
 *   --follow          Follow logs in real-time
 *   --verbose, -v     Verbose output
 *   --help, -h        Show help
 *
 * @module commands/agent-command
 */

'use strict';

const { WorkOrchestrator } = require('../agent/work-orchestrator');
const { AgentPlanner } = require('../agent/planner');
const { WorkItem, WorkItemStatus } = require('../agent/work-item');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// In-memory work storage (in production, this would be persistent)
const workStore = new Map();

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
    case 'start':
      return startAgent(subArgs);
    case 'status':
      return workStatus(subArgs);
    case 'list':
    case 'ls':
      return listWork(subArgs);
    case 'cancel':
      return cancelWork(subArgs);
    case 'approve':
      return approveWork(subArgs);
    case 'logs':
      return workLogs(subArgs);
    default:
      console.error(`\n❌ Unknown subcommand: ${subcommand}\n`);
      printHelp();
      process.exit(1);
  }
}

/**
 * Start autonomous agent work
 */
async function startAgent(args) {
  const options = parseOptions(args);
  const description = options.positional.join(' ');
  
  if (!description) {
    console.error('\n❌ Work description is required.\n');
    console.log('Usage: aqt agent start <description>\n');
    process.exit(1);
  }
  
  console.log('\n🤖 Starting Agent Work\n');
  console.log(`  Description: ${description}`);
  console.log(`  Workspace:   ${options.workspace}`);
  console.log(`  Priority:    ${options.priority}`);
  console.log(`  Max Files:   ${options.maxFiles}`);
  console.log('');
  
  // Create work orchestrator
  const planner = new AgentPlanner({ workspace: options.workspace });
  const orchestrator = new WorkOrchestrator({
    workspace: options.workspace,
    planner,
    maxConcurrent: 1,
    permissionLimits: {
      maxFilesPerTask: options.maxFiles,
      requireApprovalForHighRisk: !options.autoApprove,
      requireApprovalForDelete: !options.autoApprove
    },
    onProgress: options.verbose ? (event) => {
      console.log(`  [${event.type}] ${event.item?.id || ''}`);
    } : null,
    onApprovalRequired: async (item, plan) => {
      console.log('\n  ⚠️  Approval Required');
      console.log(`  Work: ${item.description}`);
      console.log(`  Risk Level: ${plan.risks.map(r => r.level).join(', ') || 'none'}`);
      console.log(`  Affected Files: ${plan.affectedFiles.length}`);
      return options.autoApprove;
    }
  });
  
  // Create work item
  const workItem = orchestrator.addWork({
    description,
    files: options.files,
    priority: options.priority,
    plan: {
      deliverables: options.deliverables || []
    }
  });
  
  // Store for later reference
  workStore.set(workItem.id, {
    orchestrator,
    item: workItem,
    options,
    logs: [],
    started: new Date().toISOString()
  });
  
  console.log(`  Work ID: ${workItem.id}`);
  console.log('\n  Planning execution...');
  
  try {
    // Execute the work
    const results = await orchestrator.executeOne(workItem.id);
    
    console.log('\n  ─────────────────────────────────────');
    console.log(`  Status: ${results.status}`);
    
    if (results.status === 'completed') {
      console.log('  ✅ Work completed successfully');
      
      if (results.output && options.verbose) {
        console.log('\n  Output:');
        console.log(JSON.stringify(results.output, null, 4));
      }
    } else if (results.status === 'failed') {
      console.log(`  ❌ Work failed: ${results.error}`);
    } else if (results.status === 'cancelled') {
      console.log(`  ⚠️ Work cancelled: ${results.reason}`);
    }
    
    console.log('');
    
    // Save work record
    saveWorkRecord(workItem.id, results);
    
    process.exit(results.status === 'completed' ? 0 : 1);
    
  } catch (error) {
    console.error(`\n❌ Execution failed: ${error.message}\n`);
    if (options.verbose) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

/**
 * Get work status
 */
async function workStatus(args) {
  const options = parseOptions(args);
  const workId = options.positional[0];
  
  if (!workId) {
    console.error('\n❌ Work ID is required.\n');
    console.log('Usage: aqt agent status <work-id>\n');
    process.exit(1);
  }
  
  // Check memory store first
  const stored = workStore.get(workId);
  
  if (stored) {
    const item = stored.item;
    const summary = item.getSummary();
    
    if (options.format === 'json') {
      console.log(JSON.stringify(summary, null, 2));
      return;
    }
    
    const statusIcon = {
      [WorkItemStatus.QUEUED]: '📋',
      [WorkItemStatus.PLANNING]: '🔍',
      [WorkItemStatus.AWAITING_APPROVAL]: '⚠️',
      [WorkItemStatus.WORKING]: '⏳',
      [WorkItemStatus.VERIFYING]: '✅',
      [WorkItemStatus.COMPLETED]: '✅',
      [WorkItemStatus.FAILED]: '❌',
      [WorkItemStatus.CANCELLED]: '🚫',
      [WorkItemStatus.BLOCKED]: '🔒'
    }[summary.status] || '❓';
    
    console.log(`\n${statusIcon} Agent Work: ${workId}\n`);
    console.log(`  Description:  ${summary.description}`);
    console.log(`  Status:       ${summary.status}`);
    console.log(`  Priority:     ${summary.priority}`);
    console.log(`  Retry Count:  ${summary.retryCount}/${summary.maxRetries}`);
    console.log(`  Started:      ${stored.started}`);
    
    if (summary.plan) {
      console.log('\n  Plan:');
      console.log(`    Steps:          ${summary.plan.steps?.length || 0}`);
      console.log(`    Affected Files: ${summary.plan.affectedFiles?.length || 0}`);
      console.log(`    Complexity:     ${summary.plan.metadata?.estimatedComplexity || 'N/A'}`);
      
      if (summary.plan.risks?.length > 0) {
        console.log('    Risks:');
        for (const risk of summary.plan.risks) {
          console.log(`      - [${risk.level}] ${risk.description}`);
        }
      }
    }
    
    if (summary.error) {
      console.log(`\n  Error: ${summary.error}`);
    }
    
    if (summary.output && options.verbose) {
      console.log('\n  Output:');
      console.log(JSON.stringify(summary.output, null, 4));
    }
    
    console.log('');
    return;
  }
  
  // Check saved records
  const record = loadWorkRecord(workId);
  
  if (!record) {
    console.error(`\n❌ Work '${workId}' not found.\n`);
    console.log('List active work: aqt agent list\n');
    process.exit(1);
  }
  
  if (options.format === 'json') {
    console.log(JSON.stringify(record, null, 2));
    return;
  }
  
  console.log(`\n📄 Agent Work Record: ${workId}\n`);
  console.log(`  Description: ${record.description}`);
  console.log(`  Status:      ${record.status}`);
  console.log(`  Started:     ${record.started}`);
  console.log(`  Completed:   ${record.completed || 'N/A'}`);
  
  if (record.error) {
    console.log(`  Error:       ${record.error}`);
  }
  
  console.log('');
}

/**
 * List all agent work
 */
async function listWork(args) {
  const options = parseOptions(args);
  
  console.log('\n📋 Agent Work Items\n');
  
  // Combine active and historical work
  const items = [];
  
  // Active work from memory
  for (const [id, stored] of workStore.entries()) {
    items.push({
      id,
      description: stored.item.description,
      status: stored.item.status,
      priority: stored.item.priority,
      started: stored.started,
      active: true
    });
  }
  
  // Historical work from records
  const historyPath = getHistoryPath();
  if (fs.existsSync(historyPath)) {
    const files = fs.readdirSync(historyPath).filter(f => f.endsWith('.json'));
    for (const file of files) {
      try {
        const record = JSON.parse(fs.readFileSync(path.join(historyPath, file), 'utf8'));
        items.push({
          id: record.id,
          description: record.description,
          status: record.status,
          priority: record.priority || 'medium',
          started: record.started,
          completed: record.completed,
          active: false
        });
      } catch (e) {
        // Skip invalid records
      }
    }
  }
  
  if (items.length === 0) {
    console.log('  No work items found.\n');
    return;
  }
  
  if (options.format === 'json') {
    console.log(JSON.stringify(items, null, 2));
    return;
  }
  
  // Sort by started date (newest first)
  items.sort((a, b) => new Date(b.started) - new Date(a.started));
  
  console.log('  Work ID                        | Status      | Priority | Started');
  console.log('  ' + '-'.repeat(75));
  
  for (const item of items.slice(0, 20)) {
    const id = item.id.substring(0, 30).padEnd(30);
    const status = item.status.padEnd(11);
    const priority = (item.priority || 'medium').padEnd(8);
    const started = new Date(item.started).toLocaleString().substring(0, 19);
    
    const statusIcon = {
      'completed': '✅',
      'working': '⏳',
      'failed': '❌',
      'cancelled': '🚫',
      'queued': '📋',
      'planning': '🔍',
      'verifying': '✅'
    }[item.status] || '❓';
    
    const activeMarker = item.active ? '●' : '○';
    
    console.log(`  ${id} | ${statusIcon} ${status} | ${priority} | ${started} ${activeMarker}`);
  }
  
  console.log(`\n  Total: ${items.length} work item(s)`);
  console.log('  ● Active  ○ Historical\n');
}

/**
 * Cancel agent work
 */
async function cancelWork(args) {
  const options = parseOptions(args);
  const workId = options.positional[0];
  
  if (!workId) {
    console.error('\n❌ Work ID is required.\n');
    console.log('Usage: aqt agent cancel <work-id>\n');
    process.exit(1);
  }
  
  const stored = workStore.get(workId);
  
  if (!stored) {
    console.error(`\n❌ Active work '${workId}' not found.\n`);
    console.log('Only active work can be cancelled.\n');
    process.exit(1);
  }
  
  stored.orchestrator.cancel(workId);
  
  console.log(`\n✅ Work '${workId}' cancelled.\n`);
}

/**
 * Approve agent work
 */
async function approveWork(args) {
  const options = parseOptions(args);
  const workId = options.positional[0];
  
  if (!workId) {
    console.error('\n❌ Work ID is required.\n');
    console.log('Usage: aqt agent approve <work-id>\n');
    process.exit(1);
  }
  
  const stored = workStore.get(workId);
  
  if (!stored) {
    console.error(`\n❌ Work '${workId}' not found.\n`);
    process.exit(1);
  }
  
  if (stored.item.status !== WorkItemStatus.AWAITING_APPROVAL) {
    console.error(`\n❌ Work is not awaiting approval (status: ${stored.item.status})\n`);
    process.exit(1);
  }
  
  // Set approval flag
  stored.approved = true;
  
  console.log(`\n✅ Work '${workId}' approved.\n`);
  console.log('  The agent will continue execution.\n');
}

/**
 * View work logs
 */
async function workLogs(args) {
  const options = parseOptions(args);
  const workId = options.positional[0];
  
  if (!workId) {
    console.error('\n❌ Work ID is required.\n');
    console.log('Usage: aqt agent logs <work-id>\n');
    process.exit(1);
  }
  
  const stored = workStore.get(workId);
  
  if (stored) {
    console.log(`\n📜 Logs for ${workId}\n`);
    
    if (stored.logs.length === 0) {
      console.log('  No logs recorded.\n');
      return;
    }
    
    for (const log of stored.logs) {
      const timestamp = new Date(log.timestamp).toLocaleTimeString();
      console.log(`  [${timestamp}] ${log.type}: ${log.message || ''}`);
    }
    
    console.log('');
    return;
  }
  
  // Check saved records
  const record = loadWorkRecord(workId);
  
  if (!record) {
    console.error(`\n❌ Work '${workId}' not found.\n`);
    process.exit(1);
  }
  
  console.log(`\n📜 Logs for ${workId}\n`);
  
  if (record.logs && record.logs.length > 0) {
    for (const log of record.logs) {
      const timestamp = new Date(log.timestamp).toLocaleTimeString();
      console.log(`  [${timestamp}] ${log.type}: ${log.message || ''}`);
    }
  } else {
    console.log('  No logs recorded.\n');
  }
  
  console.log('');
}

/**
 * Parse command options
 */
function parseOptions(args) {
  const options = {
    positional: [],
    workspace: process.cwd(),
    files: [],
    priority: 'medium',
    maxFiles: 50,
    autoApprove: false,
    deliverables: [],
    format: 'table',
    verbose: false,
    follow: false
  };
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === '--workspace' || arg === '-w') {
      options.workspace = args[++i];
    } else if (arg === '--files') {
      options.files = args[++i].split(',');
    } else if (arg === '--priority') {
      options.priority = args[++i];
    } else if (arg === '--max-files') {
      options.maxFiles = parseInt(args[++i], 10);
    } else if (arg === '--auto-approve') {
      options.autoApprove = true;
    } else if (arg === '--deliverables') {
      options.deliverables = args[++i].split(',');
    } else if (arg === '--format' || arg === '-f') {
      options.format = args[++i];
    } else if (arg === '--verbose' || arg === '-v') {
      options.verbose = true;
    } else if (arg === '--follow') {
      options.follow = true;
    } else if (!arg.startsWith('-')) {
      options.positional.push(arg);
    }
  }
  
  return options;
}

/**
 * Get history path
 */
function getHistoryPath() {
  return path.join(process.cwd(), '.aqt-reports', 'agent-history');
}

/**
 * Save work record
 */
function saveWorkRecord(workId, results) {
  const historyPath = getHistoryPath();
  
  if (!fs.existsSync(historyPath)) {
    fs.mkdirSync(historyPath, { recursive: true });
  }
  
  const stored = workStore.get(workId);
  const record = {
    id: workId,
    description: stored?.item?.description || '',
    status: results.status,
    priority: stored?.item?.priority || 'medium',
    started: stored?.started || new Date().toISOString(),
    completed: new Date().toISOString(),
    output: results.output,
    error: results.error,
    logs: stored?.logs || []
  };
  
  fs.writeFileSync(
    path.join(historyPath, `${workId}.json`),
    JSON.stringify(record, null, 2),
    'utf8'
  );
}

/**
 * Load work record
 */
function loadWorkRecord(workId) {
  const recordPath = path.join(getHistoryPath(), `${workId}.json`);
  
  if (!fs.existsSync(recordPath)) {
    return null;
  }
  
  try {
    return JSON.parse(fs.readFileSync(recordPath, 'utf8'));
  } catch (e) {
    return null;
  }
}

/**
 * Print help
 */
function printHelp() {
  console.log(`
📖 Agent Command Help

Usage:
  aqt agent <subcommand> [options]

Subcommands:
  start <description>   Start autonomous agent work
  status <work-id>      Show work status
  list                  List all work items
  cancel <work-id>      Cancel active work
  approve <work-id>     Approve awaiting work
  logs <work-id>        View work logs

Options:
  --workspace, -w <path>     Workspace path (default: current directory)
  --files <paths>            Comma-separated list of files to include
  --priority <level>         Priority: 'critical', 'high', 'medium', 'low'
  --max-files <n>            Maximum files to modify (default: 50)
  --auto-approve             Automatically approve high-risk operations
  --deliverables <items>     Comma-separated list of expected deliverables
  --format, -f <format>      Output format: 'json', 'table'
  --follow                   Follow logs in real-time
  --verbose, -v              Verbose output
  --help, -h                 Show this help

Examples:
  aqt agent start "Fix the authentication bug in login.js"
  aqt agent start "Add unit tests for UserService" --files src/services/UserService.js
  aqt agent start "Refactor the API module" --priority high --max-files 20
  aqt agent status work-1697123456789-abc123
  aqt agent list
  aqt agent list --format json
  aqt agent cancel work-1697123456789-abc123
  aqt agent approve work-1697123456789-abc123
  aqt agent logs work-1697123456789-abc123

Agent Workflow:
  1. Start work with a description
  2. Agent creates an execution plan
  3. Plan is validated for safety
  4. If high-risk, approval is requested
  5. Agent executes the plan step by step
  6. Results are verified
  7. Work is completed or retried

Safety Features:
  - File count limits prevent mass changes
  - High-risk operations require approval
  - Delete operations require approval
  - All changes are logged
  - Work can be cancelled at any time

Note:
  - The agent operates within the workspace directory
  - Changes are applied directly unless --dry-run is specified
  - All work is recorded in .aqt-reports/agent-history/
`);
}

module.exports = {
  run,
  printHelp
};
