# Multi-Language Extension Guide

## Current Coverage

The Parikrama Code Analyzer currently supports:
- **TypeScript** — Full symbol extraction, complexity, patterns, security
- **JavaScript** — Same as TypeScript (shared regex engine)
- **HTML** — Angular template analysis, a11y, performance
- **SCSS/CSS** — Specificity, colors, z-index, nesting, duplicates

## Extending to Other Languages

### NestJS (Already Supported!)

NestJS is TypeScript-based, so all existing analyzers work. However, NestJS-specific patterns can be added:

```javascript
// Potential NestJS-specific checks:
// - @Controller decorator extraction
// - @Injectable scope analysis
// - @Module circular dependency detection
// - Guard/Interceptor/Pipe patterns
// - DTO validation decorator checks
// - Repository pattern analysis
// - GraphQL resolver patterns
```

**To add NestJS support**, create: `analyzers/nestjs-patterns.js`

Key patterns to detect:
1. Controllers without proper HTTP method decorators
2. Services without proper scope (DEFAULT vs REQUEST vs TRANSIENT)
3. Missing DTO validation (class-validator decorators)
4. Circular module dependencies
5. Missing guards on sensitive routes
6. N+1 query patterns in resolvers

### C# / .NET Support

C# requires a different parsing approach due to its syntax. Options:

#### Option A: Regex-Based (Like Current Approach)
```javascript
// C# class detection
const csClassRegex = /(?:public|private|internal|protected)\s+(?:static|abstract|sealed|partial)?\s*class\s+(\w+)/g;

// C# interface detection
const csInterfaceRegex = /(?:public|internal)\s+interface\s+I(\w+)/g;

// C# method detection
const csMethodRegex = /(?:public|private|protected|internal)\s+(?:static|virtual|override|async)?\s*(?:Task<)?(\w+)>?\s+(\w+)\s*\(/g;
```

**Pros:** Zero dependencies, fast, portable
**Cons:** Can't handle complex C# syntax (generics, LINQ, async patterns)

#### Option B: Roslyn Integration (Via Child Process)
```javascript
// Shell out to Roslyn for deep analysis
const { execSync } = require('child_process');
const result = execSync(`RoslynSymbolExtractor.exe --file "${filePath}" --json`);
const symbols = JSON.parse(result.toString());
```

**Pros:** Full semantic analysis, type resolution
**Cons:** Requires .NET SDK installed, Windows-heavy

#### Option C: Tree-sitter Integration (Recommended for Multi-Language)
```javascript
// Using tree-sitter-cli as optional dependency
const Parser = require('tree-sitter');
const CSharp = require('tree-sitter-c-sharp');

const parser = new Parser();
parser.setLanguage(CSharp);
const tree = parser.parse(sourceCode);
```

**Pros:** Accurate AST, 100+ language grammars available
**Cons:** Native dependency (tree-sitter), compilation required

### Python Support

```javascript
// Python patterns (regex-based)
const pyClassRegex = /^class\s+(\w+)(?:\(([^)]*)\))?:/gm;
const pyFunctionRegex = /^(?:async\s+)?def\s+(\w+)\s*\(([^)]*)\)/gm;
const pyDecoratorRegex = /^@(\w+)(?:\(([^)]*)\))?/gm;
```

### Go Support

```javascript
// Go patterns
const goFuncRegex = /^func\s+(?:\((\w+)\s+\*?(\w+)\)\s+)?(\w+)\s*\(([^)]*)\)/gm;
const goStructRegex = /^type\s+(\w+)\s+struct\s*\{/gm;
const goInterfaceRegex = /^type\s+(\w+)\s+interface\s*\{/gm;
```

## Architecture for Multi-Language

```
tools/code-analyzer/
├── src/
│   ├── ast-utils.js              # Shared utilities
│   ├── symbol-extractor.js       # Base extractor (TypeScript)
│   ├── query-engine.js           # Universal query engine
│   ├── quality-gate.js           # Language-agnostic
│   ├── reporter.js               # Language-agnostic
│   │
│   ├── languages/                # NEW: Language-specific extractors
│   │   ├── typescript.js         # Current (move from symbol-extractor)
│   │   ├── csharp.js             # C# regex patterns
│   │   ├── python.js             # Python patterns
│   │   ├── go.js                 # Go patterns
│   │   └── java.js               # Java patterns
│   │
│   ├── analyzers/                # Current analyzers (Angular-focused)
│   │   ├── angular-patterns.js
│   │   ├── nestjs-patterns.js    # NEW
│   │   ├── dotnet-patterns.js    # NEW
│   │   └── ...
│   │
│   └── integrations/             # NEW: External tool bridges
│       ├── ripgrep-bridge.js     # Optional: use rg if available
│       ├── ctags-bridge.js       # Optional: use ctags if available
│       └── treesitter-bridge.js  # Optional: use tree-sitter if available
```

## Graceful Degradation Strategy

```javascript
// The analyzer should work at maximum capability based on what's available:

class LanguageDetector {
  detect(filePath) {
    const ext = path.extname(filePath);
    const map = {
      '.ts': 'typescript', '.tsx': 'typescript',
      '.js': 'javascript', '.jsx': 'javascript',
      '.cs': 'csharp',
      '.py': 'python',
      '.go': 'go',
      '.java': 'java',
      '.html': 'html',
      '.scss': 'scss', '.css': 'css',
    };
    return map[ext] || 'unknown';
  }
}

class AdaptiveExtractor {
  constructor() {
    this.hasRipgrep = this._checkBinary('rg');
    this.hasCtags = this._checkBinary('ctags');
    this.hasTreeSitter = this._checkModule('tree-sitter');
    this.hasRoslyn = this._checkBinary('RoslynSymbolExtractor');
  }

  extract(filePath, language) {
    // Best available method for each language
    if (language === 'csharp' && this.hasRoslyn) {
      return this.extractWithRoslyn(filePath);
    }
    if (this.hasTreeSitter) {
      return this.extractWithTreeSitter(filePath, language);
    }
    if (this.hasCtags) {
      return this.extractWithCtags(filePath);
    }
    // Fallback: regex-based (always available)
    return this.extractWithRegex(filePath, language);
  }
}
```

## Adding a New Language (Template)

```javascript
// tools/code-analyzer/src/languages/[language].js

const { readFileSafe, getLineNumber } = require('../ast-utils');

const PATTERNS = {
  classDecl: /your-regex-here/g,
  functionDecl: /your-regex-here/g,
  // ... add language-specific patterns
};

class LanguageExtractor {
  constructor() {
    this.symbols = [];
  }

  extractFromFile(filePath, db) {
    const content = readFileSafe(filePath);
    if (!content) return;
    
    // Extract classes
    // Extract functions
    // Extract imports
    // Add to database
  }
}

module.exports = { LanguageExtractor, PATTERNS };
```
