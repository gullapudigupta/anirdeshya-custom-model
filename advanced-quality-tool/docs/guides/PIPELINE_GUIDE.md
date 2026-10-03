# Advanced Quality Tool - Pipeline System User Guide

## Table of Contents

- [Overview](#overview)
- [What are Pipelines?](#what-are-pipelines)
- [Quick Start](#quick-start)
- [CLI Usage](#cli-usage)
- [API Usage](#api-usage)
- [MCP Usage](#mcp-usage)
- [Available Pipelines](#available-pipelines)
- [Pipeline Replay](#pipeline-replay)
- [Custom Pipelines](#custom-pipelines)
- [Configuration](#configuration)
- [Best Practices](#best-practices)
- [Troubleshooting](#troubleshooting)

---

## Overview

The Advanced Quality Tool (AQT) Pipeline System provides pre-built, composable workflows for common code quality tasks. Each pipeline is a multi-stage workflow that can analyze code, apply fixes, generate reports, and integrate with CI/CD systems.

### Key Features

🔗 **20+ Pre-built Pipelines** - Ready-to-use workflows for common tasks
📊 **Multi-Stage Execution** - Pipelines broken into composable stages
🔄 **Replay Capability** - Replay any pipeline execution for debugging
📝 **Execution Ledger** - Complete audit trail of all executions
⚡ **Parallel Execution** - Run multiple stages concurrently
🎯 **Conditional Logic** - Skip stages based on conditions
📈 **Progress Tracking** - Real-time progress updates
🔌 **Extensible** - Create custom pipelines easily

---

## What are Pipelines?

A **Pipeline** is a sequence of stages that accomplish a specific code quality task. Each stage:

- Receives input from previous stages
- Performs a specific operation
- Produces output for next stages
- Can run in parallel with other stages
- Can be skipped based on conditions

### Pipeline Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Pipeline                                │
│                                                              │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌─────────┐ │
│  │ Stage 1  │──►│ Stage 2  │──►│ Stage 3  │──►│ Stage 4 │ │
│  │ (Select) │   │ (Analyze)│   │  (Fix)   │   │ (Report)│ │
│  └──────────┘   └──────────┘   └──────────┘   └─────────┘ │
│                                                              │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
              ┌───────────────────────┐
              │  Execution Ledger     │
              │  (Audit & Replay)     │
              └───────────────────────┘
```

### Example: AI Code Review Pipeline

```
1. Select Files    → Choose files to review
2. Read Code       → Read file contents
3. Gather Context  → Get dependencies and history
4. AI Review       → Generate AI-powered review
5. Format Results  → Format output as JSON/Markdown
```

---

## Quick Start

### Prerequisites

1. **AQT installed**: `npm install -g advanced-quality-tool`
2. **Project initialized**: Run `aqt init` in your project

### Run Your First Pipeline

```bash
# List available pipelines
aqt pipeline list

# Run a pipeline
aqt pipeline run workspace-quality

# Run with specific options
aqt pipeline run security-scan --output report.json

# View execution status
aqt pipeline status <execution-id>
```

---

## CLI Usage

### List Available Pipelines

```bash
# List all pipelines
aqt pipeline list

# List with descriptions
aqt pipeline list --verbose

# Filter by category
aqt pipeline list --category security

# Show pipeline details
aqt pipeline info workspace-quality
```

### Execute a Pipeline

```bash
# Basic execution
aqt pipeline run <pipeline-name>

# With options
aqt pipeline run ai-code-review \
  --files "src/**/*.js" \
  --depth detailed \
  --output review-report.json

# With parameters file
aqt pipeline run security-scan \
  --params pipeline-params.json

# Dry run (show what would happen)
aqt pipeline run auto-fix --dry-run
```

### Check Pipeline Status

```bash
# Check specific execution
aqt pipeline status <execution-id>

# Watch in real-time
aqt pipeline status <execution-id> --watch

# Show detailed progress
aqt pipeline status <execution-id> --verbose
```

### View Pipeline Executions

```bash
# List all executions
aqt pipeline executions

# Filter by pipeline
aqt pipeline executions --pipeline workspace-quality

# Filter by status
aqt pipeline executions --status completed

# Filter by date
aqt pipeline executions --since "2026-09-01"
```

### Replay a Pipeline

```bash
# Replay exact execution
aqt pipeline replay <execution-id>

# Replay with modified parameters
aqt pipeline replay <execution-id> \
  --param files="src/auth/"

# Replay specific stages only
aqt pipeline replay <execution-id> \
  --stages "analyze,fix"
```

---

## API Usage

### List Pipelines

```bash
GET /api/pipelines

# Response
{
  "success": true,
  "data": {
    "pipelines": [
      {
        "id": "workspace-quality",
        "name": "Workspace Quality Analysis",
        "category": "analysis",
        "description": "Complete workspace quality analysis",
        "stages": ["detect", "analyze", "categorize", "report"]
      }
    ]
  }
}
```

### Get Pipeline Details

```bash
GET /api/pipelines/:name

# Response
{
  "success": true,
  "data": {
    "id": "workspace-quality",
    "name": "Workspace Quality Analysis",
    "stages": [
      {
        "name": "detect",
        "description": "Detect available linters",
        "inputs": ["workspacePath"],
        "outputs": ["detectedLinters"]
      }
    ],
    "parameters": {
      "workspacePath": { "type": "string", "required": true },
      "includeTests": { "type": "boolean", "default": true }
    }
  }
}
```

### Execute Pipeline

```bash
POST /api/pipelines/:name/execute

{
  "parameters": {
    "workspacePath": "/path/to/project",
    "options": {
      "includeMetrics": true,
      "outputFormat": "json"
    }
  }
}

# Response
{
  "success": true,
  "data": {
    "executionId": "exec-abc123",
    "status": "running",
    "startTime": "2026-10-01T10:00:00Z",
    "estimatedDuration": 30000
  }
}
```

### Get Execution Status

```bash
GET /api/pipelines/executions/:id

# Response
{
  "success": true,
  "data": {
    "executionId": "exec-abc123",
    "pipelineId": "workspace-quality",
    "status": "running",
    "progress": 65,
    "currentStage": "analyze",
    "stages": [
      {
        "name": "detect",
        "status": "completed",
        "duration": 1250,
        "output": { "linters": ["eslint", "prettier"] }
      },
      {
        "name": "analyze",
        "status": "running",
        "progress": 45
      }
    ]
  }
}
```

### Replay Pipeline

```bash
POST /api/pipelines/executions/:id/replay

{
  "modifiedParameters": {
    "outputFormat": "markdown"
  },
  "stageFilter": ["analyze", "report"]
}

# Response
{
  "success": true,
  "data": {
    "newExecutionId": "exec-def456",
    "replayedFrom": "exec-abc123"
  }
}
```

### List Executions

```bash
GET /api/pipelines/executions?pipeline=workspace-quality&status=completed

# Response
{
  "success": true,
  "data": {
    "executions": [
      {
        "executionId": "exec-abc123",
        "pipelineId": "workspace-quality",
        "status": "completed",
        "startTime": "2026-10-01T10:00:00Z",
        "endTime": "2026-10-01T10:00:45Z",
        "duration": 45000
      }
    ],
    "total": 25,
    "page": 1
  }
}
```

---

## MCP Usage

### Available MCP Tools

#### `aqt_pipeline_list`

List all available pipelines.

```json
{
  "name": "aqt_pipeline_list",
  "arguments": {
    "category": "analysis"
  }
}
```

#### `aqt_pipeline_info`

Get details about a specific pipeline.

```json
{
  "name": "aqt_pipeline_info",
  "arguments": {
    "pipelineId": "workspace-quality"
  }
}
```

#### `aqt_pipeline_execute`

Execute a pipeline.

```json
{
  "name": "aqt_pipeline_execute",
  "arguments": {
    "pipelineId": "workspace-quality",
    "parameters": {
      "workspacePath": "/path/to/project",
      "includeMetrics": true
    }
  }
}
```

#### `aqt_pipeline_status`

Check pipeline execution status.

```json
{
  "name": "aqt_pipeline_status",
  "arguments": {
    "executionId": "exec-abc123"
  }
}
```

### MCP Configuration

```json
{
  "mcpServers": {
    "aqt": {
      "command": "node",
      "args": ["/path/to/aqt/src/integrations/mcp-server.js"],
      "env": {
        "AQT_PROJECT_ROOT": "/path/to/your/project"
      }
    }
  }
}
```

---

## Available Pipelines

### 1. Workspace Quality Pipeline

**ID**: `workspace-quality`  
**Category**: Analysis  
**Description**: Complete workspace-wide quality analysis

**Stages**:
1. `detect` - Detect available linters and tools
2. `analyze` - Run all detected linters
3. `categorize` - Categorize and prioritize issues
4. `metrics` - Calculate quality metrics
5. `report` - Generate comprehensive report

**Usage**:
```bash
aqt pipeline run workspace-quality \
  --param workspacePath="." \
  --output quality-report.json
```

**Parameters**:
- `workspacePath` (required): Path to analyze
- `includeTests` (default: true): Include test files
- `includeMetrics` (default: true): Calculate metrics
- `outputFormat` (default: json): Output format

---

### 2. AI Code Review Pipeline

**ID**: `ai-code-review`  
**Category**: Review  
**Description**: AI-powered code review with context

**Stages**:
1. `selectFiles` - Select files for review
2. `readCode` - Read file contents
3. `gatherContext` - Get dependencies and history
4. `aiReview` - Generate AI review
5. `formatResults` - Format output

**Usage**:
```bash
aqt pipeline run ai-code-review \
  --param files="src/**/*.js" \
  --param reviewDepth="detailed"
```

**Parameters**:
- `files` (required): File patterns to review
- `reviewDepth` (default: standard): `quick`, `standard`, `detailed`
- `provider` (default: openai): AI provider
- `model` (default: gpt-4): Model to use

**Example Output**:
```json
{
  "reviews": [
    {
      "file": "src/auth.js",
      "rating": 7,
      "issues": [
        {
          "line": 42,
          "severity": "warning",
          "category": "security",
          "message": "Consider using constant-time comparison",
          "suggestion": "Use crypto.timingSafeEqual()"
        }
      ],
      "strengths": ["Good error handling", "Clear naming"],
      "improvements": ["Add input validation", "Extract magic numbers"]
    }
  ]
}
```

---

### 3. Auto-Fix Pipeline

**ID**: `auto-fix`  
**Category**: Fixing  
**Description**: Automatically fix detected issues

**Stages**:
1. `selectIssues` - Filter fixable issues
2. `groupByFile` - Group fixes by file
3. `applyFixes` - Apply fix strategies
4. `verifyFixes` - Verify fixes applied correctly

**Usage**:
```bash
aqt pipeline run auto-fix \
  --param issues="analysis-results.json" \
  --param strategy="conservative"
```

**Parameters**:
- `issues` (required): Issues to fix (array or file path)
- `strategy` (default: conservative): `conservative`, `moderate`, `aggressive`
- `dryRun` (default: false): Preview without applying
- `createBackups` (default: true): Create file backups

---

### 4. Security Scan Pipeline

**ID**: `security-scan`  
**Category**: Security  
**Description**: Comprehensive security vulnerability scan

**Stages**:
1. `vulnerabilityScan` - Scan for known vulnerabilities
2. `secretScan` - Scan for hardcoded secrets
3. `dependencyScan` - Check dependency CVEs
4. `securityAudit` - Run security audit
5. `report` - Generate security report

**Usage**:
```bash
aqt pipeline run security-scan \
  --param scanTypes="all" \
  --param severity="high,critical"
```

**Parameters**:
- `scanTypes` (default: all): `vulnerability`, `secrets`, `dependencies`, `all`
- `severity` (default: all): Filter by severity
- `autoFix` (default: false): Auto-fix when possible

---

### 5. CI Quality Gate Pipeline

**ID**: `ci-quality-gate`  
**Category**: CI/CD  
**Description**: Quality gate for CI/CD pipelines

**Stages**:
1. `detectCI` - Detect CI environment
2. `runAnalysis` - Run quality analysis
3. `checkThresholds` - Check against thresholds
4. `generateReport` - Generate CI-compatible report
5. `postResults` - Post results to CI

**Usage**:
```bash
aqt pipeline run ci-quality-gate \
  --param failOn="error" \
  --param reportFormat="junit"
```

**Parameters**:
- `failOn` (default: error): `never`, `warning`, `error`, `any`
- `reportFormat` (default: junit): `junit`, `json`, `sarif`
- `coverageThreshold` (default: 80): Min test coverage %

**Supported CI Systems**:
- GitHub Actions
- GitLab CI
- Jenkins
- CircleCI
- Travis CI
- Azure DevOps

---

### 6. Documentation Generation Pipeline

**ID**: `documentation-generation`  
**Category**: Documentation  
**Description**: Generate documentation from code

**Stages**:
1. `scanCode` - Scan code for documentation targets
2. `extractDocs` - Extract JSDoc/comments
3. `generateDocs` - Generate documentation
4. `validateDocs` - Validate completeness
5. `publishDocs` - Publish to output

**Usage**:
```bash
aqt pipeline run documentation-generation \
  --param format="markdown" \
  --param output="docs/"
```

**Parameters**:
- `format` (default: markdown): `markdown`, `html`, `json`
- `includePrivate` (default: false): Include private members
- `template` (optional): Custom template

---

### 7. Watch and Fix Pipeline

**ID**: `watch-and-fix`  
**Category**: Development  
**Description**: Watch files and auto-fix on change

**Usage**:
```bash
aqt pipeline run watch-and-fix \
  --param watchPath="src/" \
  --param autoFix=true
```

**Parameters**:
- `watchPath` (required): Path to watch
- `autoFix` (default: false): Auto-apply fixes
- `debounce` (default: 1000): Debounce delay (ms)

---

### 8. Quality Metrics Pipeline

**ID**: `quality-metrics`  
**Category**: Metrics  
**Description**: Calculate code quality metrics

**Stages**:
1. `complexity` - Calculate cyclomatic complexity
2. `maintainability` - Calculate maintainability index
3. `coverage` - Get test coverage
4. `duplication` - Detect code duplication
5. `report` - Generate metrics report

**Usage**:
```bash
aqt pipeline run quality-metrics \
  --param files="src/**/*.js" \
  --param format="json"
```

---

### 9. Issue Enrichment Pipeline

**ID**: `issue-enrichment`  
**Category**: Analysis  
**Description**: Enrich issues with additional context

**Stages**:
1. `categorize` - Categorize issues
2. `prioritize` - Calculate priority scores
3. `addContext` - Add file/code context
4. `addFixes` - Suggest fixes
5. `addLinks` - Add documentation links

**Usage**:
```bash
aqt pipeline run issue-enrichment \
  --param issues="raw-issues.json"
```

---

### 10. Language Analysis Pipeline

**ID**: `language-analysis`  
**Category**: Analysis  
**Description**: Multi-language code analysis

**Supports**: JavaScript, TypeScript, Python, Java, Go, Rust, Ruby, PHP, C#

**Usage**:
```bash
aqt pipeline run language-analysis \
  --param languages="javascript,python" \
  --param path="."
```

---

### 11. Dashboard Reporting Pipeline

**ID**: `dashboard-reporting`  
**Category**: Reporting  
**Description**: Generate dashboard-ready reports

**Usage**:
```bash
aqt pipeline run dashboard-reporting \
  --param datasource="analysis-results" \
  --param dashboard="executive-summary"
```

---

### 12. Chat Interaction Pipeline

**ID**: `chat-interaction`  
**Category**: UI  
**Description**: Process chat UI interactions

**Usage**: Automatically used by chat UI

---

### 13. VS Code Diagnostics Pipeline

**ID**: `vscode-diagnostics`  
**Category**: Integration  
**Description**: Generate VS Code diagnostic format

**Usage**:
```bash
aqt pipeline run vscode-diagnostics \
  --param issues="issues.json" \
  --param workspace="."
```

---

### 14. AI Issue Resolution Pipeline

**ID**: `ai-issue-resolution`  
**Category**: Fixing  
**Description**: AI-powered issue resolution

**Usage**:
```bash
aqt pipeline run ai-issue-resolution \
  --param issues="complex-issues.json" \
  --param provider="openai"
```

---

### 15. Pipeline Replay Pipeline

**ID**: `pipeline-replay`  
**Category**: System  
**Description**: Replay previous pipeline execution

**Usage**:
```bash
aqt pipeline replay <execution-id>
```

---

## Pipeline Replay

Pipeline Replay allows you to re-execute any previous pipeline run, with optional modifications.

### Why Replay?

- **Debugging**: Understand what happened in a past execution
- **Testing**: Test pipeline changes with real data
- **Recovery**: Re-run failed executions with fixes
- **Comparison**: Compare results across runs

### How Replay Works

1. **Execution Ledger** records all pipeline runs
2. **Complete State** captured (inputs, outputs, config)
3. **Replay** re-executes with original or modified inputs
4. **Comparison** shows differences between runs

### Replay Examples

```bash
# Exact replay
aqt pipeline replay exec-abc123

# Replay with modified parameters
aqt pipeline replay exec-abc123 \
  --param files="src/auth/" \
  --param depth="detailed"

# Replay specific stages
aqt pipeline replay exec-abc123 \
  --stages "analyze,report"

# Replay with different strategy
aqt pipeline replay exec-abc123 \
  --param strategy="aggressive"

# Compare with original
aqt pipeline replay exec-abc123 --compare
```

### Viewing Replay History

```bash
# View execution details
aqt pipeline execution exec-abc123

# View replay chain
aqt pipeline replays exec-abc123

# View all replays of a pipeline
aqt pipeline executions --original exec-abc123
```

---

## Custom Pipelines

### Creating Custom Pipelines

Create a custom pipeline by defining stages:

```javascript
// my-pipeline.js
const { BasePipeline } = require('advanced-quality-tool/pipelines');

class MyCustomPipeline extends BasePipeline {
  constructor(config = {}) {
    super({
      id: 'my-custom-pipeline',
      name: 'My Custom Pipeline',
      stages: ['stage1', 'stage2', 'stage3'],
      ...config
    });
  }

  async stage1(input) {
    // Stage 1 logic
    return { result: 'stage1 output' };
  }

  async stage2(input) {
    // Stage 2 logic
    return { result: 'stage2 output' };
  }

  async stage3(input) {
    // Stage 3 logic
    return { result: 'final output' };
  }
}

module.exports = { MyCustomPipeline };
```

### Registering Custom Pipeline

```javascript
const { PipelineRegistry } = require('advanced-quality-tool/pipelines');
const { MyCustomPipeline } = require('./my-pipeline');

const registry = PipelineRegistry.getInstance();
registry.register(new MyCustomPipeline());

// Now use it
// aqt pipeline run my-custom-pipeline
```

### Pipeline with Parallel Stages

```javascript
class ParallelPipeline extends BasePipeline {
  constructor() {
    super({
      id: 'parallel-pipeline',
      stages: ['prepare', 'parallel-group', 'finalize']
    });
  }

  async prepare(input) {
    return { data: 'prepared' };
  }

  async parallelGroup(input) {
    // Run stages in parallel
    const results = await Promise.all([
      this.parallelTask1(input),
      this.parallelTask2(input),
      this.parallelTask3(input)
    ]);

    return { results };
  }

  async parallelTask1(input) { /* ... */ }
  async parallelTask2(input) { /* ... */ }
  async parallelTask3(input) { /* ... */ }

  async finalize(input) {
    return { final: 'result' };
  }
}
```

### Conditional Stages

```javascript
class ConditionalPipeline extends BasePipeline {
  async stage1(input) {
    const result = { data: 'stage1' };
    
    // Set condition for next stage
    this.setCondition('skipStage2', result.data === 'skip');
    
    return result;
  }

  async stage2(input) {
    // This stage will be skipped if condition is true
    if (this.getCondition('skipStage2')) {
      return { skipped: true };
    }
    
    return { data: 'stage2' };
  }
}
```

---

## Configuration

### Pipeline Configuration File

Create `.aqt/pipelines.config.js`:

```javascript
module.exports = {
  pipelines: {
    // Global pipeline settings
    timeout: 300000,  // 5 minutes
    retryCount: 2,
    retryDelay: 5000,
    
    // Ledger settings
    ledger: {
      enabled: true,
      path: '.aqt-reports/pipelines',
      maxSize: 10000  // Max executions to keep
    },
    
    // Specific pipeline overrides
    'workspace-quality': {
      timeout: 600000,  // 10 minutes
      defaults: {
        includeTests: true,
        includeMetrics: true
      }
    },
    
    'ai-code-review': {
      timeout: 900000,  // 15 minutes
      defaults: {
        provider: 'openai',
        model: 'gpt-4',
        reviewDepth: 'standard'
      }
    }
  }
};
```

### Environment Variables

```bash
# Pipeline execution settings
export AQT_PIPELINE_TIMEOUT=300000
export AQT_PIPELINE_RETRY_COUNT=2

# Ledger settings
export AQT_PIPELINE_LEDGER_ENABLED=true
export AQT_PIPELINE_LEDGER_PATH=".aqt-reports/pipelines"

# AI provider settings
export OPENAI_API_KEY="sk-..."
export AQT_PIPELINE_AI_PROVIDER=openai
export AQT_PIPELINE_AI_MODEL=gpt-4
```

---

## Best Practices

### 1. Use Appropriate Pipelines

Choose the right pipeline for your task:

- **Quick checks**: `quality-metrics`, `issue-enrichment`
- **Comprehensive analysis**: `workspace-quality`, `language-analysis`
- **Security**: `security-scan`
- **CI/CD**: `ci-quality-gate`
- **Code review**: `ai-code-review`

### 2. Set Realistic Timeouts

```javascript
{
  'workspace-quality': {
    timeout: 600000  // 10 min for large projects
  },
  'security-scan': {
    timeout: 300000  // 5 min for security
  }
}
```

### 3. Use Dry Run First

```bash
# Test before applying changes
aqt pipeline run auto-fix --dry-run
```

### 4. Monitor Execution

```bash
# Watch progress in real-time
aqt pipeline status exec-abc123 --watch

# Or use the UI
aqt ui --open
```

### 5. Leverage Replay

```bash
# Replay with improved parameters
aqt pipeline replay exec-abc123 \
  --param strategy="aggressive"
```

### 6. Integrate with CI/CD

```yaml
# .github/workflows/quality.yml
- name: Quality Gate
  run: aqt pipeline run ci-quality-gate --fail-on error
```

### 7. Review Pipeline Outputs

```bash
# Always review before applying
aqt pipeline status exec-abc123 --show-output
```

---

## Troubleshooting

### Pipeline Times Out

**Problem**: Pipeline exceeds timeout

```bash
Error: Pipeline 'workspace-quality' timed out after 300000ms
```

**Solution**: Increase timeout or reduce scope

```bash
# Increase timeout
aqt config set pipelines.workspace-quality.timeout 600000

# Or reduce scope
aqt pipeline run workspace-quality --param files="src/critical/"
```

### Stage Fails Repeatedly

**Problem**: Specific stage keeps failing

```bash
Error: Stage 'analyze' failed after 3 attempts
```

**Solution**: Check logs and fix root cause

```bash
# View detailed logs
aqt pipeline status exec-abc123 --logs --stage analyze

# Skip problematic stage
aqt pipeline replay exec-abc123 --skip-stages analyze
```

### Out of Memory

**Problem**: Pipeline runs out of memory on large projects

```bash
Error: JavaScript heap out of memory
```

**Solution**: Increase Node.js memory or process in batches

```bash
# Increase memory
NODE_OPTIONS="--max-old-space-size=8192" aqt pipeline run workspace-quality

# Or process in batches
aqt pipeline run workspace-quality --param batchSize=100
```

### AI Provider Errors

**Problem**: AI provider connection fails

```bash
Error: OpenAI API request failed: 429 Rate Limit
```

**Solution**: Check API keys, rate limits, or use alternative provider

```bash
# Check quota
curl https://api.openai.com/v1/usage

# Use alternative provider
aqt pipeline run ai-code-review --param provider=anthropic

# Or use local model
aqt pipeline run ai-code-review --param provider=ollama
```

---

## Support

- **Documentation**: https://github.com/your-org/advanced-quality-tool/docs
- **Pipeline Issues**: https://github.com/your-org/advanced-quality-tool/issues
- **Discussions**: https://github.com/your-org/advanced-quality-tool/discussions

---

## License

MIT License - see LICENSE file for details
