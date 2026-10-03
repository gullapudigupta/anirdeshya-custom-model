# Performance Module

## Overview

The `src/performance` module detects performance issues and anti-patterns in code. It analyzes code for common performance pitfalls and provides optimization suggestions.

## Contents

| File | Description |
|------|-------------|
| `performance-detector.js` | Detects performance issues and anti-patterns |

## Key Components

### PerformanceDetector

Analyzes code for performance issues:

```javascript
const { PerformanceDetector } = require('./performance/performance-detector');

const detector = new PerformanceDetector({
  projectRoot: process.cwd(),
  severity: 'warning'
});

const issues = await detector.analyzeFile('src/app.js');
```

## Detected Patterns

### Algorithmic Issues

| Pattern | Description |
|---------|-------------|
| O(n²) loops | Nested loops over same collection |
| String concatenation in loops | Inefficient string building |
| Unnecessary recursion | Recursive calls that could be iterative |

### Memory Issues

| Pattern | Description |
|---------|-------------|
| Memory leaks | Unclosed resources, event listeners |
| Large allocations | Allocating large objects in loops |
| Caching issues | Missing or inefficient caching |

### I/O Issues

| Pattern | Description |
|---------|-------------|
| Synchronous I/O | Blocking file/network operations |
| Multiple file reads | Reading same file multiple times |
| Unbuffered streams | Processing streams inefficiently |

### Database Issues

| Pattern | Description |
|---------|-------------|
| N+1 queries | Queries inside loops |
| Missing indexes | Unindexed queries |
| Unbounded results | Queries without LIMIT |

### Network Issues

| Pattern | Description |
|---------|-------------|
| Blocking requests | Synchronous HTTP calls |
| Missing timeouts | Requests without timeout |
| Sequential requests | Requests that could be parallel |

## Usage Examples

### Analyze Single File

```javascript
const issues = await detector.analyzeFile('src/api.js');

for (const issue of issues) {
  console.log(`${issue.file}:${issue.line} - ${issue.message}`);
  console.log(`  Suggestion: ${issue.suggestion}`);
}
```

### Project-Wide Analysis

```javascript
const glob = require('glob');
const files = glob.sync('src/**/*.js');

const allIssues = [];
for (const file of files) {
  const issues = await detector.analyzeFile(file);
  allIssues.push(...issues);
}

console.log(`Found ${allIssues.length} performance issues`);
```

### Custom Patterns

```javascript
const detector = new PerformanceDetector({
  customPatterns: [
    {
      id: 'heavy-computation',
      pattern: /while\s*\(.*\)\s*{[\s\S]*?calculate/g,
      message: 'Consider memoizing heavy computation in loop',
      severity: 'warning'
    }
  ]
});
```

## Configuration

```javascript
{
  projectRoot: string,          // Project root directory
  severity: string,             // Default severity for findings
  customPatterns: object[],     // Additional patterns to detect
  excludePatterns: string[],    // Files to exclude
  maxFileSize: number           // Maximum file size to analyze
}
```

## Output Format

```javascript
{
  file: 'src/app.js',
  line: 42,
  column: 10,
  rule: 'sync-io',
  message: 'Synchronous file read detected',
  severity: 'warning',
  suggestion: 'Use fs.promises.readFile() instead',
  documentation: 'https://nodejs.org/api/fs.html#fs_promises_api'
}
```

## Best Practices

- Run on CI to catch performance regressions
- Focus on hot paths first
- Profile before optimizing
- Consider trade-offs (memory vs CPU)

## Dependencies

- AST parser
- File system access
