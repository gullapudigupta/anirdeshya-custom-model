# Issue Taxonomy & Classification System

**Version:** 1.0  
**Date:** 2024  
**Purpose:** Comprehensive categorization system for code quality issues

---

## Overview

This document defines the taxonomy (classification system) for all code quality issues detected by the tool. Issues are categorized across multiple dimensions to enable precise filtering, prioritization, and automated fixing.

---

## 1. Classification Dimensions

Every issue is classified by:
1. **File Type** - What kind of file (JS, TS, CSS, etc.)
2. **Severity** - How serious is the issue
3. **Category** - What domain (security, performance, etc.)
4. **Type** - Specific issue type within category
5. **Auto-Fix Level** - Can it be automatically fixed?
6. **Standard/Rule** - Which standard/tool flagged it

---

## 2. File Type Classification

### 2.1 Supported File Types

| File Type | Extensions | Parser | Priority |
|-----------|------------|--------|----------|
| **JavaScript** | `.js`, `.jsx`, `.mjs`, `.cjs` | @babel/parser | HIGH |
| **TypeScript** | `.ts`, `.tsx` | @typescript-eslint/parser | HIGH |
| **CSS** | `.css` | postcss | MEDIUM |
| **SCSS/Sass** | `.scss`, `.sass` | postcss + scss | MEDIUM |
| **Less** | `.less` | postcss + less | LOW |
| **HTML** | `.html` | htmlparser2 | MEDIUM |
| **Angular Templates** | `.html` (with Angular directives) | @angular-eslint/template-parser | HIGH |
| **Vue Templates** | `.vue` | vue-eslint-parser | MEDIUM |
| **JSON** | `.json`, `.jsonc` | JSON.parse | LOW |
| **YAML** | `.yml`, `.yaml` | yaml | LOW |
| **Markdown** | `.md` | remark | LOW |
| **C#** *(Phase 2)* | `.cs` | Roslyn | HIGH |

### 2.2 File Type Detection

```javascript
function detectFileType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const map = {
    '.js': 'javascript',
    '.jsx': 'javascript',
    '.mjs': 'javascript',
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.css': 'css',
    '.scss': 'scss',
    '.sass': 'scss',
    '.less': 'less',
    '.html': detectHTMLType(filePath), // 'html' or 'angular-template'
    '.vue': 'vue',
    '.json': 'json',
    '.md': 'markdown',
    '.cs': 'csharp'
  };
  return map[ext] || 'unknown';
}
```

---

## 3. Severity Levels

### 3.1 Severity Definitions

| Level | Code | Description | Action Required | Examples |
|-------|------|-------------|-----------------|----------|
| **CRITICAL** | 🔴 | Security vulnerability or data loss risk | **FIX IMMEDIATELY** | SQL injection, XSS, hardcoded secrets |
| **ERROR** | 🟠 | Code that will break or cause runtime errors | **FIX BEFORE RELEASE** | Undefined variable, syntax error, null pointer |
| **WARNING** | 🟡 | Code smell or potential bug | **FIX SOON** | Unused variable, missing await, complexity |
| **INFO** | 🔵 | Style or convention violation | **FIX EVENTUALLY** | Missing semicolon, inconsistent naming |
| **SUGGESTION** | ⚪ | Improvement opportunity | **OPTIONAL** | Could use newer syntax, performance tip |

### 3.2 Severity Scoring

**Base Score Formula:**
```
Score = (Impact × 10) + (Likelihood × 5) + (Remediation × 3)
```

Where:
- **Impact:** 1-10 (1=cosmetic, 10=critical system failure)
- **Likelihood:** 1-10 (1=almost never, 10=always happens)
- **Remediation:** 1-10 (1=trivial fix, 10=major refactor)

**Severity Mapping:**
- 0-30: SUGGESTION
- 31-50: INFO
- 51-70: WARNING
- 71-90: ERROR
- 91-100: CRITICAL

### 3.3 Severity Override Rules

Certain issue types override calculated severity:
- **Any security issue** → Minimum WARNING (usually CRITICAL)
- **Syntax errors** → Always ERROR
- **Accessibility violations** → Minimum WARNING
- **OWASP Top 10** → Always CRITICAL
- **Breaking changes in dependencies** → ERROR

---

## 4. Category Classification

### 4.1 Primary Categories

| Category | Description | Weight | Examples |
|----------|-------------|--------|----------|
| **🔒 SECURITY** | Security vulnerabilities | 10 | XSS, SQL injection, auth bypass |
| **⚡ PERFORMANCE** | Performance issues | 8 | Memory leak, O(n²) complexity, blocking I/O |
| **♿ ACCESSIBILITY** | A11y violations | 7 | Missing alt text, no aria-label |
| **🐛 BUG** | Likely bugs | 9 | Null pointer, off-by-one, race condition |
| **🧪 RELIABILITY** | Reliability issues | 8 | Uncaught exception, unhandled promise |
| **📐 MAINTAINABILITY** | Hard to maintain code | 5 | High complexity, god class, duplication |
| **🎨 STYLE** | Code style issues | 2 | Formatting, naming conventions |
| **📚 DOCUMENTATION** | Missing/bad docs | 3 | Missing JSDoc, outdated comments |
| **🏗️ ARCHITECTURE** | Architecture violations | 6 | Circular deps, layer violation |
| **✅ BEST_PRACTICE** | Framework best practices | 6 | React hooks, Angular patterns |

### 4.2 Category Hierarchies

Some categories have sub-categories:

**SECURITY:**
- Injection (SQL, XSS, Command)
- Authentication/Authorization
- Sensitive Data Exposure
- Security Misconfiguration
- Cryptography

**PERFORMANCE:**
- Algorithmic Complexity
- Memory Management
- Network/I/O
- Rendering Performance
- Bundle Size

**ACCESSIBILITY:**
- Images & Media
- Forms & Inputs
- Navigation
- Screen Reader Support
- Color Contrast

---

## 5. Issue Type Catalog

### 5.1 JavaScript/TypeScript Issues

#### 5.1.1 Security Issues

| Type ID | Name | Severity | Description | Fix Level |
|---------|------|----------|-------------|-----------|
| **SEC-001** | Hardcoded Secret | CRITICAL | API keys, passwords in code | MANUAL |
| **SEC-002** | SQL Injection | CRITICAL | Unsanitized SQL queries | AI |
| **SEC-003** | XSS Vulnerability | CRITICAL | Unescaped user input in HTML | AI |
| **SEC-004** | Dangerous eval() | ERROR | Use of eval/Function | AI |
| **SEC-005** | Unsafe Regex | WARNING | ReDoS vulnerability | AI |
| **SEC-006** | Insecure Random | WARNING | Math.random() for security | AUTO |
| **SEC-007** | HTTP instead of HTTPS | WARNING | Non-encrypted connection | AUTO |
| **SEC-008** | localStorage for Sensitive Data | ERROR | PII in localStorage | AI |
| **SEC-009** | Disabled Security | CRITICAL | Content-Security-Policy disabled | AUTO |
| **SEC-010** | Path Traversal | CRITICAL | User-controlled file paths | AI |

**Example:**
```javascript
// SEC-001: Hardcoded Secret
const apiKey = "sk-1234567890abcdef"; // ❌ CRITICAL

// Fix: Use environment variable
const apiKey = process.env.API_KEY; // ✅
```

#### 5.1.2 Bug Risks

| Type ID | Name | Severity | Description | Fix Level |
|---------|------|----------|-------------|-----------|
| **BUG-001** | Unused Variable | INFO | Variable declared but never used | AUTO |
| **BUG-002** | Undefined Variable | ERROR | Variable used before declaration | MANUAL |
| **BUG-003** | Missing Await | ERROR | Promise not awaited | AUTO |
| **BUG-004** | Unreachable Code | WARNING | Code after return/throw | AUTO |
| **BUG-005** | Duplicate Key | ERROR | Duplicate object key | AUTO |
| **BUG-006** | Empty Catch Block | WARNING | Error swallowed | AI |
| **BUG-007** | Comparison Type Coercion | WARNING | == instead of === | AUTO |
| **BUG-008** | Reassigning const | ERROR | Attempt to modify const | MANUAL |
| **BUG-009** | Missing Return | ERROR | Function should return value | AI |
| **BUG-010** | Array Constructor Misuse | WARNING | new Array(10) ambiguity | AUTO |

#### 5.1.3 Performance Issues

| Type ID | Name | Severity | Description | Fix Level |
|---------|------|----------|-------------|-----------|
| **PERF-001** | N+1 Query | ERROR | Loop with async calls | AI |
| **PERF-002** | Memory Leak | CRITICAL | Event listener not removed | AI |
| **PERF-003** | Inefficient Algorithm | WARNING | O(n²) where O(n) possible | AI |
| **PERF-004** | Blocking Operation | WARNING | Sync I/O in main thread | AI |
| **PERF-005** | Missing Memoization | SUGGESTION | Recompute expensive values | AI |
| **PERF-006** | Large Bundle | WARNING | Import entire library | AUTO |
| **PERF-007** | Missing Lazy Load | INFO | Eager loading everything | AI |
| **PERF-008** | Repeated DOM Query | WARNING | querySelector in loop | AUTO |
| **PERF-009** | Missing Index | WARNING | Array.find instead of Map | AI |
| **PERF-010** | Synchronous Iteration | SUGGESTION | Use .map() instead of loop | AUTO |

#### 5.1.4 Code Smells

| Type ID | Name | Severity | Description | Fix Level |
|---------|------|----------|-------------|-----------|
| **SMELL-001** | Long Function | WARNING | Function > 30 lines | AI |
| **SMELL-002** | Long Parameter List | WARNING | > 5 parameters | AI |
| **SMELL-003** | Deep Nesting | WARNING | Nesting depth > 4 | AI |
| **SMELL-004** | Magic Number | INFO | Hardcoded number without context | AUTO |
| **SMELL-005** | Duplicate Code | WARNING | Copy-pasted code blocks | AI |
| **SMELL-006** | God Class | ERROR | Class > 300 lines | AI |
| **SMELL-007** | Feature Envy | WARNING | Method uses another class too much | AI |
| **SMELL-008** | Shotgun Surgery | WARNING | Change requires edits in many files | MANUAL |
| **SMELL-009** | Dead Code | INFO | Unused functions/classes | AUTO |
| **SMELL-010** | Complex Boolean | WARNING | Boolean expression > 3 conditions | AI |

#### 5.1.5 Style Issues

| Type ID | Name | Severity | Description | Fix Level |
|---------|------|----------|-------------|-----------|
| **STYLE-001** | Missing Semicolon | INFO | Missing semicolon (ASI) | AUTO |
| **STYLE-002** | Inconsistent Quotes | INFO | Mix of ' and " | AUTO |
| **STYLE-003** | Inconsistent Indent | INFO | Mix of tabs/spaces | AUTO |
| **STYLE-004** | Trailing Comma | INFO | Missing trailing comma | AUTO |
| **STYLE-005** | camelCase Violation | INFO | Wrong naming convention | AUTO |
| **STYLE-006** | Missing Blank Line | INFO | No space between blocks | AUTO |
| **STYLE-007** | Long Line | INFO | Line > 120 chars | AUTO |
| **STYLE-008** | Multi-statement Line | INFO | Multiple statements on one line | AUTO |
| **STYLE-009** | Console Statement | WARNING | console.log in production | AUTO |
| **STYLE-010** | TODO Comment | INFO | TODO/FIXME in code | MANUAL |

### 5.2 Angular-Specific Issues

| Type ID | Name | Severity | Description | Fix Level |
|---------|------|----------|-------------|-----------|
| **NG-001** | Missing OnDestroy | ERROR | No unsubscribe in ngOnDestroy | AI |
| **NG-002** | Default Change Detection | WARNING | Missing OnPush | AUTO |
| **NG-003** | Empty Lifecycle Hook | WARNING | Empty ngOnInit() | AUTO |
| **NG-004** | Injectable without Root | WARNING | Missing providedIn: 'root' | AUTO |
| **NG-005** | Missing trackBy | ERROR | ngFor without trackBy | AI |
| **NG-006** | Function in Template | ERROR | Function call in template | AI |
| **NG-007** | Too Many Dependencies | WARNING | > 5 constructor params | AI |
| **NG-008** | Direct DOM Manipulation | ERROR | Using document.querySelector | AI |
| **NG-009** | Missing Async Pipe | WARNING | Manual subscribe in template | AI |
| **NG-010** | Standalone Component Misuse | WARNING | Wrong module pattern | AUTO |

### 5.3 CSS/SCSS Issues

| Type ID | Name | Severity | Description | Fix Level |
|---------|------|----------|-------------|-----------|
| **CSS-001** | !important Overuse | WARNING | Excessive !important | AUTO |
| **CSS-002** | High Specificity | WARNING | Specificity > 0,3,0 | AI |
| **CSS-003** | Duplicate Property | ERROR | Same property twice | AUTO |
| **CSS-004** | Invalid Property Value | ERROR | Invalid CSS value | AUTO |
| **CSS-005** | Vendor Prefix Needed | WARNING | Missing -webkit- etc. | AUTO |
| **CSS-006** | Deep Nesting | WARNING | Nesting > 4 levels | AI |
| **CSS-007** | Hardcoded Color | INFO | #fff instead of variable | AUTO |
| **CSS-008** | Missing Mobile Breakpoint | WARNING | No @media query | AI |
| **CSS-009** | Z-index Chaos | WARNING | z-index > 1000 | MANUAL |
| **CSS-010** | Unused Selector | INFO | Selector never matches | AUTO |

### 5.4 HTML/Template Issues

| Type ID | Name | Severity | Description | Fix Level |
|---------|------|----------|-------------|-----------|
| **HTML-001** | Missing Alt Text | ERROR | img without alt | AUTO |
| **HTML-002** | Missing Label | ERROR | input without label | AI |
| **HTML-003** | Missing Lang Attribute | WARNING | html without lang | AUTO |
| **HTML-004** | Invalid Heading Order | WARNING | h1 → h3 skip | AUTO |
| **HTML-005** | Missing Role | WARNING | Clickable div without role | AUTO |
| **HTML-006** | Missing Aria Label | ERROR | Button without accessible name | AUTO |
| **HTML-007** | Inline Styles | INFO | style attribute used | AI |
| **HTML-008** | Missing DOCTYPE | ERROR | No <!DOCTYPE html> | AUTO |
| **HTML-009** | Deprecated Tag | WARNING | <font>, <center> used | AUTO |
| **HTML-010** | Missing charset | WARNING | No meta charset | AUTO |

---

## 6. External Linter Rule Mapping

### 6.1 ESLint Rules → Our Taxonomy

| ESLint Rule | Maps To | Our Severity | Notes |
|-------------|---------|--------------|-------|
| `no-eval` | SEC-004 | ERROR | |
| `no-unused-vars` | BUG-001 | INFO | |
| `no-undef` | BUG-002 | ERROR | |
| `require-await` | BUG-003 | ERROR | |
| `no-unreachable` | BUG-004 | WARNING | |
| `no-console` | STYLE-009 | WARNING | |
| `semi` | STYLE-001 | INFO | |
| `quotes` | STYLE-002 | INFO | |
| `indent` | STYLE-003 | INFO | |
| `complexity` | SMELL-001 | WARNING | If complexity > 10 |
| `max-params` | SMELL-002 | WARNING | If > 5 |
| `max-depth` | SMELL-003 | WARNING | If depth > 4 |
| `no-magic-numbers` | SMELL-004 | INFO | |

### 6.2 TypeScript-ESLint Rules → Our Taxonomy

| TS-ESLint Rule | Maps To | Our Severity |
|----------------|---------|--------------|
| `@typescript-eslint/no-explicit-any` | BUG-011 | WARNING |
| `@typescript-eslint/no-floating-promises` | BUG-003 | ERROR |
| `@typescript-eslint/no-unused-vars` | BUG-001 | INFO |
| `@typescript-eslint/explicit-function-return-type` | STYLE-011 | INFO |
| `@typescript-eslint/naming-convention` | STYLE-005 | INFO |

### 6.3 StyleLint Rules → Our Taxonomy

| StyleLint Rule | Maps To | Our Severity |
|----------------|---------|--------------|
| `declaration-block-no-duplicate-properties` | CSS-003 | ERROR |
| `color-no-invalid-hex` | CSS-004 | ERROR |
| `selector-max-specificity` | CSS-002 | WARNING |
| `max-nesting-depth` | CSS-006 | WARNING |
| `no-important` | CSS-001 | WARNING |

### 6.4 Angular-ESLint Rules → Our Taxonomy

| Angular-ESLint Rule | Maps To | Our Severity |
|---------------------|---------|--------------|
| `use-lifecycle-interface` | NG-001 | ERROR |
| `prefer-on-push-component-change-detection` | NG-002 | WARNING |
| `no-empty-lifecycle-method` | NG-003 | WARNING |
| `use-injectable-provided-in` | NG-004 | WARNING |

---

## 7. Auto-Fix Levels

### 7.1 Fix Level Definitions

| Level | Description | Examples | Success Rate |
|-------|-------------|----------|--------------|
| **AUTO** | Safe, deterministic fix | Add semicolon, fix indent | 99% |
| **RULE** | Pattern-based, tested fix | Remove unused var, add await | 95% |
| **AI** | AI-generated fix, needs review | Refactor complexity, fix logic | 70% |
| **MANUAL** | Requires human judgment | Architecture change, business logic | N/A |

### 7.2 Auto-Fix Strategy by Level

**AUTO (Tier 1):**
- String replacement
- AST node insertion/deletion
- Regex-based fixes
- No user confirmation needed

**RULE (Tier 1.5):**
- Template-based code generation
- Type-aware transformations
- Safe refactorings (tested patterns)
- Optional user confirmation

**AI (Tier 2 + 3):**
- Local AI model generates fix
- Cloud AI fallback if local fails
- ALWAYS show diff for review
- Requires user confirmation

**MANUAL:**
- Provide guidance/documentation
- Show similar examples
- Link to best practices
- No automated fix

---

## 8. Priority Matrix

### 8.1 Fix Priority Calculation

Issues are prioritized for fixing based on:

**Formula:**
```
Priority = (Severity × 10) + (FixLevel × 5) + (Frequency × 3)
```

Where:
- Severity: CRITICAL=10, ERROR=8, WARNING=5, INFO=3, SUGGESTION=1
- FixLevel: AUTO=10, RULE=8, AI=5, MANUAL=1
- Frequency: How many times this issue appears

**Priority Classes:**
- 150+: **P0** (Fix immediately, auto-apply)
- 100-149: **P1** (Fix before release)
- 50-99: **P2** (Fix this sprint)
- 25-49: **P3** (Fix eventually)
- <25: **P4** (Optional)

### 8.2 Priority Examples

| Issue | Severity | Fix Level | Frequency | Score | Priority |
|-------|----------|-----------|-----------|-------|----------|
| SEC-001 (Hardcoded secret) | 10 | 1 | 1 | 108 | P1 |
| STYLE-001 (Missing semicolon) | 3 | 10 | 50 | 230 | P0 |
| BUG-003 (Missing await) | 8 | 10 | 10 | 210 | P0 |
| SMELL-001 (Long function) | 5 | 5 | 5 | 90 | P2 |
| CSS-007 (Hardcoded color) | 3 | 10 | 100 | 430 | P0 |

---

## 9. Issue Metadata Schema

### 9.1 JSON Schema

```json
{
  "id": "string",              // Unique ID: "SHA256 hash of file+line+type"
  "type": "string",            // e.g., "SEC-001"
  "title": "string",           // e.g., "Hardcoded API Key"
  "message": "string",         // Human-readable description
  "file": "string",            // Relative path from project root
  "startLine": "number",
  "endLine": "number",
  "startColumn": "number",
  "endColumn": "number",
  "severity": "string",        // "CRITICAL" | "ERROR" | "WARNING" | "INFO" | "SUGGESTION"
  "category": "string",        // "SECURITY" | "PERFORMANCE" | ...
  "fileType": "string",        // "javascript" | "typescript" | ...
  "autoFixLevel": "string",    // "AUTO" | "RULE" | "AI" | "MANUAL"
  "priority": "number",        // 0-1000
  "priorityClass": "string",   // "P0" | "P1" | ...
  "source": "string",          // "eslint" | "internal-analyzer" | "stylelint"
  "rule": "string",            // Original rule ID (e.g., "no-eval")
  "context": {
    "code": "string",          // Code snippet (5 lines before/after)
    "originalCode": "string",  // The problematic line(s)
    "suggestion": "string",    // AI-generated suggestion
    "fixedCode": "string"      // Proposed fix (if available)
  },
  "metadata": {
    "cwe": "string",           // CWE ID for security issues
    "owasp": "string",         // OWASP category
    "documentation": "string", // Link to docs
    "effort": "number",        // Minutes to fix manually
    "debt": "number"           // Technical debt score
  },
  "timestamp": "string",       // ISO 8601
  "status": "string"           // "open" | "fixed" | "ignored" | "false-positive"
}
```

### 9.2 Example Issue JSON

```json
{
  "id": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "type": "SEC-001",
  "title": "Hardcoded API Key",
  "message": "API key found in source code. Move to environment variable.",
  "file": "src/services/api.service.ts",
  "startLine": 15,
  "endLine": 15,
  "startColumn": 15,
  "endColumn": 55,
  "severity": "CRITICAL",
  "category": "SECURITY",
  "fileType": "typescript",
  "autoFixLevel": "MANUAL",
  "priority": 108,
  "priorityClass": "P1",
  "source": "internal-analyzer",
  "rule": "no-hardcoded-secrets",
  "context": {
    "code": "export class ApiService {\n  private baseUrl = 'https://api.example.com';\n  private apiKey = 'sk-1234567890abcdef';  // ← ISSUE\n  \n  constructor(private http: HttpClient) {}",
    "originalCode": "  private apiKey = 'sk-1234567890abcdef';",
    "suggestion": "Use environment variable: private apiKey = process.env.API_KEY;",
    "fixedCode": "  private apiKey = process.env.API_KEY;"
  },
  "metadata": {
    "cwe": "CWE-798",
    "owasp": "A2:2021-Cryptographic Failures",
    "documentation": "https://docs.example.com/security/secrets",
    "effort": 5,
    "debt": 100
  },
  "timestamp": "2024-01-15T10:30:00Z",
  "status": "open"
}
```

---

## 10. Custom Rules Engine

### 10.1 Custom Rule Definition

Users can define custom rules in `.codeanalyzer/rules/`:

```javascript
// .codeanalyzer/rules/no-moment-js.js
module.exports = {
  id: 'CUSTOM-001',
  title: 'Moment.js is deprecated',
  severity: 'WARNING',
  category: 'MAINTAINABILITY',
  fileType: ['javascript', 'typescript'],

  detect(ast, file) {
    // Return array of issues
    const issues = [];
    ast.program.body.forEach(node => {
      if (node.type === 'ImportDeclaration' &&
          node.source.value === 'moment') {
        issues.push({
          line: node.loc.start.line,
          column: node.loc.start.column,
          message: 'Moment.js is deprecated. Use date-fns or Day.js instead.',
          suggestion: "import { format } from 'date-fns';"
        });
      }
    });
    return issues;
  },

  fix(code, issue) {
    // Return fixed code or null if can't auto-fix
    return code.replace(
      "import moment from 'moment'",
      "import { format } from 'date-fns'"
    );
  }
};
```

### 10.2 Team Rules Configuration

```json
// .codeanalyzer/config.json
{
  "rules": {
    "enabled": [
      "SEC-*",           // All security rules
      "BUG-*",           // All bug rules
      "NG-*",            // All Angular rules
      "CUSTOM-*"         // All custom rules
    ],
    "disabled": [
      "STYLE-001",       // Allow missing semicolons
      "SMELL-004"        // Allow magic numbers
    ],
    "severityOverrides": {
      "STYLE-009": "ERROR"  // console.log is ERROR, not WARNING
    },
    "customRules": [
      ".codeanalyzer/rules/*.js"
    ]
  },
  "autoFix": {
    "enabledLevels": ["AUTO", "RULE"],  // AI fixes require confirmation
    "excludeRules": ["SEC-*"],          // Never auto-fix security issues
    "requireConfirmation": true
  }
}
```

---

## 11. Integration with CI/CD

### 11.1 Quality Gate Configuration

```json
// .codeanalyzer/quality-gate.json
{
  "name": "default",
  "conditions": [
    {
      "metric": "critical_issues",
      "operator": "=",
      "threshold": 0,
      "onFailure": "block"
    },
    {
      "metric": "error_issues",
      "operator": "<=",
      "threshold": 5,
      "onFailure": "warn"
    },
    {
      "metric": "security_issues",
      "operator": "=",
      "threshold": 0,
      "onFailure": "block"
    },
    {
      "metric": "code_coverage",
      "operator": ">=",
      "threshold": 80,
      "onFailure": "warn"
    }
  ]
}
```

### 11.2 CI Integration Example

```yaml
# .github/workflows/code-quality.yml
name: Code Quality

on: [push, pull_request]

jobs:
  analyze:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Install analyzer
        run: npm install -g parikrama-code-analyzer

      - name: Run analysis
        run: pca analyze --ci --json > results.json

      - name: Auto-fix issues
        run: pca fix --auto --level AUTO,RULE

      - name: Quality gate
        run: pca gate --strict

      - name: Upload results
        uses: actions/upload-artifact@v3
        with:
          name: analysis-results
          path: results.json
```

---

## 12. Multi-Language Support Roadmap

### Phase 1 (Current)
- ✅ JavaScript (ES6+)
- ✅ TypeScript
- ✅ CSS/SCSS
- ✅ HTML
- ✅ Angular

### Phase 2
- ⏳ C#
- ⏳ Java
- ⏳ Python

### Phase 3
- 🔮 Go
- 🔮 Rust
- 🔮 PHP

---

## 13. Benchmark & Validation

### 13.1 Issue Detection Accuracy

Target metrics:
- **Precision:** >95% (few false positives)
- **Recall:** >85% (catch most real issues)
- **F1 Score:** >90%

### 13.2 Test Corpus

Use standard test suites:
- **ESLint Test Cases:** 2,000+ validated rules
- **SonarJS Test Cases:** 150+ issue types
- **Custom Test Suite:** 500+ real-world issues

### 13.3 Performance Benchmarks

Target performance:
- **Small project** (100 files): <10s
- **Medium project** (1,000 files): <60s
- **Large project** (10,000 files): <300s

---

## Conclusion

This taxonomy provides a comprehensive, extensible framework for classifying and managing code quality issues. It balances precision with usability, enabling both automated fixes and human oversight.

**Key Features:**
- 100+ predefined issue types
- 5 severity levels with clear criteria
- 10 primary categories
- 4 auto-fix levels
- Complete external linter mapping
- Custom rule engine
- CI/CD integration

**Next Steps:**
1. ✅ Implement issue categorizer (Step 4)
2. Map external linter outputs (Step 3)
3. Build auto-fix engine (Step 5-7)
4. Create test suite with validation (Step 11)

---

**Document Status:** READY FOR IMPLEMENTATION  
**Version:** 1.0  
**Last Updated:** 2024
