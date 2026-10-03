# Quick Start Guide

Get started with the Advanced Quality Tool in 5 minutes!

## Installation

```bash
cd tools/advanced-quality-tool
npm install
```

## Step 1: Check Available Linters

First, see which linters are installed in your project:

```bash
node cli.js detect
```

Expected output:
```
✅ eslint               Available
✅ prettier             Available
✅ stylelint            Available
❌ tslint               Not installed
✅ typescript           Available
```

If no linters are available, install them:

```bash
# Go to your project root
cd ../..

# Install linters
npm install --save-dev eslint @typescript-eslint/eslint-plugin @typescript-eslint/parser
npm install --save-dev prettier
npm install --save-dev stylelint
```

## Step 2: Run Analysis

Run a full code analysis:

```bash
node cli.js analyze
```

This will:
- Run all available linters
- Collect all issues
- Generate reports in `.aqt-results/`
- Show summary statistics

Output includes:
- Issues by linter
- Issues by severity
- Issues by category
- Issues by file type
- Top 5 issues

## Step 3: Categorize Issues

See categorized and filtered issues:

```bash
node cli.js categorize
```

This shows:
1. High priority issues (CRITICAL + ERROR)
2. Security issues
3. Auto-fixable issues
4. TypeScript/Angular issues
5. Issues in specific directories
6. Recommended fixes

## Understanding the Output

### Severity Levels

- 🔴 **CRITICAL** - Security vulnerabilities, must fix immediately
- 🟠 **ERROR** - Code that will break or cause runtime errors
- 🟡 **WARNING** - Code smells or potential bugs
- 🔵 **INFO** - Style or convention violations
- ⚪ **SUGGESTION** - Improvement opportunities

### Categories

- 🔒 **SECURITY** - Security vulnerabilities
- ⚡ **PERFORMANCE** - Performance issues
- ♿ **ACCESSIBILITY** - A11y violations
- 🐛 **BUG** - Likely bugs
- 🧪 **RELIABILITY** - Reliability issues
- 📐 **MAINTAINABILITY** - Hard to maintain code
- 🎨 **STYLE** - Code style issues
- 📚 **DOCUMENTATION** - Missing/bad docs

### Auto-Fix Levels

- **AUTO** - Can be fixed automatically (99% safe)
- **RULE** - Pattern-based fix (95% safe)
- **AI** - AI-generated fix (70% safe, needs review)
- **MANUAL** - Requires human judgment

## View Reports

After running analysis, check the generated reports:

```bash
# HTML report (open in browser)
open .aqt-results/report.html

# Markdown report
cat .aqt-results/report.md

# JSON data (for programmatic use)
cat .aqt-results/analysis-results.json
```

## Next Steps

### Coming in Phase 1

- **Auto-fix**: `node cli.js fix --auto`
- **Watch mode**: `node cli.js watch`
- **Chat UI**: `node cli.js ui`

### Configuration

Create `.aqt/config.json` to customize:

```json
{
  "linters": ["eslint", "prettier"],
  "severityThreshold": "WARNING",
  "autoFix": {
    "enabled": true,
    "levels": ["AUTO", "RULE"]
  },
  "exclude": [
    "node_modules/**",
    "dist/**"
  ]
}
```

### Programmatic Usage

Use the tool in your own scripts:

```javascript
const { LinterOrchestrator } = require('./src/integrations/linter-cli');
const { IssueCategorizationEngine } = require('./src/core/issue-categorizer');

async function analyze() {
  const orchestrator = new LinterOrchestrator(process.cwd());
  const result = await orchestrator.runAll();

  const engine = new IssueCategorizationEngine();
  const categorized = engine.categorizeAll(result.issues);

  return categorized;
}
```

## Troubleshooting

### No linters found

Install at least one linter:
```bash
npm install --save-dev eslint
```

### Permission denied

Make CLI executable:
```bash
chmod +x cli.js
```

### Module not found

Install dependencies:
```bash
npm install
```

## Documentation

- **Feasibility Analysis**: `docs/FEASIBILITY.md`
- **Issue Taxonomy**: `docs/ISSUE_TAXONOMY.md`
- **Examples**: `examples/` directory

## Support

For issues or questions:
1. Check the documentation in `docs/`
2. Review examples in `examples/`
3. Check the existing code-analyzer tool

---

**Current Version**: 0.4.0 (Phase 0 Complete)  
**Status**: Ready for Phase 1 development
