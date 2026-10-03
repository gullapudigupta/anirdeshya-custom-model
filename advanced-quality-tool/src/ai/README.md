# AI Module

## Overview

The `src/ai` module provides AI-powered capabilities for code analysis, fix generation, and intelligent code review. It contains the core AI engines that power Advanced Quality Tool's automated code improvement features.

## Contents

| File | Description |
|------|-------------|
| `code-review-assistant.js` | AI-powered code review with contextual suggestions |
| `architectural-refactoring-engine.js` | Analyzes code architecture and suggests refactoring opportunities |
| `business-logic-workflow.js` | Manages business logic changes with change request tracking |
| `algorithm-framework.js` | Framework for defining and generating algorithm implementations |
| `compiler-fix-engine.js` | Automatically fixes compiler errors using AI assistance |
| `context-solution-generator.js` | Generates solutions based on code context analysis |
| `explainable-review.js` | Provides explainable AI code review with reasoning |
| `fix-generation-v2.js` | Advanced fix generation with approval workflow |
| `model-requirement-disclosure.js` | Discloses AI model requirements for capabilities |
| `security-perf-remediation.js` | Security and performance issue remediation |

## Key Components

### AICodeReviewAssistant

Performs automated code reviews with contextual suggestions:

```javascript
const { AICodeReviewAssistant } = require('./ai/code-review-assistant');

const assistant = new AICodeReviewAssistant({
  projectRoot: process.cwd(),
  modelProvider: 'openai'
});

const review = await assistant.reviewFile('src/example.js', {
  checkSecurity: true,
  checkPerformance: true
});
```

### CompilerFixEngine

Automatically diagnoses and fixes compiler errors:

```javascript
const { CompilerFixEngine } = require('./ai/compiler-fix-engine');

const engine = new CompilerFixEngine({
  maxIterations: 5,
  language: 'javascript'
});

const result = await engine.runFixLoop('src/file.js', 'javascript');
```

### ArchitecturalRefactoringEngine

Analyzes project architecture and identifies refactoring opportunities:

```javascript
const { ArchitecturalRefactoringEngine } = require('./ai/architectural-refactoring-engine');

const engine = new ArchitecturalRefactoringEngine({
  projectRoot: process.cwd()
});

const graph = engine.buildGraph('./src');
```

### FixGenerationV2

Generates code fixes with approval workflow:

```javascript
const { FixGenerationV2 } = require('./ai/fix-generation-v2');

const generator = new FixGenerationV2({
  cacheDir: '.aqt-cache'
});

const fix = await generator.generateFix(issue, content, fixFn);
await generator.approveFix(fix.id, 'reviewer-name');
```

### SecurityPerfRemediation

Handles security and performance issue remediation:

```javascript
const { SecurityPerfRemediation } = require('./ai/security-perf-remediation');

const remediation = new SecurityPerfRemediation();

const taintFlows = remediation.analyzeTaintFlows(filePath, content);
const cvePatterns = remediation.scanForCVEPatterns(filePath, content);
```

## Configuration

The AI module supports various configuration options:

```javascript
{
  projectRoot: string,        // Project root directory
  modelProvider: string,      // AI provider (openai, anthropic, etc.)
  cacheDir: string,           // Cache directory for results
  maxIterations: number,      // Maximum fix iterations
  enableCaching: boolean      // Enable result caching
}
```

## Dependencies

- Model providers (OpenAI, Anthropic, etc.)
- AST parsers (for code analysis)
- File system access
- Cache system

## Usage Patterns

### Code Review Flow

1. Initialize `AICodeReviewAssistant`
2. Call `reviewFile()` with target file
3. Process review findings
4. Apply suggested changes

### Fix Generation Flow

1. Create `FixGenerationV2` instance
2. Generate fix with `generateFix()`
3. Review and approve with `approveFix()`
4. Apply fix with `applyFix()`

## Best Practices

- Enable caching for repeated analyses
- Use appropriate model providers for task complexity
- Review AI-generated suggestions before applying
- Set reasonable iteration limits for fix loops
