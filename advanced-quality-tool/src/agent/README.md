# Agent Module

## Overview

The `src/agent` module provides an autonomous agent system that can plan, execute, and verify code changes with minimal human intervention.

📋 **[View Gap Analysis](./GAPS.md)** - See missing features and improvement opportunities

Agent operations are exposed through the agent CLI, HTTP API, and MCP
integration; see [API documentation](../../docs/API.md) and
[MCP tool documentation](../../docs/MCP-TOOLS.md).

## Contents

| File | Description |
|------|-------------|
| `index.js` | Agent exports and initialization |
| `work-orchestrator.js` | Orchestrates agent work items |
| `work-item.js` | Represents a unit of agent work |
| `planner.js` | Plans agent execution steps |
| `scope-analyzer.js` | Analyzes scope of agent tasks |
| `workspace-context.js` | Collects bounded, hashed workspace context for coding tasks |
| `permissions.js` | Permission management for operations |
| `tool-registry.js` | Registry of available tools |
| `code-generator.js` | Generates code from specifications |
| `diff-review-system.js` | Reviews code diffs |
| `verification-repair-loop.js` | Verification and repair cycle |
| `acceptance-workflow.js` | Acceptance workflow management |
| `streaming-conversation.js` | Streaming conversation handling |
| `provider-model-selector.js` | Selects appropriate AI model |
| `privacy-cost-controls.js` | Privacy and cost management |
| `requirement-traceability.js` | Traces requirements to implementation |
| `task-importer.js` | Imports tasks from specifications |

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     WorkOrchestrator                         │
│  ┌───────────────────────────────────────────────────────┐  │
│  │                     AgentPlanner                       │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐   │  │
│  │  │ Scope       │  │ Tool        │  │ Permission  │   │  │
│  │  │ Analyzer    │  │ Registry    │  │ Manager     │   │  │
│  │  └─────────────┘  └─────────────┘  └─────────────┘   │  │
│  └───────────────────────────────────────────────────────┘  │
│                          │                                  │
│              ┌───────────┴───────────┐                     │
│              ▼                       ▼                     │
│      ┌───────────────┐       ┌───────────────┐            │
│      │ CodeGenerator │       │ Verification  │            │
│      │               │       │ Repair Loop   │            │
│      └───────────────┘       └───────────────┘            │
│                          │                                  │
│                          ▼                                  │
│              ┌───────────────────────┐                      │
│              │ AcceptanceWorkflow    │                      │
│              └───────────────────────┘                      │
└─────────────────────────────────────────────────────────────┘
```

## Key Components

### WorkspaceContext

`WorkOrchestrator` collects explicit files and bounded search results before
planning. Context is workspace-contained, honors ignored paths and configured
file/byte/token/search limits, and includes language, detected symbols, SHA-256
hashes, and missing/excluded/truncated reports. The execution result exposes
per-file path/hash provenance without duplicating file contents:

```javascript
const { WorkspaceContext } = require('./agent/workspace-context');

const context = new WorkspaceContext({
  workspace: process.cwd(),
  maxFiles: 40,
  maxTokens: 8000
}).collect(['src/app.js'], { query: 'authentication middleware' });
```

### WorkOrchestrator

Orchestrates agent execution:

```javascript
const { WorkOrchestrator } = require('./agent/work-orchestrator');

const orchestrator = new WorkOrchestrator({
  maxConcurrent: 3,
  timeout: 300000
});

// Queue work
const workId = orchestrator.queue({
  type: 'fix',
  description: 'Fix security issues',
  files: ['src/auth.js']
});

// Monitor progress
orchestrator.on('progress', (event) => {
  console.log(`${event.workId}: ${event.stage}`);
});

// Get result
const result = await orchestrator.getResult(workId);
```

### AgentPlanner

Creates bounded, versioned execution plans from gathered workspace context. A
configured `planExecutor` can produce the structured plan; without one, the
planner uses its deterministic local strategy and does not invoke a provider.
Plans declare affected files, ordered steps and their dependencies, acceptance
criteria, required checks, check IDs (never model-supplied shell commands),
risks, and whether approval is required. Validation rejects unsafe or
out-of-scope paths, unresolved or out-of-order dependencies, and plans beyond
the configured step/file limits. When called by `WorkOrchestrator`, `context`
contains relative paths in `files` and the bounded collected contents and
provenance under `gatheredContext`.

```javascript
const { AgentPlanner } = require('./agent/planner');

const planner = new AgentPlanner({
  workspace: process.cwd(),
  planExecutor: async ({ task, context, limits }) => {
    // Return a structured plan grounded in context.files and within limits.
    return buildPlan(task, context, limits);
  }
});

const plan = await planner.plan({
  description: 'Implement user authentication',
  acceptanceCriteria: ['Authentication rejects invalid credentials'],
  context: {
    files: [{ path: 'src/auth.js', content: '...' }]
  }
});

// Plan contains:
// - planVersion: 1
// - affectedFiles and ordered steps with explicit dependencies
// - acceptanceCriteria, expectedChecks, and verificationCommands by check ID
// - risks and metadata.requiresApproval
```

Before execution, the orchestrator freezes and stores that versioned plan on
the work item. Approval receives the same plan object used for execution; the
work item's JSON representation includes the plan version and, when approved,
the approved plan's SHA-256 digest and timestamp.

The orchestrator checks the plan and every exposed tool call through its
`PermissionManager`. Plans affecting more than 10 files, plans marked for
approval, and high-risk plans require approval by default; plans over the
configured `maxFilesPerTask` limit are denied. Existing-file edits, dependency
manifest changes, and configured high-risk tools are approved individually.
Each approval request receives a `details` object as the third
`onApprovalRequired(item, plan, details)` argument with the plan digest and,
for tool actions, a digest that also covers the tool name and exact arguments.
The callback must return `true` or `{ approved: true }`; absent handlers,
denials, callback errors, and timeouts fail closed. Set `approvalTimeoutMs` to
bound the wait. Permission and approval decisions are retained in the
PermissionManager audit log and the work item's event history.

### ScopeAnalyzer

Analyzes task scope:

```javascript
const { TaskScopeAnalyzer } = require('./agent/scope-analyzer');

const analyzer = new TaskScopeAnalyzer();

const scope = analyzer.analyze(task);
// {
//   complexity: 'medium',
//   affectedFiles: 5,
//   estimatedChanges: 150,
//   risks: [...]
// }

// Check readiness
const readiness = analyzer.validateReadiness(task);
// { ready: true, blockers: [] }
```

### PermissionManager

Manages operation permissions:

```javascript
const { PermissionManager } = require('./agent/permissions');

const permissions = new PermissionManager({
  allowedPaths: ['src/'],
  deniedPaths: ['src/secrets/'],
  allowNetwork: false
});

// Check permission
const canWrite = await permissions.checkPermission({
  operation: 'write',
  path: 'src/app.js'
});

// Validate path
const isValid = permissions.validatePath('src/app.js');

// Redact secrets
const safe = permissions.redactSecrets(logOutput);
```

### ToolRegistry

Registry of tools exposed to agent-driven step execution. Only a fixed
allowlist of read/search/edit/check tools is ever reachable by a model
executor; `execute_command` (arbitrary shell) does not exist, and
`write_file` is registered for internal/back-compat use only.

```javascript
const { ToolRegistry, ALLOWED_CHECK_IDS } = require('./agent/tool-registry');

const registry = new ToolRegistry({ workspace: process.cwd() });

// Only tools safe for model execution (read_file, search_files, search_text,
// list_files, edit_file, run_check, get_diagnostics)
const schemas = registry.listExposedTools();

// Unknown tools and invalid arguments return an explicit, non-throwing result
const result = await registry.execute('read_file', { path: 'src/app.js' }, {
  itemId: 'work-1', taskId: 'task-1', stepId: 'step-1'
});
// { success, data, error, duration, code }

// Hash-guarded edit: rejects the edit if the file changed since it was read
await registry.execute('edit_file', {
  path: 'src/app.js',
  content: 'module.exports = {};',
  expectedHash: result.data.fileHash // omit only when creating a new file
});

// Allowlisted check runner: checkId only (lint | typecheck | test | build),
// never a shell string
await registry.execute('run_check', { checkId: 'lint' });
console.log(ALLOWED_CHECK_IDS); // ['lint', 'typecheck', 'test', 'build']

// Real linter diagnostics, or an explicit unavailable reason — never a
// fabricated zero-issues result
const diagnostics = await registry.execute('get_diagnostics', {});
```

Tool calls are recorded in `registry.getExecutionLog()` with the tool name,
sanitized arguments, status, duration, and bounded output, correlated with
`itemId`/`taskId`/`stepId` when that context is passed to `execute()`.

### CodeGenerator

Generates structured, reviewable file operations from a configured model
executor. The frozen plan must declare every changed path; there is no
scaffold or placeholder fallback. Create, modify, and delete operations include
captured original content and a SHA-256 expectation for stale-source detection.

```javascript
const { CodeGenerator } = require('./agent/code-generator');

const generator = new CodeGenerator({
  workspace: process.cwd(),
  modelExecutor: {
    generatePatches: async ({ task, plan, context, limits, outputSchema }) => ({
      operations: [{
        type: 'modify',
        filePath: 'src/app.js',
        content: 'module.exports = buildApp();',
        reason: 'Wire the application factory'
      }]
    })
  },
  maxChangedFiles: 20
});

const plan = {
  planVersion: 1,
  steps: [{ id: 'implement', description: 'Implement the task' }],
  affectedFiles: ['src/app.js'],
  newFiles: [],
  modifiedFiles: [],
  risks: [],
  metadata: { requiresApproval: true }
};
const result = await generator.generate(task, { plan });

const validation = generator.validate(result);
if (result.success && validation.valid) {
  const applied = await generator.applyPatches(result, {
    approvalGate: async ({ planDigest, patchDigest, review }) => {
      // Present review.files and review.summary to the reviewer, then return
      // their approval bound to both supplied digests.
    const approved = await requestApproval({ planDigest, patchDigest, review });
    return approved
      ? { approved: true, planDigest, patchDigest }
      : { approved: false, planDigest, patchDigest };
  }
  });
}
```

The review is generated before the approval callback. Paths outside the
workspace, symlink traversal, undeclared plan paths, stale source content,
malformed/empty/scaffold operations, conflicting operations, and changed-file
limit violations fail closed. Applying uses `DiffReviewSystem`; it rechecks
content hashes and plan/patch-bound approval, and confirms the intended file
content (or deletion) is present before reporting success.

### DiffReviewSystem

Reviews and applies workspace-contained diffs and structured create, modify,
and delete patches:

```javascript
const { DiffReviewSystem, hashContent } = require('./agent/diff-review-system');
const reviewSystem = new DiffReviewSystem({
  workspace: process.cwd(),
  maxChangedFiles: 20
});
reviewSystem.addPatch({
  type: 'modify',
  filePath: 'src/app.js',
  originalContent,
  modifiedContent,
  expectedHash: hashContent(originalContent)
}, { planDigest, patchDigest }); // Both must be SHA-256 digests.

const review = reviewSystem.presentForReview(); // Unified diff + per-file summary
const result = await reviewSystem.applyAll({
  approval: { approved: true, planDigest, patchDigest }
});
```

Structured patches cannot be applied through `applyDiff()` or `applyAll()`
without that matching approval object. `CodeGenerator.applyPatches()` also
checks each operation against `PermissionManager` (including protected paths,
read-only policy, delete policy, and configured file-size limits) and records
the permission/approval decisions.

### VerificationRepairLoop

Verifies and repairs issues:

```javascript
const { VerificationRepairLoop } = require('./agent/verification-repair-loop');

const loop = new VerificationRepairLoop({
  maxIterations: 5
});

const result = await loop.run({
  task: 'Fix linting errors',
  verify: async () => runLint(),
  repair: async (issues) => fixIssues(issues)
});
```

### AcceptanceWorkflow

Manages acceptance workflow:

```javascript
const { AcceptanceWorkflow } = require('./agent/acceptance-workflow');

const workflow = new AcceptanceWorkflow();

const result = await workflow.execute({
  workItem: workItem,
  approvers: ['lead-dev', 'architect'],
  criteria: ['tests-pass', 'lint-clean', 'review-approved']
});

// Cancel workflow
await workflow.cancel(workflowId);

// Get state
const state = workflow.getState(workflowId);
```

### ProviderModelSelector

Selects appropriate AI model:

```javascript
const { ProviderModelSelector } = require('./agent/provider-model-selector');

const selector = new ProviderModelSelector();

// Select best model for task
const model = selector.select({
  taskType: 'code-generation',
  complexity: 'high',
  maxLatency: 5000
});

// Returns: { provider: 'openai', model: 'gpt-4' }
```

### PrivacyCostControls

Manages privacy and costs:

```javascript
const { CostCalculator, UsageRecord } = require('./agent/privacy-cost-controls');

const calculator = new CostCalculator();

// Calculate cost
const cost = calculator.calculate({
  provider: 'openai',
  model: 'gpt-4',
  inputTokens: 1000,
  outputTokens: 500
});
```

### RequirementTraceability

Traces requirements to implementation:

```javascript
const { RequirementTraceability } = require('./agent/requirement-traceability');

const trace = new RequirementTraceability();

// Create trace matrix
const matrix = trace.createTraceMatrix(task, plan);

// Verify criteria met
const verification = trace.verifyCriteria(taskId, results);

// Generate report
const report = trace.generateReport(taskId);
```

## Usage Examples

### Full Agent Workflow

```javascript
const orchestrator = new WorkOrchestrator();
const planner = new AgentPlanner();
const permissions = new PermissionManager();

// 1. Plan the work
const plan = await planner.plan({
  description: 'Implement feature X',
  deliverables: ['feature.js', 'feature.test.js']
});

// 2. Queue work
const workId = orchestrator.queue({
  type: 'implementation',
  plan
});

// 3. Monitor execution
orchestrator.on('complete', async (result) => {
  // 4. Verify results
  const verification = await loop.run({
    task: result.work,
    verify: () => runTests()
  });
});
```

### Custom Tool Integration

```javascript
const registry = new ToolRegistry({ workspace: process.cwd() });

registry.register({
  name: 'my-tool',
  description: 'Custom tool',
  category: 'custom',
  exposed: false, // set true only if it is safe for a model to call directly
  parameters: {
    input: { type: 'string', required: true }
  },
  handler: async (args) => {
    // Custom logic
    return result;
  }
});
```

## Configuration

### WorkOrchestrator

```javascript
{
  maxConcurrent: number,     // Max concurrent work items
  timeout: number,           // Timeout per work item (ms)
  retryCount: number,        // Retry attempts on failure
  retryDelay: number,        // Delay between retries (ms)
  toolRegistry: ToolRegistry | null, // Injected registry; null disables tool access
  permissionManager: PermissionManager, // Optional shared policy manager
  permissionOptions: object, // PermissionManager policy configuration
  approvalTimeoutMs: number, // Approval wait limit (default 30000 ms)
  toolBudget: {
    maxCalls: number,        // Per-task tool-call budget (default 25)
    maxOutputBytes: number   // Per-task cumulative tool output budget (default 200 KB)
  }
}
```

Each step executor receives `tools` (a callable that enforces the allowlist
permission policy, approval gates, and budget before invoking the registry)
and `toolSchemas` (the exposed tool definitions) as part of its input.
Rejected calls (`UNKNOWN_TOOL`, `TOOL_BUDGET_EXCEEDED`, validation failures)
and successful calls are all recorded on the `WorkItem`'s `toolCalls` log,
correlated with the task and plan-step IDs. Approval decisions include the plan/action digests and their outcome in the
PermissionManager audit log. The tool-call interface does not expose patch
application; generated structured patches are applied through the separate
`CodeGenerator.applyPatches()` review workflow above.

### PermissionManager

```javascript
{
  allowedPaths: string[],    // Allowed file paths
  deniedPaths: string[],     // Denied file paths
  allowNetwork: boolean,     // Allow network access
  allowShell: boolean,       // Allow shell commands
  secrets: string[]          // Secret patterns to redact
}
```

## Dependencies

- AI provider SDKs
- File system access
- Git integration
