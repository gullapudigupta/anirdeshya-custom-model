# AI Issue Generator - Task Summary

**Purpose:** Self-explanatory AI system that automatically fixes unresolved linting and error issues by leveraging code-analyzer features for symbol/context analysis and applying intelligent fixes.

---

## 🎯 Core Concept

The AI Issue Generator is a **self-explanatory system** that:
1. **Clearly explains what the issue is** (in plain English)
2. **Describes what needs to be done** (actionable fix strategy)
3. **Uses code-analyzer for symbol/LINQ-like queries** to understand code context
4. **Edits specific lines** to fix issues (not entire files)
5. **Handles both linting issues and runtime errors** with the same workflow

---

## 🔗 Integration with Code-Analyzer

### Leverage Existing Code-Analyzer Features

The AI Issue Generator will use these code-analyzer capabilities:

1. **Symbol Queries** (`query-engine.js`, `symbol-extractor.js`)
   - Find symbol definitions
   - Get symbol usage locations
   - Understand symbol scope and type

2. **AST Analysis** (`ast-utils.js`)
   - Parse code structure
   - Navigate syntax trees
   - Identify code patterns

3. **Context Building** (`context-composer.js`)
   - Build minimal relevant context around issues
   - Extract only necessary code snippets
   - Token-efficient context generation

4. **Dependency Graph** (`dependency-graph.js`)
   - Understand module relationships
   - Find import/export chains
   - Detect circular dependencies

5. **Angular Patterns** (`angular-patterns.js`)
   - Detect Angular-specific issues
   - Understand component/service relationships
   - Validate lifecycle hooks

---

## 📋 Phase 6 Task List (15 Tasks)

### **Group 1: Issue Understanding & Explanation (Self-Explanatory Core)**

#### **P6-T001: Self-Explanatory Issue Classifier** ⭐ HIGH PRIORITY
**Hours:** 10h | **Value:** 100 | **Dependencies:** None

**Description:** Create a system that generates human-readable explanations of issues.

**Key Features:**
- Parse ESLint/TypeScript/build errors
- Generate plain English explanations:
  - "What is the issue?" (e.g., "Variable 'token' is declared but never used")
  - "Why is this a problem?" (e.g., "Unused variables waste memory and indicate incomplete code")
  - "What needs to be done?" (e.g., "Either use the variable or remove it")
- Include severity, impact, and fix complexity
- Support multiple issue types (linting, type errors, runtime errors)

**Output Example:**
```json
{
  "issue": {
    "rule": "no-unused-vars",
    "file": "src/auth.service.ts",
    "line": 42,
    "message": "Variable 'token' is defined but never used"
  },
  "explanation": {
    "what": "A variable named 'token' is declared on line 42 but is never used anywhere in the code",
    "why": "Unused variables indicate incomplete implementation, waste memory, and reduce code clarity",
    "howToFix": "Either use the 'token' variable in your authentication logic or remove the declaration",
    "severity": "warning",
    "impact": "low",
    "fixComplexity": "simple"
  }
}
```

**Integration Points:**
- Use `code-analyzer/src/query-engine.js` to find variable references
- Use `code-analyzer/src/symbol-extractor.js` to analyze symbol usage

---

#### **P6-T002: Code Context Analyzer with Symbol Queries** ⭐ HIGH PRIORITY
**Hours:** 12h | **Value:** 95 | **Dependencies:** P6-T001

**Description:** Build intelligent context extraction using code-analyzer's LINQ-like symbol queries.

**Key Features:**
- Query symbols related to the issue (variables, functions, classes)
- Extract minimal relevant context (5-10 lines around issue)
- Include type definitions, imports, and related code
- Use LINQ-style queries for precise context selection
- Token-efficient context (≤300 tokens per issue)

**LINQ-Style Queries:**
```javascript
// Example: Find all usages of a variable
const usages = await codeAnalyzer.querySymbols({
  file: 'src/auth.service.ts',
  symbolName: 'token',
  type: 'variable',
  includeReferences: true
});

// Example: Get function signature and dependencies
const context = await codeAnalyzer.getSymbolContext({
  symbol: 'authenticate',
  depth: 2, // Include callers and callees
  includeTypes: true,
  includeImports: true
});
```

**Output Example:**
```json
{
  "issue": { "rule": "no-unused-vars", "symbol": "token", "line": 42 },
  "context": {
    "surroundingCode": [
      "40:   constructor(private http: HttpClient) {}",
      "41:",
      "42:   const token = this.getAuthToken();",
      "43:",
      "44:   authenticate(username: string, password: string) {"
    ],
    "relatedSymbols": [
      {
        "name": "getAuthToken",
        "type": "method",
        "returnType": "string",
        "line": 15
      },
      {
        "name": "authenticate",
        "type": "method",
        "parameters": ["username: string", "password: string"],
        "line": 44
      }
    ],
    "imports": [
      "import { HttpClient } from '@angular/common/http';"
    ]
  }
}
```

**Integration Points:**
- Use `code-analyzer/src/query-engine.js` for symbol queries
- Use `code-analyzer/src/context-composer.js` for context building
- Use `code-analyzer/src/symbol-extractor.js` for symbol analysis

---

### **Group 2: Research & Knowledge Gathering**

#### **P6-T003: Documentation Search Engine**
**Hours:** 10h | **Value:** 85 | **Dependencies:** P6-T001

Search official documentation (ESLint, TypeScript, Angular, React) for rule explanations and fix examples.

---

#### **P6-T004: GitHub Issues Searcher**
**Hours:** 10h | **Value:** 80 | **Dependencies:** P6-T001

Search GitHub for similar issues and accepted solutions in popular repositories.

---

#### **P6-T005: StackOverflow Integration**
**Hours:** 8h | **Value:** 75 | **Dependencies:** P6-T001

Query StackOverflow for accepted answers to similar problems.

---

#### **P6-T006: Context Aggregator & Summarizer**
**Hours:** 12h | **Value:** 90 | **Dependencies:** P6-T003, P6-T004, P6-T005

Aggregate and deduplicate findings from all sources, summarize into ≤2000 tokens.

---

### **Group 3: AI Execution & Fix Application**

#### **P6-T007: Self-Explanatory Prompt Builder** ⭐ HIGH PRIORITY
**Hours:** 10h | **Value:** 95 | **Dependencies:** P6-T002, P6-T006

**Description:** Build prompts that clearly explain the issue and expected fix to AI models.

**Key Features:**
- Include self-explanatory issue description
- Provide symbol context from code-analyzer
- Add research findings (docs, GitHub, StackOverflow)
- Request specific line-level edits (not full file rewrites)
- Include validation criteria

**Prompt Template:**
```
You are an expert code fixer. 

## Issue Explanation
**What:** {plain English description}
**Why it's a problem:** {impact explanation}
**What to do:** {fix strategy}

## Code Context
File: {file}
Line: {line}
Surrounding Code:
{minimal code context from code-analyzer}

## Symbol Analysis
{symbol usage, type info, dependencies}

## Research Findings
{documentation excerpts, similar fixes, best practices}

## Task
Provide a **line-level edit** that fixes this specific issue:
1. Explain your fix strategy
2. Show ONLY the specific line(s) to change
3. Provide before/after comparison
4. Include validation test

Format:
{
  "strategy": "...",
  "lineEdit": {
    "line": 42,
    "before": "const token = this.getAuthToken();",
    "after": "const token = this.getAuthToken(); this.headers.set('Authorization', token);"
  },
  "test": "Verify authentication still works"
}
```

---

#### **P6-T008: Local AI Executor (Ollama)**
**Hours:** 10h | **Value:** 85 | **Dependencies:** P6-T007

Execute prompts on local Ollama model (CodeLlama/DeepSeek Coder), parse responses, validate fix proposals.

---

#### **P6-T009: Cloud AI Executor (OpenAI/Anthropic)**
**Hours:** 8h | **Value:** 80 | **Dependencies:** P6-T008

Fallback to cloud AI (GPT-4/Claude) if local model fails or is unavailable.

---

#### **P6-T010: Line-Level Code Applicator** ⭐ HIGH PRIORITY
**Hours:** 12h | **Value:** 100 | **Dependencies:** P6-T009

**Description:** Apply fixes at the line level using precise edits (not full file rewrites).

**Key Features:**
- Parse AI-suggested line edits
- Apply changes to specific lines only
- Preserve file formatting and indentation
- Create backup before changes
- Use code-analyzer AST for precise targeting
- Validate syntax after edit

**Implementation:**
```javascript
async function applyLineEdit(file, lineNumber, newContent) {
  // 1. Backup file
  await backupFile(file);

  // 2. Read file lines
  const lines = await readFileLines(file);

  // 3. Apply edit to specific line
  lines[lineNumber - 1] = newContent;

  // 4. Validate AST is still valid
  const isValid = await codeAnalyzer.validateSyntax(lines.join('\n'));
  if (!isValid) {
    await rollbackFile(file);
    throw new Error('Syntax validation failed');
  }

  // 5. Write updated file
  await writeFileLines(file, lines);

  // 6. Run linter to verify fix
  const lintResult = await runLinter(file);
  return lintResult;
}
```

**Integration Points:**
- Use `code-analyzer/src/ast-utils.js` for syntax validation
- Use advanced-quality-tool's existing file I/O utilities

---

### **Group 4: Error Handling & Recovery**

#### **P6-T011: Error Context Generator** ⭐ HIGH PRIORITY
**Hours:** 12h | **Value:** 95 | **Dependencies:** P6-T010

**Description:** Generate enhanced context when fixes fail or introduce new errors.

**Key Features:**
- Detect build errors after fix application
- Detect new linting errors introduced
- Use code-analyzer to analyze error context
- Search docs/GitHub/StackOverflow for error-specific solutions
- Generate self-explanatory error description
- Retry with enhanced context (max 3 attempts)

**Error Recovery Workflow:**
```
1. Apply Fix
   ↓
2. Validate (Build + Lint)
   ↓
3. Error Detected?
   ↓ YES
4. Analyze Error with code-analyzer
   - Get error location context
   - Find related symbols
   - Analyze dependencies
   ↓
5. Search for Error Solutions
   - Documentation
   - GitHub issues
   - StackOverflow
   ↓
6. Generate Enhanced Context
   - Original issue + solution tried
   - New error description
   - Symbol analysis
   - Research findings
   ↓
7. Retry Fix with Cloud AI (if needed)
   ↓
8. Max 3 attempts, then flag for manual review
```

**Integration Points:**
- Use `code-analyzer/src/query-engine.js` for error context analysis
- Use `code-analyzer/src/symbol-extractor.js` for related symbol discovery

---

#### **P6-T012: Multi-Attempt Orchestrator**
**Hours:** 10h | **Value:** 90 | **Dependencies:** P6-T011

Main orchestrator that coordinates the full workflow: classify → research → fix → validate → retry on error.

---

### **Group 5: CLI & Configuration**

#### **P6-T013: CLI Integration**
**Hours:** 6h | **Value:** 80 | **Dependencies:** P6-T012

Add `generate-fixes` command to advanced-quality-tool CLI.

---

#### **P6-T014: Configuration System**
**Hours:** 6h | **Value:** 75 | **Dependencies:** P6-T012

Configure AI models, API keys, rate limits, cost budgets, search sources, retry limits.

---

#### **P6-T015: Testing & Documentation**
**Hours:** 12h | **Value:** 85 | **Dependencies:** All

Unit tests, integration tests, end-to-end tests, usage documentation.

---

## 📊 Task Summary

| Group | Tasks | Total Hours | Avg Value |
|-------|-------|-------------|-----------|
| Issue Understanding (Self-Explanatory) | 2 | 22h | 97.5 |
| Research & Knowledge | 4 | 40h | 82.5 |
| AI Execution & Fix | 4 | 40h | 90 |
| Error Handling | 2 | 22h | 92.5 |
| CLI & Config | 3 | 24h | 80 |
| **Total** | **15** | **148h** | **88** |

---

## 🔧 Required Code-Analyzer Enhancements

### Supporting Features Needed in Code-Analyzer

Create new section in `tools/code-analyzer/REQUIREMENTS.md`:

#### **CA-SF-001: Enhanced Symbol Query API**
- Add LINQ-style query methods
- Support multi-file symbol searches
- Include type inference results
- Provide reference counting

#### **CA-SF-002: Context Composer Extensions**
- Token-counting for context windows
- Minimal context extraction (5-10 lines)
- Related symbol discovery
- Import chain analysis

#### **CA-SF-003: Real-Time Syntax Validation**
- Validate code changes before writing to disk
- Provide detailed syntax error locations
- Support partial AST updates
- Fast validation (≤100ms per file)

#### **CA-SF-004: Symbol Impact Analysis**
- Find all usages of a symbol across files
- Detect breaking changes
- Analyze scope and visibility
- Track symbol dependencies

---

## 🔧 Required Advanced-Quality-Tool Enhancements

### Supporting Features Needed in Advanced-Quality-Tool

Create new section in `tools/advanced-quality-tool/REQUIREMENTS.md`:

#### **AQ-SF-001: Line-Level File Editor**
- Precise line replacement
- AST-aware editing
- Automatic formatting preservation
- Rollback on validation failure

#### **AQ-SF-002: Multi-Source Documentation Cache**
- Cache ESLint docs locally
- Cache TypeScript/Angular docs
- Cache GitHub search results
- TTL-based invalidation (24h)

#### **AQ-SF-003: Fix Validation Pipeline**
- Run ESLint after fixes
- Run TypeScript compiler check
- Execute relevant unit tests
- Measure fix success rate

#### **AQ-SF-004: Cost & Performance Monitoring**
- Track API call costs (OpenAI/GitHub/StackOverflow)
- Measure token usage per fix
- Monitor fix success rate
- Generate daily cost reports

---

## 🎯 Self-Explanatory Design Principles

1. **Clear Issue Descriptions**
   - Every issue has a "what/why/how" explanation
   - Plain English, no jargon
   - Include examples and impact

2. **Transparent Fix Process**
   - Show what will be changed before applying
   - Explain the fix strategy
   - Provide validation steps

3. **Line-Level Precision**
   - Edit only the specific problematic lines
   - Don't rewrite entire files
   - Preserve surrounding code

4. **Context-Aware Fixes**
   - Use code-analyzer to understand symbols
   - Analyze dependencies and side effects
   - Validate fixes don't break other code

5. **Error Recovery with Learning**
   - If fix fails, explain why
   - Search for solutions to the new error
   - Retry with enhanced context
   - Flag for manual review after 3 attempts

---

## 🚀 Implementation Priority

### Phase 1: Self-Explanatory Core (2 weeks)
- P6-T001: Issue Classifier (self-explanatory)
- P6-T002: Code Context Analyzer (code-analyzer integration)
- P6-T007: Prompt Builder (clear explanations)

### Phase 2: Fix Application (2 weeks)
- P6-T010: Line-Level Code Applicator
- P6-T011: Error Context Generator
- P6-T008: Local AI Executor

### Phase 3: Research & Recovery (2 weeks)
- P6-T003: Documentation Search
- P6-T004: GitHub Search
- P6-T006: Context Aggregator
- P6-T012: Orchestrator

### Phase 4: Polish & Production (1 week)
- P6-T013: CLI Integration
- P6-T014: Configuration
- P6-T015: Testing & Docs

**Total:** 7 weeks, 148 hours

---

## 📈 Success Metrics

- **Resolution Rate:** ≥60% of issues fixed on first attempt
- **Self-Explanatory Score:** ≥90% of users understand what's being fixed
- **Line Edit Precision:** ≥95% of fixes only touch necessary lines
- **Error Recovery Rate:** ≥70% of failed fixes succeed after retry
- **Cost Efficiency:** ≤$0.20 per issue (avg)

---

**Status:** Ready for Implementation  
**Next Step:** Update TASKS.json, create supporting requirements documents
