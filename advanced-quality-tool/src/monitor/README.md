# Monitor Module

## Overview

The `src/monitor` module provides CI/CD integration for continuous quality monitoring. It detects CI environments, runs quality checks, and reports results in CI-compatible formats.

## Contents

| File | Description |
|------|-------------|
| `build-monitor.js` | CI/CD build monitoring and quality gates |

## Key Components

### BuildMonitor

Monitors builds in CI environments:

```javascript
const { BuildMonitor } = require('./monitor/build-monitor');

const monitor = new BuildMonitor({
  projectRoot: process.cwd(),
  failThreshold: 'error',
  reportFormat: 'junit'
});

// Detect CI environment
const ci = monitor.detectCIEnvironment();

// Start monitoring
monitor.start();

// Process results
const report = await monitor.processResults(analysisResults);
```

## Supported CI Environments

| CI System | Detection |
|-----------|-----------|
| GitHub Actions | `GITHUB_ACTIONS` env var |
| GitLab CI | `GITLAB_CI` env var |
| Jenkins | `JENKINS_URL` env var |
| CircleCI | `CIRCLECI` env var |
| Travis CI | `TRAVIS` env var |
| Azure Pipelines | `TF_BUILD` env var |
| Bitbucket Pipelines | `BITBUCKET_BUILD_NUMBER` env var |

## Features

### CI Environment Detection

```javascript
const ci = monitor.detectCIEnvironment();
// Returns:
// {
//   name: 'github-actions',
//   buildId: '12345',
//   buildUrl: 'https://github.com/...',
//   branch: 'main',
//   commit: 'abc123',
//   pullRequest: 42,
//   ...
// }
```

### Quality Gates

```javascript
const monitor = new BuildMonitor({
  failThreshold: 'error',     // Fail on errors
  maxErrors: 0,               // Maximum allowed errors
  maxWarnings: 10,            // Maximum allowed warnings
  checkCoverage: true,        // Check code coverage
  minCoverage: 80             // Minimum coverage percentage
});

const result = await monitor.processResults(analysis);
if (result.failed) {
  process.exit(1);
}
```

### Report Generation

```javascript
// Generate reports in multiple formats
await monitor.processResults(analysis, {
  formats: ['junit', 'json', 'markdown'],
  outputDir: 'reports'
});
```

## Usage Examples

### GitHub Actions Integration

```yaml
# .github/workflows/quality.yml
name: Quality Check

on: [push, pull_request]

jobs:
  quality:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - run: npm install -g advanced-quality-tool
      - run: aqt monitor --fail-on error --report reports/quality.xml
      - uses: actions/upload-artifact@v3
        with:
          name: quality-report
          path: reports/
```

### Programmatic Usage

```javascript
const { BuildMonitor } = require('./monitor/build-monitor');

async function runQualityGate() {
  const monitor = new BuildMonitor({
    failThreshold: 'error',
    reportFormat: 'junit'
  });

  // Detect environment
  const ci = monitor.detectCIEnvironment();
  console.log(`Running in ${ci.name}`);

  // Start monitoring
  monitor.start();

  // Run analysis
  const results = await analyzeProject();

  // Process and report
  const report = await monitor.processResults(results);

  // Set exit code
  if (report.issues.length > 0 && report.hasErrors) {
    console.error('Quality gate failed');
    process.exit(1);
  }
}
```

### Custom CI Integration

```javascript
const monitor = new BuildMonitor();

// Custom CI detection
monitor.detectCIEnvironment = function() {
  return {
    name: 'custom-ci',
    buildId: process.env.CUSTOM_BUILD_ID,
    branch: process.env.CUSTOM_BRANCH,
    commit: process.env.CUSTOM_COMMIT
  };
};

// Custom report handling
monitor.processResults = async function(results) {
  const report = this.generateReport(results);
  
  // Post to custom endpoint
  await fetch('https://api.custom-ci.com/report', {
    method: 'POST',
    body: JSON.stringify(report)
  });
  
  return report;
};
```

## Configuration

```javascript
{
  projectRoot: string,        // Project root directory
  failThreshold: string,      // 'error' | 'warning' | 'none'
  maxErrors: number,          // Maximum allowed errors
  maxWarnings: number,        // Maximum allowed warnings
  reportFormat: string,       // 'junit' | 'json' | 'markdown'
  reportPath: string,         // Output path for report
  checkCoverage: boolean,     // Enable coverage check
  minCoverage: number         // Minimum coverage percentage
}
```

## Output Formats

### JUnit XML

```xml
<?xml version="1.0" encoding="UTF-8"?>
<testsuites>
  <testsuite name="Quality Check" tests="10" failures="2">
    <testcase name="no-unused-vars" classname="src/app.js">
      <failure message="Variable 'x' is declared but never used"/>
    </testcase>
  </testsuite>
</testsuites>
```

### JSON

```json
{
  "summary": {
    "total": 10,
    "errors": 2,
    "warnings": 5,
    "info": 3
  },
  "issues": [...],
  "ci": {
    "name": "github-actions",
    "buildId": "12345"
  }
}
```

## Dependencies

- File system access
- Environment variables
- HTTP client (for custom integrations)
