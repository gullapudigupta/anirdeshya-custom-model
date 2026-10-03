# Quality Module

## Overview

The `src/quality` module provides code quality detectors that identify code smells, anti-patterns, accessibility issues, and documentation quality problems.

## Contents

| File | Description |
|------|-------------|
| `code-smell-detector.js` | Detects common code smells |
| `anti-pattern-detector.js` | Identifies anti-patterns in code |
| `accessibility-checker.js` | Checks for accessibility issues |
| `doc-quality-checker.js` | Validates documentation quality |
| `duplicate-detector.js` | Finds duplicated code blocks |

## Key Components

### CodeSmellDetector

Detects common code smells:

```javascript
const { CodeSmellDetector } = require('./quality/code-smell-detector');

const detector = new CodeSmellDetector({
  projectRoot: process.cwd()
});

const smells = detector.analyze('src/app.js', content);
```

**Detected Code Smells:**

| Smell | Description |
|-------|-------------|
| Long Method | Methods exceeding line threshold |
| Long Parameter List | Functions with too many parameters |
| Large Class | Classes with too many lines/methods |
| Feature Envy | Methods using other class more than own |
| Data Clumps | Same data grouped in multiple places |
| Primitive Obsession | Overuse of primitive types |

### AntiPatternDetector

Identifies anti-patterns:

```javascript
const { AntiPatternDetector } = require('./quality/anti-pattern-detector');

const detector = new AntiPatternDetector();
const patterns = detector.analyze('src/service.js', content);
```

**Detected Anti-Patterns:**

| Pattern | Description |
|---------|-------------|
| God Object | Classes doing too much |
| Spaghetti Code | Tangled control flow |
| Copy-Paste Code | Duplicated logic |
| Magic Numbers | Unexplained numeric literals |
| Hardcoded Values | Embedded configuration |
| Singleton Overuse | Excessive singleton usage |

### AccessibilityChecker

Checks HTML/JSX for accessibility issues:

```javascript
const { AccessibilityChecker } = require('./quality/accessibility-checker');

const checker = new AccessibilityChecker({
  wcagLevel: 'AA'
});

const issues = checker.analyze('src/components/Button.jsx', content);
```

**Checked Accessibility Rules:**

| Rule | WCAG | Description |
|------|------|-------------|
| img-alt | 1.1.1 | Images need alt text |
| label-required | 1.3.1 | Form inputs need labels |
| button-name | 4.1.2 | Buttons need accessible names |
| color-contrast | 1.4.3 | Sufficient color contrast |
| link-name | 2.4.4 | Links need discernible text |
| document-lang | 3.1.1 | HTML needs lang attribute |

### DocQualityChecker

Validates documentation quality:

```javascript
const { DocQualityChecker } = require('./quality/doc-quality-checker');

const checker = new DocQualityChecker();
const issues = checker.analyze('src/utils.js', content);
```

**Checked Documentation Rules:**

| Rule | Description |
|------|-------------|
| missing-jsdoc | Missing JSDoc on public functions |
| incomplete-params | Undocumented parameters |
| missing-returns | Missing @returns documentation |
| stale-docs | Documentation doesn't match code |
| broken-links | Broken documentation links |

### DuplicateDetector

Finds duplicated code blocks:

```javascript
const { DuplicateDetector } = require('./quality/duplicate-detector');

const detector = new DuplicateDetector({
  minLines: 5,
  minTokens: 50
});

const duplicates = await detector.analyzeFile('src/helpers.js');
```

## Usage Examples

### Comprehensive Quality Check

```javascript
const smellDetector = new CodeSmellDetector();
const antiPatternDetector = new AntiPatternDetector();
const a11yChecker = new AccessibilityChecker();
const docChecker = new DocQualityChecker();

function analyzeQuality(file, content) {
  return [
    ...smellDetector.analyze(file, content),
    ...antiPatternDetector.analyze(file, content),
    ...a11yChecker.analyze(file, content),
    ...docChecker.analyze(file, content)
  ];
}
```

### Get Statistics

```javascript
const detector = new CodeSmellDetector();
detector.analyze('src/app.js', content);

const stats = detector.getStats();
// {
//   filesAnalyzed: 1,
//   issuesFound: 5,
//   byType: { 'long-method': 2, 'god-object': 1, ... }
// }
```

### Project-Wide Analysis

```javascript
const detector = new CodeSmellDetector();

const files = glob.sync('src/**/*.{js,jsx,ts,tsx}');
const allIssues = [];

for (const file of files) {
  const content = fs.readFileSync(file, 'utf8');
  const issues = detector.analyze(file, content);
  allIssues.push(...issues);
}

console.log(`Found ${allIssues.length} quality issues`);
```

## Configuration

### CodeSmellDetector

```javascript
{
  maxMethodLines: 30,        // Max lines before "Long Method"
  maxParams: 4,              // Max parameters before warning
  maxClassLines: 500,        // Max lines in a class
  maxClassMethods: 20        // Max methods in a class
}
```

### AccessibilityChecker

```javascript
{
  wcagLevel: 'AA',           // 'A', 'AA', or 'AAA'
  checkColorContrast: true,
  checkExternalLinks: false
}
```

### DuplicateDetector

```javascript
{
  minLines: 5,               // Minimum lines to consider
  minTokens: 50,             // Minimum tokens for match
  ignoreWhitespace: true     // Ignore whitespace differences
}
```

## Dependencies

- AST parser
- HTML parser (for accessibility)
- File system access
