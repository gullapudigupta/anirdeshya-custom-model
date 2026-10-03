# Code-Analyzer - Supporting Features for AI Issue Generator

**Document Version:** 1.0  
**Last Updated:** January 2024  
**Status:** Planning - Pending Approval

---

## 🎯 Purpose

This document defines new features needed in the **code-analyzer** tool to support the AI Issue Generator in the advanced-quality-tool. These features enable intelligent symbol querying, context extraction, and LINQ-like code analysis.

---

## 📋 Required Supporting Features

### **CA-SF-001: Enhanced Symbol Query API** ⭐ HIGH PRIORITY

**Purpose:** Provide LINQ-style symbol queries for precise code analysis.

**Hours:** 12h | **Value:** 95 | **Priority:** P0

#### Requirements

1. **Multi-File Symbol Search**
   ```javascript
   // Find all usages of a symbol across the entire project
   const usages = await codeAnalyzer.querySymbols({
     symbolName: 'authenticate',
     type: 'method',
     scope: 'project', // 'file' | 'project' | 'workspace'
     includeReferences: true,
     includeDefinition: true
   });
   ```

2. **LINQ-Style Filtering**
   ```javascript
   // Find unused variables in a file
   const unused = await codeAnalyzer.querySymbols({
     file: 'src/auth.service.ts',
     type: 'variable',
     filter: symbol => symbol.references.length === 0,
     includeLineNumbers: true
   });
   ```

3. **Type-Aware Queries**
   ```javascript
   // Find all functions that return a specific type
   const methods = await codeAnalyzer.querySymbols({
     type: 'function',
     returnType: 'Observable<User>',
     includeTypeInfo: true
   });
   ```

4. **Reference Counting**
   ```javascript
   // Get reference count for each symbol
   const symbolUsage = await codeAnalyzer.getSymbolUsageStats({
     file: 'src/auth.service.ts',
     includeImportedSymbols: true
   });
   // Returns: { token: 0, authenticate: 5, getAuthToken: 3 }
   ```

#### API Interface

```javascript
class SymbolQueryEngine {
  /**
   * Query symbols with LINQ-style filtering
   * @param {Object} query - Query parameters
   * @returns {Promise<Symbol[]>} Matching symbols
   */
  async querySymbols(query) {
    // Implementation
  }

  /**
   * Get symbol usage statistics
   * @param {Object} options - Query options
   * @returns {Promise<Object>} Usage stats
   */
  async getSymbolUsageStats(options) {
    // Implementation
  }

  /**
   * Find symbol definition across files
   * @param {string} symbolName - Symbol to find
   * @param {string} fromFile - File context
   * @returns {Promise<SymbolDefinition>} Definition info
   */
  async findDefinition(symbolName, fromFile) {
    // Implementation
  }
}
```

#### Integration Points

- Extend `src/query-engine.js`
- Enhance `src/symbol-extractor.js`
- Add caching for performance

---

### **CA-SF-002: Context Composer Extensions** ⭐ HIGH PRIORITY

**Purpose:** Generate minimal, token-efficient code context for AI prompts.

**Hours:** 10h | **Value:** 90 | **Priority:** P0

#### Requirements

1. **Token-Counted Context Extraction**
   ```javascript
   // Extract context with token limit
   const context = await codeAnalyzer.getMinimalContext({
     file: 'src/auth.service.ts',
     line: 42,
     maxTokens: 300,
     includeImports: true,
     includeSurroundingLines: 5
   });
   ```

2. **Related Symbol Discovery**
   ```javascript
   // Find symbols related to an issue
   const related = await codeAnalyzer.getRelatedSymbols({
     file: 'src/auth.service.ts',
     symbolName: 'token',
     depth: 2, // How many levels deep to search
     types: ['function', 'variable', 'class']
   });
   ```

3. **Import Chain Analysis**
   ```javascript
   // Get import dependencies for a symbol
   const imports = await codeAnalyzer.getImportChain({
     file: 'src/auth.service.ts',
     symbolName: 'HttpClient',
     includeTransitive: false // Only direct imports
   });
   ```

4. **Smart Context Prioritization**
   ```javascript
   // Get most relevant context based on issue type
   const context = await codeAnalyzer.getRelevantContext({
     file: 'src/auth.service.ts',
     line: 42,
     issueType: 'no-unused-vars', // ESLint rule
     maxTokens: 300
   });
   // Priority: issue line > symbol usage > related functions > imports
   ```

#### API Interface

```javascript
class EnhancedContextComposer {
  /**
   * Extract minimal token-efficient context
   * @param {Object} options - Context extraction options
   * @returns {Promise<CodeContext>} Minimal context
   */
  async getMinimalContext(options) {
    // Implementation
  }

  /**
   * Find symbols related to a primary symbol
   * @param {Object} options - Symbol discovery options
   * @returns {Promise<Symbol[]>} Related symbols
   */
  async getRelatedSymbols(options) {
    // Implementation
  }

  /**
   * Analyze import dependencies
   * @param {Object} options - Import analysis options
   * @returns {Promise<Import[]>} Import chain
   */
  async getImportChain(options) {
    // Implementation
  }

  /**
   * Count tokens in code snippet
   * @param {string} code - Code to count
   * @returns {number} Approximate token count
   */
  countTokens(code) {
    // Implementation (roughly 1 token per 4 chars)
  }
}
```

#### Integration Points

- Extend `src/context-composer.js`
- Add token counting utility
- Optimize for AI prompt generation

---

### **CA-SF-003: Real-Time Syntax Validation**

**Purpose:** Validate code changes before writing to disk to prevent breaking changes.

**Hours:** 8h | **Value:** 85 | **Priority:** P1

#### Requirements

1. **Fast Syntax Validation**
   ```javascript
   // Validate edited code without writing to disk
   const isValid = await codeAnalyzer.validateSyntax({
     file: 'src/auth.service.ts',
     content: editedContent,
     language: 'typescript'
   });
   ```

2. **Detailed Error Reporting**
   ```javascript
   // Get specific syntax errors
   const errors = await codeAnalyzer.getSyntaxErrors({
     content: editedContent,
     language: 'typescript'
   });
   // Returns: [{ line: 42, column: 10, message: "Expected ';'" }]
   ```

3. **Partial AST Updates**
   ```javascript
   // Update AST without full re-parse
   const updatedAst = await codeAnalyzer.updateASTNode({
     file: 'src/auth.service.ts',
     line: 42,
     newContent: 'const token = this.getAuthToken();'
   });
   ```

4. **Performance Target**
   - Validation time: ≤100ms per file
   - Support files up to 10,000 lines
   - Cache AST for unchanged portions

#### API Interface

```javascript
class SyntaxValidator {
  /**
   * Validate code syntax without writing to disk
   * @param {Object} options - Validation options
   * @returns {Promise<boolean>} Is valid
   */
  async validateSyntax(options) {
    // Implementation
  }

  /**
   * Get detailed syntax errors
   * @param {Object} options - Error detection options
   * @returns {Promise<SyntaxError[]>} Syntax errors
   */
  async getSyntaxErrors(options) {
    // Implementation
  }

  /**
   * Update AST incrementally
   * @param {Object} options - AST update options
   * @returns {Promise<AST>} Updated AST
   */
  async updateASTNode(options) {
    // Implementation
  }
}
```

#### Integration Points

- Extend `src/ast-utils.js`
- Add AST caching layer
- Integrate with TypeScript compiler API

---

### **CA-SF-004: Symbol Impact Analysis**

**Purpose:** Analyze the impact of changing a symbol across the codebase.

**Hours:** 10h | **Value:** 80 | **Priority:** P1

#### Requirements

1. **Cross-File Usage Detection**
   ```javascript
   // Find all files using a symbol
   const impact = await codeAnalyzer.analyzeSymbolImpact({
     file: 'src/auth.service.ts',
     symbolName: 'authenticate',
     type: 'method'
   });
   ```

2. **Breaking Change Detection**
   ```javascript
   // Check if a change would break other code
   const isBreaking = await codeAnalyzer.detectBreakingChange({
     file: 'src/auth.service.ts',
     symbolName: 'authenticate',
     changeType: 'signature', // 'signature' | 'removal' | 'rename'
     newSignature: '(user: User) => Observable<Token>'
   });
   ```

3. **Scope and Visibility Analysis**
   ```javascript
   // Analyze symbol scope and access
   const scope = await codeAnalyzer.getSymbolScope({
     file: 'src/auth.service.ts',
     symbolName: 'token',
     line: 42
   });
   // Returns: { scope: 'method', visibility: 'private', canBeRemoved: true }
   ```

4. **Dependency Tracking**
   ```javascript
   // Get all symbols that depend on this one
   const dependencies = await codeAnalyzer.getSymbolDependencies({
     file: 'src/auth.service.ts',
     symbolName: 'authenticate',
     direction: 'downstream' // 'upstream' | 'downstream' | 'both'
   });
   ```

#### API Interface

```javascript
class SymbolImpactAnalyzer {
  /**
   * Analyze impact of changing a symbol
   * @param {Object} options - Impact analysis options
   * @returns {Promise<ImpactReport>} Impact analysis
   */
  async analyzeSymbolImpact(options) {
    // Implementation
  }

  /**
   * Detect if a change would break code
   * @param {Object} options - Breaking change detection options
   * @returns {Promise<boolean>} Is breaking
   */
  async detectBreakingChange(options) {
    // Implementation
  }

  /**
   * Get symbol scope information
   * @param {Object} options - Scope analysis options
   * @returns {Promise<ScopeInfo>} Scope details
   */
  async getSymbolScope(options) {
    // Implementation
  }
}
```

#### Integration Points

- Extend `src/dependency-graph.js`
- Use `src/symbol-extractor.js` for symbol tracking
- Add impact reporting utilities

---

### **CA-SF-005: Batch Symbol Operations**

**Purpose:** Perform multiple symbol queries efficiently in a single operation.

**Hours:** 6h | **Value:** 70 | **Priority:** P2

#### Requirements

1. **Batch Queries**
   ```javascript
   // Query multiple symbols at once
   const results = await codeAnalyzer.batchQuerySymbols([
     { symbolName: 'token', file: 'src/auth.service.ts' },
     { symbolName: 'user', file: 'src/user.service.ts' },
     { symbolName: 'config', file: 'src/app.config.ts' }
   ]);
   ```

2. **Query Caching**
   - Cache symbol query results for 5 minutes
   - Invalidate cache on file changes
   - Share cache across multiple queries

3. **Parallel Execution**
   - Execute independent queries in parallel
   - Optimize for multi-file analysis
   - Rate limit to prevent resource exhaustion

#### API Interface

```javascript
class BatchSymbolQuery {
  /**
   * Execute multiple symbol queries efficiently
   * @param {Object[]} queries - Array of query objects
   * @returns {Promise<Object[]>} Query results
   */
  async batchQuerySymbols(queries) {
    // Implementation
  }
}
```

---

## 📊 Feature Summary

| Feature ID | Name | Hours | Value | Priority |
|------------|------|-------|-------|----------|
| CA-SF-001 | Enhanced Symbol Query API | 12h | 95 | P0 |
| CA-SF-002 | Context Composer Extensions | 10h | 90 | P0 |
| CA-SF-003 | Real-Time Syntax Validation | 8h | 85 | P1 |
| CA-SF-004 | Symbol Impact Analysis | 10h | 80 | P1 |
| CA-SF-005 | Batch Symbol Operations | 6h | 70 | P2 |
| **Total** | | **46h** | **84** | |

---

## 🔗 Integration Architecture

```
┌─────────────────────────────────────────────────────────┐
│         Advanced-Quality-Tool (AI Issue Generator)       │
└─────────────────────┬───────────────────────────────────┘
                      │ Uses
                      ▼
┌─────────────────────────────────────────────────────────┐
│              Code-Analyzer (Enhanced APIs)               │
├─────────────────────────────────────────────────────────┤
│  CA-SF-001: Symbol Query API (LINQ-style)               │
│  CA-SF-002: Context Composer (Token-efficient)          │
│  CA-SF-003: Syntax Validator (Real-time)                │
│  CA-SF-004: Impact Analyzer (Breaking changes)          │
│  CA-SF-005: Batch Operations (Performance)              │
└─────────────────────┬───────────────────────────────────┘
                      │ Extends
                      ▼
┌─────────────────────────────────────────────────────────┐
│           Existing Code-Analyzer Modules                 │
├─────────────────────────────────────────────────────────┤
│  • query-engine.js                                       │
│  • symbol-extractor.js                                   │
│  • context-composer.js                                   │
│  • ast-utils.js                                          │
│  • dependency-graph.js                                   │
└─────────────────────────────────────────────────────────┘
```

---

## 🚀 Implementation Plan

### Phase 1: Core Query APIs (2 weeks)
- **Week 1:** CA-SF-001 Enhanced Symbol Query API
- **Week 2:** CA-SF-002 Context Composer Extensions

### Phase 2: Validation & Analysis (1.5 weeks)
- **Week 3:** CA-SF-003 Real-Time Syntax Validation
- **Week 4:** CA-SF-004 Symbol Impact Analysis (partial)

### Phase 3: Performance & Optimization (0.5 weeks)
- **Week 4:** CA-SF-005 Batch Symbol Operations

**Total Duration:** 4 weeks  
**Total Effort:** 46 hours

---

## ✅ Acceptance Criteria

### CA-SF-001: Enhanced Symbol Query API
- [ ] Support multi-file symbol searches across project
- [ ] Implement LINQ-style filtering with custom predicates
- [ ] Provide type-aware queries with type inference
- [ ] Include reference counting for all symbols
- [ ] Performance: ≤500ms for project-wide symbol search
- [ ] Unit tests with 90% code coverage

### CA-SF-002: Context Composer Extensions
- [ ] Extract minimal context within token limits
- [ ] Discover related symbols with configurable depth
- [ ] Analyze import chains (direct and transitive)
- [ ] Prioritize context based on issue type
- [ ] Performance: ≤200ms for context extraction
- [ ] Token counting accuracy within ±10%

### CA-SF-003: Real-Time Syntax Validation
- [ ] Validate TypeScript/JavaScript syntax in ≤100ms
- [ ] Report detailed syntax errors with line/column
- [ ] Support partial AST updates for performance
- [ ] Handle files up to 10,000 lines efficiently
- [ ] Cache AST for unchanged code sections
- [ ] Integration tests with common syntax errors

### CA-SF-004: Symbol Impact Analysis
- [ ] Detect cross-file symbol usage
- [ ] Identify breaking changes (signature, removal, rename)
- [ ] Analyze symbol scope and visibility correctly
- [ ] Track symbol dependencies (upstream/downstream)
- [ ] Performance: ≤1s for impact analysis
- [ ] Accuracy: ≥95% for breaking change detection

### CA-SF-005: Batch Symbol Operations
- [ ] Execute multiple queries in single operation
- [ ] Implement query result caching (5-min TTL)
- [ ] Parallelize independent queries automatically
- [ ] Performance: 3x faster than sequential queries
- [ ] Cache invalidation on file changes

---

## 📝 Documentation Requirements

1. **API Documentation**
   - JSDoc comments for all public methods
   - Usage examples for each feature
   - Integration guides for advanced-quality-tool

2. **Performance Guidelines**
   - Benchmark results for each feature
   - Optimization recommendations
   - Caching strategies

3. **Migration Guide**
   - Breaking changes from existing APIs
   - Deprecation timeline for old methods
   - Code migration examples

---

## 🔧 Configuration

Add to `tools/code-analyzer/config.json`:

```json
{
  "symbolQuery": {
    "cacheEnabled": true,
    "cacheTTL": 300,
    "maxConcurrentQueries": 5,
    "timeoutMs": 5000
  },
  "contextComposer": {
    "defaultMaxTokens": 300,
    "defaultSurroundingLines": 5,
    "tokenCountingMethod": "approximate"
  },
  "syntaxValidation": {
    "enableASTCache": true,
    "maxCacheSize": 100,
    "validationTimeoutMs": 100
  },
  "impactAnalysis": {
    "maxDepth": 3,
    "includeTransitiveDeps": false,
    "analysisTimeoutMs": 1000
  }
}
```

---

## 📈 Success Metrics

- **Query Performance:** ≥90% of queries complete in ≤500ms
- **Context Accuracy:** ≥95% of extracted contexts are relevant
- **Validation Speed:** ≥95% of validations complete in ≤100ms
- **Impact Analysis Accuracy:** ≥95% correct breaking change detection
- **Cache Hit Rate:** ≥70% for repeated queries

---

**Status:** Ready for Implementation  
**Dependencies:** None (extends existing code-analyzer)  
**Risk Level:** Low (additive changes, no breaking modifications)
