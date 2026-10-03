# Fixers Module

## Overview

The `src/fixers` module provides the auto-fix engine and various fixer implementations for automatically correcting code issues detected by the quality tool.

## Contents

| File | Description |
|------|-------------|
| `auto-fix-engine.js` | Main engine coordinating fix strategies |
| `rule-based-fixer.js` | Applies rule-based fixes using templates |
| `ai-fixer.js` | Uses AI to generate fixes for complex issues |
| `csharp-fixer.js` | C#-specific pattern fixes |

## Architecture

```
                    ┌─────────────────────────┐
                    │     AutoFixEngine       │
                    │  ┌───────────────────┐  │
                    │  │ Strategy Selector │  │
                    │  └─────────┬─────────┘  │
                    └────────────┼────────────┘
                                 │
           ┌─────────────────────┼─────────────────────┐
           │                     │                     │
           ▼                     ▼                     ▼
    ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
    │RuleBasedFixer│     │   AIFixer    │     │ CSharpFixer  │
    │              │     │              │     │              │
    │ - Templates  │     │ - Cloud AI   │     │ - Patterns   │
    │ - Patterns   │     │ - Local AI   │     │ - Rewriters  │
    └──────────────┘     └──────────────┘     └──────────────┘
```

## Key Components

### AutoFixEngine

Coordinates fix strategies and applies appropriate fixers:

```javascript
const { AutoFixEngine } = require('./fixers/auto-fix-engine');

const engine = new AutoFixEngine({
  projectRoot: process.cwd(),
  strategies: ['rule-based', 'ai'],
  createBackups: true,
  maxIterations: 5
});

// Check if issue can be fixed
if (engine.canFixByRule(issue)) {
  // Apply rule-based fix
  const result = await engine.fix(issue, content);
}

// Check if AI is needed
if (engine.requiresAI(issue)) {
  // Use AI fixer
  const result = await engine.fixWithAI(issue, content);
}
```

### RuleBasedFixer

Applies predefined fix patterns:

```javascript
const { RuleBasedFixer } = require('./fixers/rule-based-fixer');

const fixer = new RuleBasedFixer({
  rulesDir: './rules',
  createBackups: true
});

// Create backup before fixing
const backupPath = await fixer.createBackup(filePath);

try {
  const result = await fixer.apply(issue, content);
} catch (error) {
  // Restore from backup on failure
  await fixer.restoreBackup(filePath, backupPath);
}
```

**Supported Rule Types:**
- String replacements
- Regex patterns
- AST transformations
- Template-based fixes

### AIFixer

Generates fixes using AI models:

```javascript
const { AIFixer } = require('./fixers/ai-fixer');

const fixer = new AIFixer({
  provider: 'openai',
  model: 'gpt-4',
  cacheDir: '.aqt-cache',
  cacheEnabled: true
});

// Check cache for previous fix
const cacheKey = fixer.getCacheKey(code, issue);
let fix = fixer.getCachedFix(cacheKey);

if (!fix) {
  fix = await fixer.generateFix(issue, content);
  fixer.saveCachedFix(cacheKey, fix);
}
```

**Features:**
- Fix caching for repeated issues
- Multiple AI provider support
- Context-aware fix generation

### CSharpPatternFixer

C#-specific pattern fixes:

```javascript
const { CSharpPatternFixer } = require('./fixers/csharp-fixer');

const fixer = new CSharpPatternFixer({
  createBackups: true
});

// Get available patterns
const patterns = fixer.getPatterns();
// Returns list of fixable C# patterns

// Apply fix
const result = await fixer.apply(issue, content);
```

**C# Patterns:**
- Using statement organization
- Variable naming conventions
- Code style fixes
- Common ReSharper/Rider suggestions

## Fix Strategy Selection

The engine selects the appropriate strategy based on:

1. **Rule-based**: Known patterns, template-based fixes
2. **AI-powered**: Complex issues, context-dependent fixes
3. **Language-specific**: Language-specific patterns

```javascript
// Determine strategy
if (engine.canFixByRule(issue)) {
  // Use rule-based fixer
} else if (issue.language === 'csharp' && csharpFixer.canFix(issue)) {
  // Use C# fixer
} else if (engine.requiresAI(issue)) {
  // Use AI fixer
} else {
  // Issue cannot be auto-fixed
}
```

## Configuration

### AutoFixEngine Config

```javascript
{
  projectRoot: string,       // Project root directory
  strategies: string[],      // Enabled strategies ['rule-based', 'ai']
  createBackups: boolean,    // Create backups before fixing
  maxIterations: number,     // Maximum fix iterations
  aiConfig: object          // AI provider configuration
}
```

### AIFixer Config

```javascript
{
  provider: string,          // 'openai' | 'anthropic' | 'local'
  model: string,            // Model identifier
  cacheDir: string,         // Cache directory path
  cacheEnabled: boolean,    // Enable/disable caching
  maxTokens: number         // Maximum response tokens
}
```

## Usage Examples

### Batch Fixing

```javascript
const engine = new AutoFixEngine();

for (const issue of issues) {
  const content = fs.readFileSync(issue.file, 'utf8');
  const result = await engine.fix(issue, content);
  
  if (result.fixed) {
    fs.writeFileSync(issue.file, result.content);
  }
}
```

### Fix with Approval

```javascript
const engine = new AutoFixEngine({ dryRun: true });

const preview = await engine.fix(issue, content);

// Show preview to user
console.log('Proposed fix:', preview.diff);

// After approval
const finalResult = await engine.fix(issue, content, { apply: true });
```

## Dependencies

- AI provider SDKs
- File system for backups
- Cache storage
- AST parsers
