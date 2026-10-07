# AI Generator Module

## Overview

The `src/ai-generator` module provides the orchestration pipeline for AI-powered code generation and issue resolution. It coordinates between various searchers, executors, and context providers to deliver intelligent code fixes, test generation, documentation generation, and code refactoring.

## Status: Fully Implemented ✅

This module is fully implemented and exposed via:
- **CLI**: `aqt ai generate <type>` command
- **API**: `/api/ai/*` endpoints
- **MCP**: `aqt_ai_*` tools
- **UI**: AI Generation panel in chat interface

## Contents

| File | Description |
|------|-------------|
| `index.js` | Main entry point and fix preparation |
| `orchestrator.js` | Orchestrates the AI fix generation pipeline |
| `prompt-builder.js` | Builds prompts for AI model interactions |
| `cloud-executor.js` | Executes AI requests via cloud providers |
| `local-executor.js` | Executes AI requests via local models |
| `code-context-analyzer.js` | Analyzes code context for issue resolution |
| `context-aggregator.js` | Aggregates context from multiple sources |
| `dependency-doc-resolver.js` | Resolves dependency documentation |
| `base-searcher.js` | Base class for search implementations |
| `doc-searcher.js` | Searches documentation for solutions |
| `github-searcher.js` | Searches GitHub for code examples |
| `stackoverflow-searcher.js` | Searches Stack Overflow for solutions |
| `search-cache.js` | Caches search results |
| `error-recovery.js` | Handles error recovery and retry logic |
| `issue-classifier.js` | Classifies issues for appropriate handling |
| `line-editor.js` | Performs precise line-level edits |
| `config.js` | Configuration including rate limiting and cost tracking |
| `ai-safety.js` | Safety validation and content filtering |
| `quality-metrics.js` | Aggregates AI-generation outcomes, durations, and costs |
| `template-manager.js` | Validates and stores project-local prompt templates |

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Orchestrator                            │
│  ┌──────────────────────────────────────────────────────┐  │
│  │                  Prompt Builder                       │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │  │
│  │  │ Context     │  │ Dependency  │  │ Search      │  │  │
│  │  │ Aggregator  │  │ Doc Resolver│  │ Results     │  │  │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  │  │
│  └──────────────────────────────────────────────────────┘  │
│                          │                                  │
│              ┌───────────┴───────────┐                     │
│              ▼                       ▼                     │
│      ┌───────────────┐       ┌───────────────┐            │
│      │ Cloud Executor│       │ Local Executor│            │
│      └───────────────┘       └───────────────┘            │
└─────────────────────────────────────────────────────────────┘
```

## How to Use

### CLI Commands

#### Generate Code
```bash
aqt ai generate code "Create a function that validates email addresses"
aqt ai generate code "Create a React hook for form validation" --language typescript --framework react
```

#### Generate Tests
```bash
aqt ai generate test src/services/UserService.js
aqt ai generate test src/utils/parser.js --framework vitest
```

#### Generate Documentation
```bash
aqt ai generate doc src/services/UserService.js
aqt ai generate doc src/api/routes.js --format jsdoc
```

#### Fix Issue
```bash
aqt ai fix <issue-id>
aqt ai fix <issue-id> --dry-run  # Preview without applying
aqt fix --use-ai-fixes            # Allow AI fallback for eligible issues
```

#### Custom Prompt Templates

Templates live in `.aqt/ai-templates/` and accept `{{severity}}`, `{{category}}`,
`{{summary}}`, `{{what}}`, `{{why}}`, `{{how}}`, `{{context}}`, and
`{{outputContract}}` placeholders. Create and use one with:

```bash
aqt ai templates create concise prompt.txt
aqt ai templates list
aqt ai fix issue-123 --template concise
```

The template manager rejects unknown placeholders and constrains template names
to safe filename characters. Generation outcome metrics are available on the
orchestrator result as `qualityMetrics`; they contain aggregate outcomes and do
not store issue text or source code.

#### Refactor Code
```bash
aqt ai refactor src/services/UserService.js "Extract the validation logic into a separate function"
aqt ai refactor src/api/routes.js "Convert to async/await" --auto-apply
```

#### Configure AI Provider
```bash
aqt ai config openai --model gpt-4
aqt ai config anthropic --model claude-3-opus
```

#### Cost Tracking
```bash
aqt ai cost
aqt ai cost --period month
```

### API Endpoints

All AI generation endpoints are available via the HTTP API:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/ai/generate/code` | POST | Generate code from description |
| `/api/ai/generate/test` | POST | Generate tests for a file |
| `/api/ai/generate/doc` | POST | Generate documentation |
| `/api/ai/fix` | POST | Generate fix for an issue |
| `/api/ai/refactor` | POST | Refactor code |
| `/api/ai/configure` | POST | Configure AI provider |
| `/api/ai/cost` | GET | Get cost tracking data |

#### Example API Usage

```javascript
// Generate code
const response = await fetch('http://localhost:3000/api/ai/generate/code', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    description: 'Create a function that validates email addresses',
    language: 'typescript',
    provider: 'openai'
  })
});

const { data } = await response.json();
console.log(data.code);
```

### MCP Tools

AI generation tools are available via MCP for AI assistant integration:

| Tool | Description |
|------|-------------|
| `aqt_ai_generate_code` | Generate code from description |
| `aqt_ai_generate_test` | Generate tests for a file |
| `aqt_ai_generate_doc` | Generate documentation |
| `aqt_ai_fix_issue` | Generate fix for an issue |
| `aqt_ai_refactor` | Refactor code |
| `aqt_ai_configure` | Configure AI provider |
| `aqt_ai_cost_tracking` | Get cost tracking data |

See [MCP Tools Documentation](../../docs/MCP-TOOLS.md) for details.

See the [AI Generator Guide](../../docs/AI-GENERATOR.md) for provider setup,
safety, custom prompts, and quality metrics.

### UI Integration

The AI Generation panel in the chat UI provides a user-friendly interface for:

- **Code Generation**: Select language, framework, and enter description
- **Test Generation**: Enter file path and select test framework
- **Documentation Generation**: Enter file path and select format
- **Issue Fixing**: Enter issue ID and preview fix
- **Code Refactoring**: Enter file path and refactoring goal

Access the AI panel by clicking the "AI Generate" tab in the sidebar.

## Key Components

### Orchestrator

Main coordinator for AI operations:

```javascript
const { Orchestrator } = require('./ai-generator/orchestrator');

const orchestrator = new Orchestrator({
  executor: 'cloud',  // or 'local'
  searchProviders: ['github', 'stackoverflow', 'docs'],
  cacheResults: true
});

const result = await orchestrator.generateFix(issue, context);
```

### CloudExecutor

Executes AI requests via cloud providers:

```javascript
const { CloudExecutor } = require('./ai-generator/cloud-executor');

const executor = new CloudExecutor({
  provider: 'openai',
  model: 'gpt-4',
  apiKey: process.env.OPENAI_API_KEY
});

const response = await executor.execute(prompt);
```

### LocalExecutor

Executes AI requests via local models (Ollama):

```javascript
const { LocalExecutor } = require('./ai-generator/local-executor');

const executor = new LocalExecutor({
  model: 'codellama:7b',
  baseUrl: 'http://localhost:11434'
});

const response = await executor.execute(prompt);
```

### ContextAggregator

Aggregates context from multiple sources:

```javascript
const { ContextAggregator } = require('./ai-generator/context-aggregator');

const aggregator = new ContextAggregator({
  projectRoot: process.cwd()
});

const context = aggregator.aggregate({
  issue: issueDetails,
  files: affectedFiles,
  dependencies: packageInfo
});
```

### Search Providers

Multiple search providers for finding solutions:

```javascript
// GitHub Search
const { GitHubSearcher } = require('./ai-generator/github-searcher');
const githubSearcher = new GitHubSearcher();
const githubResults = await githubSearcher.search(query);

// Stack Overflow Search
const { StackOverflowSearcher } = require('./ai-generator/stackoverflow-searcher');
const soSearcher = new StackOverflowSearcher();
const soResults = await soSearcher.search(query);

// Documentation Search
const { DocSearcher } = require('./ai-generator/doc-searcher');
const docSearcher = new DocSearcher();
const docResults = await docSearcher.search(query);
```

### ErrorRecovery

Handles retry logic and error recovery:

```javascript
const { ErrorRecovery } = require('./ai-generator/error-recovery');

const recovery = new ErrorRecovery({
  maxRetries: 3,
  backoffMs: 1000
});

const result = await recovery.retry({
  attempt: () => executor.execute(prompt)
});
```

### AISafety

Validates generated code for safety:

```javascript
const { AISafety } = require('./ai-generator/ai-safety');

const safety = new AISafety();

// Validate generated code
const validation = await safety.validate(generatedCode, {
  checkSyntax: true,
  checkSecurity: true,
  checkPatterns: true
});

if (!validation.safe) {
  console.error('Safety issues:', validation.issues);
}
```

## Configuration

### AI Provider Configuration

Configure via environment variables or CLI:

```bash
# Environment variables
export OPENAI_API_KEY=your-key
export ANTHROPIC_API_KEY=your-key
export GOOGLE_API_KEY=your-key

# Or via CLI
aqt ai config openai --api-key your-key --model gpt-4
aqt ai config anthropic --api-key your-key --model claude-3-opus
aqt ai config google --api-key your-key --model gemini-pro
```

### Rate Limiting

```javascript
const { RateLimiter } = require('./ai-generator/config');

const limiter = new RateLimiter({
  requestsPerMinute: 20
});

if (limiter.check()) {
  // Proceed with request
}
```

### Cost Tracking

```javascript
const { CostTracker } = require('./ai-generator/config');

const tracker = new CostTracker({
  dailyBudgetUsd: 5.0,
  monthlyBudgetUsd: 100.0,
  reportsDir: '.aqt-reports'
});

// Track a request
tracker.record({
  provider: 'openai',
  model: 'gpt-4',
  promptTokens: 1000,
  completionTokens: 500,
  cost: 0.03
});

// Get summary
const summary = tracker.getSummary({ period: 'month' });
console.log(`Total cost: $${summary.totalCost}`);
console.log(`Budget remaining: $${summary.remaining}`);
```

### Budget Limits

```bash
# Set budget limits
aqt ai config openai --monthly-budget 100 --max-cost-per-request 5

# Check current costs
aqt ai cost
```

## Generation Types

### Code Generation

Generate code from natural language descriptions:

```javascript
const result = await orchestrator.generateCode({
  description: 'Create a function that validates email addresses',
  language: 'typescript',
  framework: 'react'
});
```

**Supported Languages:**
- JavaScript/TypeScript
- Python
- Java
- C#
- Go
- Rust

**Supported Frameworks:**
- React, Vue, Angular (Frontend)
- Express, NestJS, Fastify (Backend)
- Next.js, Nuxt (Full-stack)
- Jest, Vitest, Pytest (Testing)

### Test Generation

Generate unit tests for existing code:

```javascript
const result = await orchestrator.generateTests({
  filePath: 'src/services/UserService.js',
  framework: 'jest'
});
```

**Supported Test Frameworks:**
- Jest (JavaScript/TypeScript)
- Vitest (JavaScript/TypeScript)
- Mocha (JavaScript/TypeScript)
- Pytest (Python)
- JUnit (Java)

### Documentation Generation

Generate documentation for code:

```javascript
const result = await orchestrator.generateDocumentation({
  filePath: 'src/services/UserService.js',
  format: 'markdown'  // or 'jsdoc', 'jsdoc-markdown'
});
```

### Issue Fixing

Generate fixes for code quality issues:

```javascript
const result = await orchestrator.generateFix({
  issue: {
    ruleId: 'no-unused-vars',
    message: 'Variable is declared but never used',
    file: 'src/utils.js',
    line: 42
  }
});
```

### Code Refactoring

Refactor existing code:

```javascript
const result = await orchestrator.refactor({
  filePath: 'src/services/UserService.js',
  description: 'Extract the validation logic into a separate function',
  autoApply: false
});
```

## Safety Features

### Generated Code Validation

All generated code is validated before use:

1. **Syntax Validation**: Ensures code parses correctly
2. **Type Checking**: Validates TypeScript types (if applicable)
3. **Security Scanning**: Checks for malicious patterns
4. **Content Filtering**: Detects prompt injection attempts

### Approval Workflow

For high-confidence operations:

```bash
# Preview without applying
aqt ai fix <issue-id> --dry-run

# Review generated code, then apply
aqt ai fix <issue-id> --apply
```

### Audit Logging

All AI interactions are logged:

```javascript
// Logs stored in .aqt-reports/ai-interactions.jsonl
{
  "timestamp": "2024-10-12T10:30:00.000Z",
  "type": "generate_code",
  "provider": "openai",
  "model": "gpt-4",
  "promptTokens": 1000,
  "completionTokens": 500,
  "cost": 0.03,
  "approved": true,
  "applied": true
}
```

## Quality Metrics

Track the quality of AI-generated content:

```javascript
const metrics = await orchestrator.getMetrics({
  period: 'month'
});

console.log(`Success rate: ${metrics.successRate}%`);
console.log(`Approval rate: ${metrics.approvalRate}%`);
console.log(`Average confidence: ${metrics.avgConfidence}`);
```

## Troubleshooting

### Common Issues

1. **API Key Not Set**
   ```
   Error: OPENAI_API_KEY not configured
   ```
   Solution: Set the environment variable or use `aqt ai config openai --api-key your-key`

2. **Rate Limit Exceeded**
   ```
   Error: Rate limit exceeded. Please wait before retrying.
   ```
   Solution: Wait a few minutes or adjust rate limits in configuration

3. **Budget Exceeded**
   ```
   Error: Monthly budget exceeded
   ```
   Solution: Increase budget or wait for next billing period

4. **Model Not Available**
   ```
   Error: Model 'gpt-5' not available
   ```
   Solution: Use an available model: gpt-4, gpt-3.5-turbo, claude-3-opus, etc.

### Debug Mode

Enable debug logging:

```bash
export AQT_DEBUG=true
export AQT_LOG_LEVEL=debug
aqt ai generate code "test"
```

## Dependencies

- AI provider SDKs (OpenAI, Anthropic, Google Generative AI)
- HTTP clients for search APIs
- File system for caching
- AST parsers for code analysis

## Related Documentation

- [API Documentation](../../docs/openapi.yaml)
- [MCP Tools Documentation](../../docs/MCP-TOOLS.md)
- [Main README](../../README.md)
