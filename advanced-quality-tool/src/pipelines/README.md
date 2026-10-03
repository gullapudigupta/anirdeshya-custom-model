# Pipelines Module

## Overview

The `src/pipelines` module provides a comprehensive pipeline architecture for orchestrating code quality workflows. Each pipeline represents a specific workflow like code review, issue resolution, or CI quality gates.

📋 **[View Gap Analysis](./GAPS.md)** - See missing features and improvement opportunities

⚠️ **CRITICAL**: 20+ pipelines implemented but NOT accessible via CLI, API, MCP, or UI!

## Contents

| File | Description |
|------|-------------|
| `index.js` | Pipeline exports and registry |
| `pipeline-executor.js` | Executes pipeline stages |
| `pipeline-registry.js` | Registers and manages pipelines |
| `pipeline-catalog.js` | Catalog of available pipelines |
| `execution-ledger.js` | Records pipeline executions |
| `ai-code-review-pipeline.js` | AI-powered code review workflow |
| `ai-issue-resolution-pipeline.js` | AI issue resolution workflow |
| `auto-fix-pipeline.js` | Automatic fix application |
| `chat-interaction-pipeline.js` | Chat-based interactions |
| `ci-quality-gate-pipeline.js` | CI/CD quality gates |
| `cli-command-pipeline.js` | CLI command execution |
| `dashboard-reporting-pipeline.js` | Dashboard report generation |
| `documentation-generation-pipeline.js` | Documentation generation |
| `issue-enrichment-pipeline.js` | Issue enrichment workflow |
| `language-analysis-pipeline.js` | Multi-language analysis |
| `pipeline-replay-pipeline.js` | Pipeline replay capability |
| `quality-metrics-pipeline.js` | Quality metrics collection |
| `security-scan-pipeline.js` | Security scanning workflow |
| `vscode-diagnostics-pipeline.js` | VS Code diagnostics |
| `watch-and-fix-pipeline.js` | Watch and auto-fix |
| `workspace-quality-analysis.js` | Workspace-wide analysis |
| `workspace-quality-pipeline.js` | Workspace quality workflow |

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     PipelineExecutor                         │
│  ┌───────────────────────────────────────────────────────┐  │
│  │                    PipelineRegistry                     │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐   │  │
│  │  │ Code Review │  │ Auto Fix    │  │ Security    │   │  │
│  │  │ Pipeline    │  │ Pipeline    │  │ Pipeline    │   │  │
│  │  └─────────────┘  └─────────────┘  └─────────────┘   │  │
│  └───────────────────────────────────────────────────────┘  │
│                          │                                  │
│                          ▼                                  │
│              ┌───────────────────────┐                      │
│              │  ExecutionLedger      │                      │
│              │  (Audit & Replay)     │                      │
│              └───────────────────────┘                      │
└─────────────────────────────────────────────────────────────┘
```

## Key Components

### PipelineExecutor

Executes pipelines and manages stages:

```javascript
const { PipelineExecutor } = require('./pipelines/pipeline-executor');

const executor = new PipelineExecutor({
  ledger: { enabled: true, path: '.aqt-reports/pipelines' }
});

// Execute a pipeline
const result = await executor.execute('ai-code-review', {
  files: ['src/'],
  options: { depth: 2 }
});
```

### PipelineRegistry

Registers and retrieves pipelines:

```javascript
const { PipelineRegistry } = require('./pipelines/pipeline-registry');

const registry = new PipelineRegistry();

// Register pipeline
registry.register('custom-pipeline', {
  name: 'Custom Pipeline',
  stages: ['select', 'analyze', 'report']
});

// Get pipeline
const pipeline = registry.get('ai-code-review');

// List all
const all = registry.list();
```

### ExecutionLedger

Records all pipeline executions for audit and replay:

```javascript
const { ExecutionLedger } = require('./pipelines/execution-ledger');

const ledger = new ExecutionLedger({
  path: '.aqt-reports/pipelines/execution-ledger.jsonl'
});

// Start run
const runId = ledger.startRun({
  pipelineId: 'ai-code-review',
  taskId: 'task-001',
  workspace: '/project'
});

// Record stages
ledger.stageStart(runId, 'analysis', { files: 10 });
ledger.stageEnd(runId, 'analysis', { issues: 42 });

// End run
ledger.endRun(runId, 'completed');
```

## Pipeline Reference

### AICodeReviewPipeline

```javascript
const pipeline = new AICodeReviewPipeline({
  projectRoot: process.cwd()
});

const result = await pipeline.execute({
  files: ['src/**/*.js'],
  reviewDepth: 'detailed'
});
```

**Stages:**
1. `selectFiles` - Select files for review
2. `readCode` - Read file contents
3. `boundContext` - Gather context
4. `generateReview` - AI-powered review
5. `formatResults` - Format output

### AIIssueResolutionPipeline

```javascript
const pipeline = new AIIssueResolutionPipeline();

const result = await pipeline.execute({
  issues: detectedIssues,
  autoApply: false
});

// Batch processing
await pipeline.executeBatch(issues, { concurrency: 3 });
```

### AutoFixPipeline

```javascript
const pipeline = new AutoFixPipeline({
  dryRun: false,
  createBackups: true
});

const result = await pipeline.execute({
  issues: issues,
  strategy: 'conservative'
});
```

**Stages:**
1. `selectIssues` - Filter fixable issues
2. `groupByFile` - Group for efficient fixing
3. `applyFixes` - Apply fix strategies
4. `verifyFixes` - Verify fixes applied

### CIQualityGatePipeline

```javascript
const pipeline = new CIQualityGatePipeline({
  failThreshold: 'error'
});

const result = await pipeline.execute({
  ci: 'github-actions',
  reportFormats: ['junit', 'json']
});

// CI detection
const ci = pipeline.detectCIEnvironment();
// { name: 'github-actions', buildId: '...', ... }
```

### ChatInteractionPipeline

```javascript
const pipeline = new ChatInteractionPipeline();

// Create session
const sessionId = pipeline.createSession({ userId: 'user-1' });

// Execute chat command
const response = await pipeline.execute({
  sessionId,
  message: 'Analyze src/app.js'
});

// Get session history
const history = pipeline.getSession(sessionId);
```

### DocumentationGenerationPipeline

```javascript
const pipeline = new DocumentationGenerationPipeline();

const result = await pipeline.execute({
  source: 'src/',
  output: 'docs/',
  format: 'markdown'
});

// Generate from template
const doc = pipeline.generateFromTemplate('api-docs', data);
```

### SecurityScanPipeline

```javascript
const pipeline = new SecurityScanPipeline({
  scanners: ['vulnerability', 'secret', 'dependency']
});

const result = await pipeline.execute({
  paths: ['src/'],
  failOnSeverity: 'high'
});
```

### WatchAndFixPipeline

```javascript
const pipeline = new WatchAndFixPipeline({
  paths: ['src/'],
  debounce: 500
});

await pipeline.start();
// Watches for changes and auto-fixes
```

## Usage Examples

### Run Multiple Pipelines

```javascript
const executor = new PipelineExecutor();

// Sequential
await executor.execute('security-scan', params);
await executor.execute('quality-metrics', params);

// Or batch
const results = await executor.executeAll([
  { id: 'security-scan', params: {...} },
  { id: 'quality-metrics', params: {...} }
]);
```

### Custom Pipeline

```javascript
const { PipelineRegistry } = require('./pipelines/pipeline-registry');

registry.register('my-pipeline', {
  id: 'my-pipeline',
  name: 'My Custom Pipeline',
  
  async execute(params) {
    const context = { params };
    
    // Stage 1
    context.files = await this.selectFiles(context);
    
    // Stage 2
    context.issues = await this.analyzeFiles(context);
    
    // Stage 3
    return this.formatResults(context);
  },
  
  async selectFiles(context) {
    // Implementation
  },
  
  async analyzeFiles(context) {
    // Implementation
  },
  
  formatResults(context) {
    return { issues: context.issues };
  }
});
```

### Replay Execution

```javascript
const ledger = new ExecutionLedger();

// Get past run
const run = ledger.getRun('run-123');

// Replay with same parameters
const result = await executor.execute(run.pipelineId, run.input);
```

## Configuration

### PipelineExecutor

```javascript
{
  ledger: {
    enabled: boolean,
    path: string
  },
  timeout: number,
  retries: number
}
```

### ExecutionLedger

```javascript
{
  path: string,              // Path to ledger file
  maxSize: number,           // Maximum ledger size
  retention: number          // Days to keep records
}
```

## Dependencies

- File system access
- AI providers (for AI pipelines)
- Linters and analyzers
