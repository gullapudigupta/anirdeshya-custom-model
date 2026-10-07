# Metrics Module

## Overview

The `src/metrics` module provides code metrics calculation including complexity analysis, maintainability indices, and other quantitative measures of code quality.

## Contents

| File | Description |
|------|-------------|
| `complexity-calculator.js` | Calculates various code complexity metrics |
| `usage-analytics.js` | Stores opt-in local command usage aggregates |

## Key Components

### ComplexityCalculator

Calculates complexity metrics for source files:

```javascript
const { ComplexityCalculator } = require('./metrics/complexity-calculator');

const calculator = new ComplexityCalculator({
  projectRoot: process.cwd(),
  maxFileComplexity: 25
});

const metrics = await calculator.analyzeFile('src/example.js');
```

**Output:**
```javascript
{
  file: 'src/example.js',
  cyclomaticComplexity: 12,
  cognitiveComplexity: 8,
  linesOfCode: 150,
  maintainabilityIndex: 72,
  nestingDepth: 4,
  functionCount: 8,
  averageFunctionLength: 18,
  commentRatio: 0.15
}
```

## Supported Metrics

### Cyclomatic Complexity

Measures the number of linearly independent paths through code:

```javascript
// Complexity = 1 (base)
function simple() {
  return true;
}

// Complexity = 3 (base + 2 branches)
function complex(x, y) {
  if (x > 0) {        // +1
    return x;
  } else if (y > 0) { // +1
    return y;
  }
  return 0;
}
```

### Cognitive Complexity

Measures how difficult code is to understand:

- Accounts for nesting
- Penalizes mixed constructs
- More intuitive than cyclomatic

### Maintainability Index

Composite metric (0-100):

- Higher = more maintainable
- Based on Halstead volume, cyclomatic complexity, and LOC

### Lines of Code Metrics

- **LOC**: Total lines
- **SLOC**: Source lines (excluding comments/blank)
- **Comment Lines**: Lines with comments

## Usage Examples

### Single File Analysis

```javascript
const metrics = await calculator.analyzeFile('src/utils.js');

console.log(`Cyclomatic: ${metrics.cyclomaticComplexity}`);
console.log(`Cognitive: ${metrics.cognitiveComplexity}`);
console.log(`Maintainability: ${metrics.maintainabilityIndex}`);
```

### Project-Wide Analysis

```javascript
const glob = require('glob');
const files = glob.sync('src/**/*.js');

const results = [];
for (const file of files) {
  results.push(await calculator.analyzeFile(file));
}

const summary = {
  totalFiles: results.length,
  avgComplexity: avg(results.map(r => r.cyclomaticComplexity)),
  highComplexityFiles: results.filter(r => r.cyclomaticComplexity > 25)
};
```

### Threshold Checking

```javascript
const THRESHOLDS = {
  cyclomaticComplexity: { warn: 15, error: 25 },
  cognitiveComplexity: { warn: 20, error: 30 },
  nestingDepth: { warn: 4, error: 6 }
};

const issues = [];

for (const [metric, limits] of Object.entries(THRESHOLDS)) {
  if (metrics[metric] > limits.error) {
    issues.push({ metric, severity: 'error', value: metrics[metric] });
  } else if (metrics[metric] > limits.warn) {
    issues.push({ metric, severity: 'warning', value: metrics[metric] });
  }
}
```

## Configuration

```javascript
{
  projectRoot: string,          // Project root directory
  maxFileComplexity: number,    // Threshold for high complexity warning
  excludePatterns: string[],    // Files to exclude
  includeComments: boolean      // Include comments in analysis
}
```

## Supported Languages

- JavaScript
- TypeScript
- Python (partial)
- C# (partial)

## Dependencies

- AST parser (acorn, babel, etc.)
- File system access

## Local Usage Analytics

`UsageAnalytics` is disabled by default and never sends data over the network.
Enable it with `aqt analytics enable`; it records only normalized command names,
success/failure counts, and elapsed milliseconds in `.aqt/usage-metrics.json`.
It does not collect source code, prompts, file paths, or credentials.

```javascript
const { UsageAnalytics } = require('./metrics/usage-analytics');
const analytics = new UsageAnalytics({ workspace: process.cwd() });
analytics.record('analyze', { success: true, durationMs: 125 });
console.log(analytics.report(30));
```
