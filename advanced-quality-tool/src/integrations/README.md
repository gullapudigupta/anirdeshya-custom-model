# Integrations Module

## Overview

The `src/integrations` module provides integrations with external tools, CI/CD systems, and collaboration platforms. It enables Advanced Quality Tool to work seamlessly with various development workflows.

## Contents

| File | Description |
|------|-------------|
| `mcp-server.js` | Model Context Protocol server implementation |
| `http-api-server.js` | HTTP API server for remote access |
| `orchestration-adapter.js` | Orchestrates external tool integrations |
| `linter-cli.js` | Linter CLI integration and management |
| `pr-integrator.js` | Pull request integration (GitHub, GitLab) |
| `pre-commit-hooks.js` | Git pre-commit hook integration |
| `branch-analyzer.js` | Git branch analysis utilities |
| `coverage-integrator.js` | Code coverage integration |
| `issue-normalizer.js` | Normalizes issues from different sources |
| `notification-system.js` | Multi-channel notification system |
| `team-collaboration.js` | Team collaboration features |

## Key Components

### MCPServer

Implements the Model Context Protocol for AI tool integration:

```javascript
const { MCPServer } = require('./integrations/mcp-server');

const server = new MCPServer({
  transport: 'stdio',  // or 'http'
  tools: ['analyze', 'fix', 'review']
});

await server.start();

// Register tool handlers
server.registerTool('analyze', async (params) => {
  return { issues: await analyzeProject(params) };
});

await server.stop();
```

### HttpApiServer

Provides REST API for remote access:

```javascript
const { HttpApiServer } = require('./integrations/http-api-server');

const api = new HttpApiServer({
  port: 3456,
  auth: { enabled: true, secret: process.env.API_SECRET }
});

api.setupMiddleware();
api.setupRoutes();

// Routes:
// POST /api/analyze
// POST /api/fix
// GET  /api/status
// GET  /api/issues
```

### OrchestrationAdapter

Coordinates multiple integrations:

```javascript
const { OrchestrationAdapter } = require('./integrations/orchestration-adapter');

const adapter = new OrchestrationAdapter({
  integrations: ['linter', 'coverage', 'pr']
});

const manifest = adapter.getManifest();
// Lists available operations

const result = await adapter.call('linter.run', { files: ['src/'] });
```

### LinterIntegration

Manages external linter execution:

```javascript
const { LinterIntegration, detectAvailableLinters } = require('./integrations/linter-cli');

// Detect available linters
const linters = detectAvailableLinters(projectRoot);
// ['eslint', 'prettier', 'stylelint']

// Run specific linter
const eslint = new LinterIntegration(projectRoot, 'eslint');
if (eslint.isAvailable()) {
  const issues = await eslint.run(['src/**/*.js']);
}
```

### PRIntegrator

Integrates with pull request workflows:

```javascript
const { PRIntegrator } = require('./integrations/pr-integrator');

const pr = new PRIntegrator({
  platform: 'github',  // or 'gitlab', 'bitbucket'
  token: process.env.GITHUB_TOKEN
});

// Post comment on PR
await pr.postComment({
  repo: 'owner/repo',
  prNumber: 42,
  body: analysisSummary
});

// Set commit status
await pr.setCommitStatus({
  repo: 'owner/repo',
  sha: 'abc123',
  state: 'success',
  description: 'Quality check passed'
});
```

### BranchAnalyzer

Analyzes Git branches for changes:

```javascript
const { BranchAnalyzer } = require('./integrations/branch-analyzer');

const analyzer = new BranchAnalyzer({
  projectRoot: process.cwd()
});

const currentBranch = analyzer.getCurrentBranch();
const branches = analyzer.listBranches();
const changedFiles = analyzer.getChangedFiles('main', 'HEAD');
```

### CoverageIntegrator

Integrates with code coverage tools:

```javascript
const { CoverageIntegrator } = require('./integrations/coverage-integrator');

const coverage = new CoverageIntegrator({
  projectRoot: process.cwd()
});

// Run coverage
const report = await coverage.runCoverage('npm test');

// Load existing report
const data = coverage.loadReport('coverage/lcov.info');

// Get coverage issues
const issues = coverage.getIssues(summaryReport);
```

### IssueNormalizer

Normalizes issues from different sources:

```javascript
const { normalizeIssue, validateIssue, generateIssueId } = require('./integrations/issue-normalizer');

const normalized = normalizeIssue(rawIssue, projectRoot);
// {
//   id: 'unique-id',
//   file: 'relative/path.js',
//   line: 42,
//   severity: 'error',
//   rule: 'rule-name',
//   message: 'Issue description',
//   priority: 'high'
// }

// Validate issue structure
const isValid = validateIssue(normalized);
```

### NotificationSystem

Sends notifications through multiple channels:

```javascript
const { NotificationSystem } = require('./integrations/notification-system');

const notifications = new NotificationSystem({
  channels: ['slack', 'email', 'webhook'],
  slack: { webhookUrl: process.env.SLACK_WEBHOOK },
  email: { smtp: {...} }
});

await notifications.notify(issues);
await notifications.sendMessage('Quality Alert', 'Issues detected', 'warning');
```

## Configuration

### Integration Manifest

```javascript
{
  integrations: {
    linter: { enabled: true, tools: ['eslint'] },
    coverage: { enabled: true, threshold: 80 },
    pr: { enabled: true, platform: 'github' },
    notifications: { enabled: true, channels: ['slack'] }
  }
}
```

### HTTP API Authentication

```javascript
{
  auth: {
    enabled: true,
    type: 'bearer',  // or 'api-key'
    secret: process.env.API_SECRET
  }
}
```

## Usage Patterns

### CI/CD Integration

```javascript
const { LinterIntegration } = require('./integrations/linter-cli');
const { PRIntegrator } = require('./integrations/pr-integrator');

// Run in CI
const linter = new LinterIntegration(projectRoot);
const issues = await linter.run(changedFiles);

// Post results to PR
const pr = new PRIntegrator({ platform: 'github' });
await pr.postComment({ repo, prNumber, body: formatResults(issues) });
await pr.setCommitStatus({ repo, sha, state: issues.length ? 'failure' : 'success' });
```

### Pre-commit Hook

```javascript
// In .git/hooks/pre-commit
const { BranchAnalyzer } = require('./integrations/branch-analyzer');
const { LinterIntegration } = require('./integrations/linter-cli');

const analyzer = new BranchAnalyzer();
const files = analyzer.getChangedFiles();

const linter = new LinterIntegration(process.cwd());
const issues = await linter.run(files);

if (issues.filter(i => i.severity === 'error').length > 0) {
  console.error('Blocking commit due to errors');
  process.exit(1);
}
```

## Dependencies

- Git CLI
- Linter CLIs (ESLint, Pylint, etc.)
- HTTP client libraries
- Platform-specific APIs (GitHub, GitLab, Slack)
