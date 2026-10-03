# Agent Module

## Overview

The `src/agent` module provides an autonomous agent system that can plan, execute, and verify code changes with minimal human intervention.

📋 **[View Gap Analysis](./GAPS.md)** - See missing features and improvement opportunities

⚠️ **IMPORTANT**: This module is fully implemented but NOT exposed in any user interface (CLI, API, MCP, or Chat UI).

## Contents

| File | Description |
|------|-------------|
| `index.js` | Agent exports and initialization |
| `work-orchestrator.js` | Orchestrates agent work items |
| `work-item.js` | Represents a unit of agent work |
| `planner.js` | Plans agent execution steps |
| `scope-analyzer.js` | Analyzes scope of agent tasks |
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

Plans execution steps:

```javascript
const { AgentPlanner } = require('./agent/planner');

const planner = new AgentPlanner();

const plan = await planner.plan({
  description: 'Implement user authentication',
  deliverables: ['auth.js', 'auth.test.js']
});

// Plan contains:
// - steps: Execution steps
// - estimatedTime: Time estimate
// - dependencies: Step dependencies
// - risks: Potential issues
```

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

Registry of available tools:

```javascript
const { ToolRegistry } = require('./agent/tool-registry');

const registry = new ToolRegistry();

// Register tools
registry.register('file-read', {
  description: 'Read file contents',
  execute: async (path) => fs.readFile(path, 'utf8')
});

registry.register('file-write', {
  description: 'Write file contents',
  execute: async (path, content) => fs.writeFile(path, content)
});

// List available
const tools = registry.list();

// Execute tool
const result = await registry.execute('file-read', 'src/app.js');
```

### CodeGenerator

Generates code from specifications:

```javascript
const { CodeGenerator } = require('./agent/code-generator');

const generator = new CodeGenerator({
  provider: 'openai',
  model: 'gpt-4'
});

const result = await generator.generate({
  type: 'function',
  name: 'calculateTotal',
  description: 'Calculate order total with tax',
  parameters: ['items', 'taxRate']
});

// Validate generated code
const validation = generator.validate(result);
```

### DiffReviewSystem

Reviews code diffs:

```javascript
const { DiffReviewSystem, FileDiff } = require('./agent/diff-review-system');

const diff = new FileDiff('src/app.js', originalContent, modifiedContent);

// Compute hunks
const hunks = diff.computeHunks();

// Get unified diff
const unified = diff.toUnifiedDiff();

// Review changes
const review = await reviewer.review(hunks);
```

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
const registry = new ToolRegistry();

registry.register('my-tool', {
  description: 'Custom tool',
  parameters: {
    input: { type: 'string' }
  },
  execute: async (params) => {
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
  retryDelay: number         // Delay between retries (ms)
}
```

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
