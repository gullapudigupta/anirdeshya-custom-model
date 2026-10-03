# CLI Interface

## Overview

The Advanced Quality Tool Command Line Interface provides comprehensive access to all AQT functionality through a unified command-line experience. The CLI is designed for both interactive use and automation in scripts, CI/CD pipelines, and development workflows.

## Installation and Setup

### Global Installation

```bash
npm install -g @advanced-quality-tool/cli
```

### Local Installation

```bash
npm install --save-dev @advanced-quality-tool/cli
```

### Binary Access

After installation, the CLI is available as:
- `aqt` (primary command)
- `advanced-quality-tool` (full name alternative)

**File**: `bin/aqt.js` - Main CLI entry point
**Implementation**: `src/commands/standalone-cli.js`

## Command Structure

```
aqt <command> [subcommand] [options] [arguments]
```

### Global Options

All commands support these global options:

```bash
  --workspace, -w <path>     Workspace directory (default: current directory)
  --config, -c <file>        Configuration file path (default: .aqt-config.json)
  --verbose, -v              Enable verbose logging
  --quiet, -q                Suppress non-essential output
  --format <format>          Output format (json|table|csv|html|markdown)
  --no-color                 Disable colored output
  --help, -h                 Show command help
  --version                  Show version information
```

## Core Commands

### `aqt analyze`

Performs comprehensive code quality analysis.

**Synopsis**:
```bash
aqt analyze [options] [path...]
```

**Options**:
```bash
  --languages <langs>        Comma-separated list of languages to analyze
  --include-metrics          Include complexity and maintainability metrics
  --include-security         Include security vulnerability analysis
  --include-performance      Include performance issue detection
  --exclude <patterns>       Exclude files matching glob patterns
  --severity <level>         Minimum severity level (info|warning|error|critical)
  --output, -o <file>        Save report to file
  --cache                    Use cached results when available
  --no-cache                 Force fresh analysis
  --max-depth <n>            Maximum directory traversal depth
  --parallel <n>             Number of parallel analysis processes
```

**Examples**:
```bash
# Analyze current directory
aqt analyze

# Analyze specific files
aqt analyze src/components/Button.tsx src/utils/helpers.js

# Full security and performance analysis
aqt analyze --include-security --include-performance --languages javascript,typescript

# Generate HTML report
aqt analyze --format html --output quality-report.html

# Analyze with custom severity threshold
aqt analyze --severity error --exclude "**/*.test.js"
```

### `aqt fix`

Applies fixes to identified code issues.

**Synopsis**:
```bash
aqt fix [options] [issue-id...]
```

**Options**:
```bash
  --type <type>              Fix type (auto|ai|manual|all)
  --confidence <threshold>   Minimum confidence threshold (0.0-1.0)
  --dry-run                  Preview changes without applying
  --backup                   Create backup before applying fixes (default: true)
  --no-backup                Disable backup creation
  --verify                   Verify fixes after application (default: true)
  --no-verify                Skip verification step
  --interactive, -i          Interactive fix selection
  --batch                    Apply all qualifying fixes without prompts
  --exclude-rules <rules>    Exclude specific fix rules
```

**Examples**:
```bash
# Apply all high-confidence automatic fixes
aqt fix --type auto --confidence 0.8

# Interactive fix selection
aqt fix --interactive

# Preview changes without applying
aqt fix --dry-run --type all

# Fix specific issues
aqt fix ISSUE-001 ISSUE-002 ISSUE-003

# Batch fix all AI-suggested fixes
aqt fix --type ai --batch --confidence 0.9
```

### `aqt generate-fixes`

Generates fix suggestions for detected issues.

**Synopsis**:
```bash
aqt generate-fixes [options] [issue-id...]
```

**Options**:
```bash
  --max-fixes <n>            Maximum number of fixes to generate (default: 50)
  --priority <level>         Priority level (low|medium|high|critical)
  --include-ai               Include AI-generated fixes (default: true)
  --include-rules            Include rule-based fixes (default: true)
  --exclude-experimental     Exclude experimental fixes
  --context-lines <n>        Lines of context around issues (default: 5)
  --explain                  Include detailed explanations
  --save <file>              Save fixes to file for later application
```

**Examples**:
```bash
# Generate fixes for all high-priority issues
aqt generate-fixes --priority high --max-fixes 20

# Generate with detailed explanations
aqt generate-fixes --explain --context-lines 10

# Save fixes for later review
aqt generate-fixes --save pending-fixes.json

# Generate fixes for specific issues
aqt generate-fixes ISSUE-001 ISSUE-005 --include-ai
```

### `aqt watch`

Continuous monitoring and analysis of code changes.

**Synopsis**:
```bash
aqt watch [options] [path...]
```

**Options**:
```bash
  --debounce <ms>            Debounce delay for file changes (default: 500)
  --auto-fix                 Automatically apply high-confidence fixes
  --notify                   Send desktop notifications
  --include <patterns>       Include files matching patterns
  --exclude <patterns>       Exclude files matching patterns
  --on-change <command>      Command to run on changes
  --on-fix <command>         Command to run after fixes applied
```

**Examples**:
```bash
# Watch current directory with auto-fix
aqt watch --auto-fix --notify

# Watch specific directories
aqt watch src/ tests/ --debounce 1000

# Watch with custom commands
aqt watch --on-change "npm test" --on-fix "git add ."

# Watch TypeScript files only
aqt watch --include "**/*.ts" --include "**/*.tsx"
```

### `aqt report`

Generate and manage quality reports.

**Synopsis**:
```bash
aqt report [command] [options]
```

**Subcommands**:
```bash
  generate                   Generate new report from latest analysis
  list                       List available reports
  show <id>                  Display specific report
  export <id>                Export report to file
  compare <id1> <id2>        Compare two reports
  history                    Show report history and trends
```

**Options**:
```bash
  --format <format>          Output format (json|html|markdown|pdf|csv)
  --template <template>      Report template name
  --include-metrics          Include detailed metrics
  --include-trends           Include historical trends
  --since <date>             Reports since date (YYYY-MM-DD)
  --limit <n>                Limit number of reports
```

**Examples**:
```bash
# Generate HTML report
aqt report generate --format html --include-trends

# List recent reports
aqt report list --limit 10

# Compare two reports
aqt report compare report-001 report-002

# Export report to PDF
aqt report export report-001 --format pdf

# Show report history
aqt report history --since 2023-11-01
```

### `aqt config`

Configuration management commands.

**Synopsis**:
```bash
aqt config [command] [options]
```

**Subcommands**:
```bash
  init                       Initialize configuration file
  show                       Display current configuration
  set <key> <value>          Set configuration value
  get <key>                  Get configuration value
  unset <key>                Remove configuration value
  validate                   Validate configuration file
  reset                      Reset to default configuration
```

**Examples**:
```bash
# Initialize configuration
aqt config init

# Set analysis options
aqt config set analysis.includeMetrics true
aqt config set excludePatterns "**/*.test.js,dist/**"

# Show current config
aqt config show --format json

# Validate configuration
aqt config validate
```

### `aqt ui`

Launch interactive web interface.

**Synopsis**:
```bash
aqt ui [options]
```

**Options**:
```bash
  --port <port>              Server port (default: 3000)
  --host <host>              Server host (default: localhost)
  --open                     Open browser automatically
  --no-open                  Don't open browser
  --readonly                 Launch in read-only mode
```

**Examples**:
```bash
# Launch UI with default settings
aqt ui

# Launch on specific port
aqt ui --port 8080 --open

# Read-only mode
aqt ui --readonly --host 0.0.0.0
```

### `aqt monitor`

System monitoring and health checks.

**Synopsis**:
```bash
aqt monitor [command] [options]
```

**Subcommands**:
```bash
  status                     Show system status
  health                     Perform health check
  metrics                    Display performance metrics
  logs                       Show recent logs
```

**Examples**:
```bash
# Check system status
aqt monitor status

# Show performance metrics
aqt monitor metrics --format table

# Tail logs
aqt monitor logs --follow
```

## Advanced Usage

### Scripting and Automation

**Bash Script Example**:
```bash
#!/bin/bash
# quality-check.sh - Automated quality checking script

set -e

echo "Running quality analysis..."
REPORT=$(aqt analyze --format json --quiet)

# Extract quality score
SCORE=$(echo "$REPORT" | jq -r '.qualityScore')

if (( $(echo "$SCORE < 0.8" | bc -l) )); then
  echo "Quality score $SCORE is below threshold"
  
  # Generate and apply fixes
  echo "Generating fixes..."
  aqt generate-fixes --priority high --save fixes.json
  
  # Apply high-confidence fixes
  aqt fix --confidence 0.9 --batch
  
  # Re-analyze
  NEW_SCORE=$(aqt analyze --format json --quiet | jq -r '.qualityScore')
  echo "Quality improved from $SCORE to $NEW_SCORE"
fi
```

### CI/CD Integration

**GitHub Actions**:
```yaml
- name: Quality Analysis
  run: |
    npm install -g @advanced-quality-tool/cli
    aqt analyze --format json --output aqt-report.json
    aqt report generate --format html --output quality-report.html

- name: Upload Quality Report
  uses: actions/upload-artifact@v3
  with:
    name: quality-report
    path: quality-report.html
```

### Configuration File Integration

**Package.json Scripts**:
```json
{
  "scripts": {
    "quality": "aqt analyze",
    "quality:fix": "aqt fix --confidence 0.8 --batch",
    "quality:watch": "aqt watch --auto-fix",
    "quality:report": "aqt report generate --format html --open"
  }
}
```

## Output Formats

### JSON Format

Structured data for programmatic processing:
```json
{
  "timestamp": "2023-12-01T10:30:00Z",
  "workspace": "/path/to/project",
  "summary": {
    "filesAnalyzed": 42,
    "issuesFound": 8,
    "qualityScore": 0.85,
    "categories": {
      "errors": 2,
      "warnings": 4,
      "info": 2
    }
  },
  "issues": [
    {
      "id": "ISSUE-001",
      "severity": "error",
      "category": "security",
      "rule": "no-eval",
      "message": "Use of eval() is dangerous",
      "file": "src/utils.js",
      "line": 42,
      "column": 15,
      "fixable": true,
      "confidence": 0.95
    }
  ],
  "metrics": {
    "complexity": 2.3,
    "maintainability": 0.82,
    "testCoverage": 0.67
  }
}
```

### Table Format

Human-readable tabular output:
```
┌─────────────┬──────────┬────────────┬─────────────┬───────────────────────────┐
│ File        │ Severity │ Category   │ Line        │ Message                   │
├─────────────┼──────────┼────────────┼─────────────┼───────────────────────────┤
│ src/utils.js│ error    │ security   │ 42:15       │ Use of eval() is dangerous│
│ src/api.js  │ warning  │ performance│ 123:8       │ Inefficient loop detected │
│ src/main.js │ info     │ style      │ 89:1        │ Missing semicolon         │
└─────────────┴──────────┴────────────┴─────────────┴───────────────────────────┘

Quality Score: 0.85/1.0
Files Analyzed: 42
Total Issues: 8 (2 errors, 4 warnings, 2 info)
```

### HTML Format

Rich web-based reports with interactive features:
- Syntax-highlighted code views
- Filterable issue lists
- Trend charts and graphs
- Drill-down capability
- Export functionality

### Markdown Format

Documentation-friendly format for README files and wikis:
```markdown
# Quality Analysis Report

**Generated**: 2023-12-01 10:30:00 UTC  
**Workspace**: `/path/to/project`  
**Quality Score**: 0.85/1.0

## Summary

- **Files Analyzed**: 42
- **Issues Found**: 8
- **Errors**: 2
- **Warnings**: 4
- **Info**: 2

## Issues by Category

### Security Issues (1)
- **ISSUE-001**: Use of eval() is dangerous (`src/utils.js:42`)

### Performance Issues (3)  
- **ISSUE-002**: Inefficient loop detected (`src/api.js:123`)
```

## Error Handling and Exit Codes

The CLI uses standard exit codes for script integration:

- **0**: Success
- **1**: General error
- **2**: Misuse of shell command
- **3**: Analysis found critical issues
- **4**: Fix application failed
- **5**: Configuration error
- **6**: Workspace not found
- **7**: Permission denied

**Error Output Format**:
```json
{
  "error": {
    "code": "ANALYSIS_FAILED", 
    "message": "Unable to analyze workspace",
    "details": {
      "workspace": "/invalid/path",
      "reason": "Directory not found"
    }
  }
}
```

## Environment Variables

The CLI respects these environment variables:

```bash
AQT_CONFIG_PATH           # Default configuration file path
AQT_WORKSPACE_PATH        # Default workspace directory
AQT_CACHE_DIR             # Cache directory location
AQT_LOG_LEVEL             # Logging level (debug|info|warn|error)
AQT_NO_COLOR              # Disable colored output (any value)
AQT_API_URL               # AQT API server URL for remote operations
AQT_API_TOKEN             # Authentication token for API access
AQT_PARALLEL_LIMIT        # Maximum parallel processes
AQT_TIMEOUT               # Default operation timeout (seconds)
```

## Plugin System

### Loading Plugins

```bash
# Load plugin from npm package
aqt --plugin @aqt/eslint-plugin analyze

# Load local plugin
aqt --plugin ./custom-plugin.js analyze

# Configure plugins in config file
aqt config set plugins '["@aqt/eslint-plugin", "./local-plugin.js"]'
```

### Plugin Interface

Plugins can extend CLI functionality:
```javascript
// custom-plugin.js
module.exports = {
  name: 'custom-analyzer',
  commands: {
    'custom-analyze': {
      description: 'Custom analysis command',
      options: {
        'custom-option': { type: 'string', description: 'Custom option' }
      },
      handler: async (args, options) => {
        // Custom command implementation
      }
    }
  },
  analyzers: [
    require('./custom-analyzer')
  ]
};
```

## Troubleshooting

### Common Issues

1. **Permission Errors**
   ```bash
   # Fix: Run with proper permissions or change workspace
   sudo aqt analyze
   # or
   aqt analyze --workspace /path/with/permissions
   ```

2. **Memory Issues with Large Projects**
   ```bash
   # Fix: Increase memory limit or reduce scope
   NODE_OPTIONS="--max-old-space-size=8192" aqt analyze
   # or
   aqt analyze --exclude "node_modules/**" --max-depth 3
   ```

3. **Configuration Not Found**
   ```bash
   # Fix: Initialize configuration or specify path
   aqt config init
   # or  
   aqt analyze --config /path/to/.aqt-config.json
   ```

### Debug Mode

Enable debug output:
```bash
AQT_LOG_LEVEL=debug aqt analyze --verbose
```

### Getting Help

```bash
# General help
aqt --help

# Command-specific help
aqt analyze --help
aqt fix --help

# Show version and build info
aqt --version

# Configuration help
aqt config --help
```

## Related Documentation

- [HTTP API Interface](API.md)
- [MCP Interface](MCP.md)
- [Orchestration Interface](ORCHESTRATION.md)
- [Shared Configuration Guide](SHARED-CONFIG.md)