# Advanced Quality Tool - CLI Quick Start Guide

**Last Updated**: 2026-09-30  
**Status**: Ready for Production (Phase 8, Task ST-004)

## Installation

```bash
# Clone repo and install
git clone <repo>
cd advanced-quality-tool
npm install

# Link CLI globally (optional)
npm link

# Or run directly
./bin/aqt.js --help
```

## Basic Usage

### Analyze Code
```bash
aqt analyze
aqt analyze src/
aqt analyze src/ lib/
aqt analyze --verbose
```

### Apply Fixes
```bash
# Preview first (dry-run)
aqt fix --dry-run

# Apply fixes
aqt fix

# Use specific strategy
aqt fix --strategy rule-only
```

### Code Review
```bash
aqt review src/
aqt review --json
```

### Generate Reports
```bash
# JSON report
aqt report --format json > report.json

# Markdown report
aqt report --format md > report.md

# SARIF (for GitHub/VS Code)
aqt report --format sarif > report.sarif
```

### Manage Configuration
```bash
# Show current config
aqt config

# Get specific value
aqt config get linters

# Set value
aqt config set linters "eslint,pylint"
```

### Check System Health
```bash
aqt health
aqt health --verbose
aqt health --json
```

## Configuration Files

Create `aqt-config.json` in your project root:

```json
{
  "linters": ["eslint", "pylint"],
  "autoFix": true,
  "strategy": "three-tier",
  "exclude": ["node_modules/**", "dist/**"],
  "verbose": false
}
```

Or in your home directory for user-level defaults:

```bash
# On Linux/macOS
~/.aqt-config.json

# On Windows
%USERPROFILE%\.aqt-config.json
```

## Environment Variables

```bash
export AQT_VERBOSE=true
export AQT_LINTERS="eslint,pylint"
export AQT_STRATEGY=rule-only
export AQT_PROJECT_ROOT=/path/to/project
```

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | General error |
| 2 | Configuration error |
| 3 | Model required (AI setup needed) |
| 4 | Operation cancelled |
| 5 | Invalid input |

## Machine-Readable Output

Use `--json` flag for JSON output (great for scripting):

```bash
# Count total issues
aqt analyze --json | jq '.issues | length'

# Export to file
aqt report --format json > results.json

# Parse results in shell
ISSUES=$(aqt analyze --json | jq '.issueCount')
if [ $ISSUES -gt 0 ]; then
  echo "Found $ISSUES issues"
fi
```

## CI/CD Integration

### GitHub Actions
```yaml
- run: aqt analyze --json > results.json
- run: aqt fix --dry-run
- run: aqt report --format sarif > results.sarif
```

### GitLab CI
```yaml
analyze:
  script:
    - aqt analyze --json > results.json
  artifacts:
    reports:
      quality: results.json
```

## Common Workflows

### Local Development
```bash
# Before committing
aqt analyze src/
aqt fix --dry-run
aqt fix
git add .
```

### Pre-commit Hook
Create `.git/hooks/pre-commit`:
```bash
#!/bin/bash
aqt analyze || exit 1
aqt fix
git add .
```

### CI/CD Gate
```bash
#!/bin/bash
set -e
aqt analyze
aqt health || exit 1
echo "✅ Quality check passed"
```

## Troubleshooting

### "Command not found: aqt"
```bash
# Use full path
./bin/aqt.js analyze

# Or add to PATH
export PATH="$PATH:$(pwd)/bin"
aqt analyze
```

### "Model Required" Error
```bash
# Check what's needed
aqt health

# Set up the required model (e.g., OpenAI)
export OPENAI_API_KEY=sk-...
aqt health  # Should now be healthy
```

### "Config file not found"
```bash
# Check which config file is being used
AQT_VERBOSE=true aqt analyze

# Create a config file
echo '{"linters": ["eslint"]}' > aqt-config.json
```

## Advanced Usage

### Custom Linters
```bash
aqt analyze --linters "eslint,pylint,shellcheck"
```

### Exclude Patterns
```bash
aqt analyze --exclude "**/*.test.js" --exclude "node_modules/**"
```

### Different Fix Strategies
```bash
# Only rule-based fixes
aqt fix --strategy rule-only

# Only AI-based fixes
aqt fix --strategy ai-only

# Combined approach (default)
aqt fix --strategy three-tier
```

### Verbose Debugging
```bash
AQT_VERBOSE=true aqt analyze --verbose
```

## All Commands

```bash
aqt analyze [files...]      # Analyze code
aqt fix [files...]          # Apply fixes
aqt review [files...]       # Code review
aqt report                  # Generate report
aqt config [get|set]        # Manage config
aqt health                  # Check health
aqt help                    # Show help
```

## Common Options

```bash
--verbose, -v              # Verbose output
--json, --machine          # JSON output
--dry-run                  # Preview without applying
--format <fmt>             # Report format (json|md|sarif)
--exclude <pattern>        # Exclude files
--project-root <path>      # Set project root
--strategy <str>           # Fix strategy
--linters <list>           # Enable specific linters
```

## Need Help?

```bash
# General help
aqt help

# Detailed documentation
# See: docs/interfaces/CLI.md

# Check system
aqt health

# Debug configuration
aqt config
AQT_VERBOSE=true aqt analyze
```

## Examples

See `examples/cli-usage.js` for more examples:
```bash
node examples/cli-usage.js
```

---

**Ready to use?** Start with:
```bash
aqt analyze
aqt fix --dry-run
aqt report --format md
```
