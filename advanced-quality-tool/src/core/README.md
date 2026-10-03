# Core Module

## Overview

The `src/core` module provides the foundational architecture for Advanced Quality Tool. It defines the core interfaces, issue categorization, and shared services used throughout the application.

## Contents

| File | Description |
|------|-------------|
| `interface-adapter.js` | Adapter pattern for interface implementations |
| `issue-categorizer.js` | Categorizes issues by type, severity, and file |
| `issue-categorizer.example.js` | Usage examples for the issue categorizer |
| `shared-app-services.js` | Shared application services and utilities |

## Key Components

### InterfaceAdapter

Implements the adapter pattern for pluggable interface implementations:

```javascript
const { InterfaceAdapter } = require('./core/interface-adapter');

const adapter = new InterfaceAdapter({
  inputFormat: 'eslint',
  outputFormat: 'aqt'
});

await adapter.start();

// Translate input to internal format
const translated = adapter._translateInput(rawInput);

await adapter.stop();
```

**Features:**
- Format translation between different linter outputs
- Lifecycle management (start/stop)
- Configurable translation rules

### IssueCategorizationEngine

Categorizes issues for prioritization and filtering:

```javascript
const { IssueCategorizationEngine } = require('./core/issue-categorizer');

const categorizer = new IssueCategorizationEngine({
  projectRoot: process.cwd()
});

// Categorize a single issue
const category = categorizer.categorize(issue);
// Returns: { type, severity, fileType, priority, tags }

// Categorize multiple issues
const categorized = categorizer.categorizeAll(issues);
```

**Category Types:**
- `syntax` - Syntax errors
- `style` - Code style issues
- `complexity` - Code complexity issues
- `security` - Security vulnerabilities
- `performance` - Performance issues
- `best-practice` - Best practice violations

**File Type Detection:**
```javascript
const fileType = categorizer.detectFileType('src/component.tsx');
// Returns: 'typescript-react'
```

### SharedAppServices

Provides shared utilities and services:

```javascript
const { SharedAppServices, ok, fail } = require('./core/shared-app-services');

const services = new SharedAppServices({
  projectRoot: process.cwd()
});

// Response helpers
const successResponse = ok(data, 'operation-id');
const errorResponse = fail('Error message', 'ERR_CODE', 'operation-id');
```

**Utilities:**
- `tryRequire(mod)` - Safe module requiring with fallbacks
- `ok(data, operationId)` - Success response helper
- `fail(error, errorCode, operationId, extra)` - Error response helper

## Architecture Patterns

### Adapter Pattern

The `InterfaceAdapter` implements the adapter pattern to:

1. Accept input from various linters (ESLint, Pylint, etc.)
2. Normalize to internal format
3. Translate to output format as needed

```
ESLint JSON ──┐
               │    ┌─────────────────┐    ┌──────────────┐
Pylint JSON ──┼───▶│ InterfaceAdapter │───▶│ AQT Internal │
               │    └─────────────────┘    └──────────────┘
TSLint JSON ──┘
```

### Categorization Flow

```
Raw Issue ──▶ IssueCategorizationEngine ──▶ Categorized Issue
                    │
                    ├── Type Detection
                    ├── Severity Mapping
                    ├── File Type Detection
                    └── Priority Calculation
```

## Usage Examples

### Basic Categorization

```javascript
const categorizer = new IssueCategorizationEngine();

const issue = {
  file: 'src/app.js',
  line: 42,
  rule: 'no-unused-vars',
  message: 'Variable x is declared but never used',
  severity: 'warning'
};

const result = categorizer.categorize(issue);
// {
//   type: 'style',
//   severity: 'warning',
//   fileType: 'javascript',
//   priority: 'medium',
//   tags: ['unused', 'variable']
// }
```

### Batch Categorization

```javascript
const issues = [
  { file: 'src/a.js', rule: 'semi', severity: 'error' },
  { file: 'src/b.ts', rule: '@typescript-eslint/no-explicit-any', severity: 'warning' },
  { file: 'src/c.py', rule: 'E501', severity: 'info' }
];

const results = categorizer.categorizeAll(issues);
```

### Filtering by Category

```javascript
const allIssues = categorizer.categorizeAll(rawIssues);

// Filter by severity
const errors = allIssues.filter(i => i.severity === 'error');

// Filter by type
const securityIssues = allIssues.filter(i => i.type === 'security');

// Filter by file type
const tsFiles = allIssues.filter(i => i.fileType.startsWith('typescript'));
```

## Configuration

### InterfaceAdapter Config

```javascript
{
  inputFormat: string,    // 'eslint' | 'pylint' | 'aqt'
  outputFormat: string,   // 'aqt' | 'json' | 'junit'
  translators: Map        // Custom translators
}
```

### IssueCategorizationEngine Config

```javascript
{
  projectRoot: string,        // Project root for relative paths
  customRules: object,        // Custom categorization rules
  severityMap: object         // Custom severity mappings
}
```

## Dependencies

- File system access
- Path utilities
- No external dependencies
