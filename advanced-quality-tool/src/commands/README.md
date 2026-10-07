# Commands Module

## Overview

The `src/commands` module provides the CLI command implementations for Advanced Quality Tool. Each file implements a specific command that can be invoked from the command line.

📋 **[View Gap Analysis](./GAPS.md)** - See missing features and improvement opportunities

## Contents

| File | Description |
|------|-------------|
| `standalone-cli.js` | Main CLI adapter and command routing |
| `fix-command.js` | Implements the `fix` command for auto-fixing issues |
| `generate-fixes-command.js` | Implements the `generate-fixes` command |
| `monitor-command.js` | Implements the `monitor` command for CI/CD integration |
| `watch-command.js` | Implements the `watch` command for file watching |
| `ui-command.js` | Implements the `ui` command for launching the web UI |
| `report-command.js` | Generates JSON, Markdown, HTML, and SARIF reports |
| `metrics-command.js` | Calculates JavaScript complexity metrics |
| `dashboard-command.js` | Manages opt-in local dashboard history |
| `analytics-command.js` | Manages opt-in, local-only command usage metrics |
| `ai-command.js` | Generates code and manages custom AI templates |

## Command Reference

### report, metrics, dashboard, and analytics

```bash
aqt report --input analysis.json --format sarif --output report.sarif
aqt metrics src/ --format markdown
aqt dashboard enable
aqt analytics status
aqt analytics enable
aqt analytics report --days 30
aqt analytics disable
aqt analytics clear
```

Usage analytics are disabled by default. When enabled, only command names,
success/failure counts, and elapsed time are kept in `.aqt/usage-metrics.json`;
data is never uploaded and may be removed with `aqt analytics clear`.

AI-assisted fixes are available with `aqt fix --use-ai-fixes`; `--no-ai-fixes`
leaves issues that lack deterministic fixes for manual review.

### fix

Automatically fixes issues in the project:

```bash
aqt fix [options]

Options:
  --files <patterns>   File patterns to analyze (comma-separated)
  --dry-run            Show fixes without applying
  --no-backup          Skip creating backups
  --max-issues <n>     Maximum issues to fix per file
  --help               Show help
```

**Usage:**
```javascript
const { run } = require('./commands/fix-command');

await run({
  files: ['src/**/*.js'],
  dryRun: false,
  maxIssues: 10
});
```

### generate-fixes

Generates fix suggestions without applying:

```bash
aqt generate-fixes [options]

Options:
  --files <patterns>   File patterns to analyze
  --output <file>      Output file for suggestions
  --format <type>      Output format (json, markdown)
  --help               Show help
```

**Usage:**
```javascript
const { run } = require('./commands/generate-fixes-command');

await run({
  files: ['src/**/*.js'],
  output: 'fixes.json',
  format: 'json'
});
```

### monitor

Runs quality checks in CI/CD environments:

```bash
aqt monitor [options]

Options:
  --fail-on <level>    Fail on severity level (error, warning)
  --report <file>      Output report file
  --format <type>      Report format (json, junit)
  --baseline <file>    Baseline file for comparison
  --help               Show help
```

**Usage:**
```javascript
const { run } = require('./commands/monitor-command');

await run({
  failOn: 'error',
  report: 'quality-report.json',
  format: 'junit'
});
```

### watch

Watches files for changes and runs analysis:

```bash
aqt watch [options]

Options:
  --paths <dirs>       Directories to watch (comma-separated)
  --ignore <patterns>  Patterns to ignore
  --debounce <ms>      Debounce interval
  --help               Show help
```

**Usage:**
```javascript
const { run } = require('./commands/watch-command');

await run({
  paths: ['src', 'test'],
  ignore: ['node_modules', 'dist'],
  debounce: 500
});
```

### ui

Launches the web-based user interface:

```bash
aqt ui [options]

Options:
  --port <number>      Port to serve UI (default: 3456)
  --no-open            Don't open browser automatically
  --help               Show help
```

**Usage:**
```javascript
const { run } = require('./commands/ui-command');

await run({
  port: 3456,
  open: true
});
```

## Standalone CLI Adapter

The `standalone-cli.js` provides the main entry point for CLI operations:

```javascript
const { StandaloneCliAdapter } = require('./commands/standalone-cli');

const cli = new StandaloneCliAdapter({
  projectRoot: process.cwd()
});

await cli.run(process.argv);
```

### Supported Commands

| Command | Description |
|---------|-------------|
| `analyze` | Analyze project for issues |
| `fix` | Auto-fix detected issues |
| `watch` | Watch and analyze on changes |
| `ui` | Launch web UI |
| `monitor` | CI/CD monitoring mode |

## Output Formats

### JSON Report

```json
{
  "summary": {
    "total": 10,
    "errors": 2,
    "warnings": 5,
    "info": 3
  },
  "issues": [...]
}
```

### JUnit Report

XML format compatible with CI systems like Jenkins, GitLab CI, etc.

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success, no issues |
| 1 | Issues found |
| 2 | Error during execution |

## Integration

### Programmatic Usage

```javascript
const { run: runFix } = require('./commands/fix-command');
const { run: runMonitor } = require('./commands/monitor-command');

// Run fix
const fixResults = await runFix({ files: ['src/'] });

// Run monitor
const monitorResults = await runMonitor({ failOn: 'error' });
```

### Event Handling

```javascript
const { run } = require('./commands/generate-fixes-command');

await run({
  onProgress: (event) => console.log(event),
  onComplete: (results) => saveResults(results)
});
```
