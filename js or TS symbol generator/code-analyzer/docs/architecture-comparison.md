# Architecture Comparison: Sidecar API vs Parikrama Code Analyzer

## Reference Architecture (erv-heart/MyFirstProject-v2/src/ai_tools_setup)

The reference project uses a **Sidecar API** pattern with a multi-tool pipeline:

```
┌──────────────────────────────────────────────────────────────────────┐
│                        SIDECAR API SERVER                             │
│                                                                      │
│  ┌─────────┐    ┌──────────────┐    ┌────────────┐    ┌──────────┐ │
│  │ ripgrep │───▶│ Universal    │───▶│ Tree-sitter│───▶│ Roslyn   │ │
│  │  (rg)   │    │   Ctags      │    │  Parser    │    │ (C#/.NET)│ │
│  └─────────┘    └──────────────┘    └────────────┘    └──────────┘ │
│       │               │                   │                 │       │
│       ▼               ▼                   ▼                 ▼       │
│  Fast text       Symbol tags         Full AST          .NET symbol  │
│  search          (functions,         parsing with      extraction   │
│  (file grep)     classes, etc)       tree queries      & analysis   │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                    MCP Server Interface                        │   │
│  │           Exposes all capabilities as MCP tools               │   │
│  └──────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────┘
```

### Pipeline Flow
1. **ripgrep (rg)** — Fast regex-based text search across entire codebase
2. **Universal Ctags** — Extract symbol tags (function/class/method definitions)
3. **Tree-sitter** — Full syntax tree parsing for structural queries
4. **Roslyn** — .NET/C# specific symbol extraction and semantic analysis
5. **SidecarAPI** — HTTP/MCP server exposing all above as queryable endpoints

### Strengths of This Approach
- Multi-language support (any language with Ctags/Tree-sitter grammar)
- Roslyn provides deep .NET semantic analysis
- Battle-tested tools (rg, ctags, tree-sitter are industry standard)
- Sidecar pattern = decoupled, can run as separate process

### Weaknesses
- Requires multiple binary installations (rg, ctags, tree-sitter CLI, Roslyn .exe)
- Platform-specific binaries (Windows/Mac/Linux builds needed)
- Heavy disk footprint (~100MB+ for all binaries)
- Complex setup for new developers
- No framework-specific analysis (Angular patterns, React hooks, etc.)
- No code quality metrics (complexity, smells, security)
- No quality gates or CI/CD integration out of the box

---

## Parikrama Code Analyzer Architecture

Our implementation uses a **Zero-Dependency Regex/Pattern** approach:

```
┌──────────────────────────────────────────────────────────────────────┐
│                    PARIKRAMA CODE ANALYZER                            │
│                                                                      │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                   Core Engine (Node.js)                        │  │
│  │                                                               │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │  │
│  │  │ AST Utils   │  │  Symbol     │  │   Query Engine       │  │  │
│  │  │ (Regex-AST) │  │  Extractor  │  │   (Fuzzy search)     │  │  │
│  │  └─────────────┘  └─────────────┘  └─────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                    Analyzers (10 modules)                      │  │
│  │                                                               │  │
│  │  ┌────────────┐ ┌──────────┐ ┌───────────┐ ┌─────────────┐  │  │
│  │  │ Complexity │ │ Angular  │ │ Security  │ │ Code Smells │  │  │
│  │  │ Metrics    │ │ Patterns │ │ Scanner   │ │ Detector    │  │  │
│  │  └────────────┘ └──────────┘ └───────────┘ └─────────────┘  │  │
│  │  ┌────────────┐ ┌──────────┐ ┌───────────┐ ┌─────────────┐  │  │
│  │  │ SCSS/CSS   │ │ Template │ │ Dep Graph │ │ Duplication │  │  │
│  │  │ Analyzer   │ │ Analyzer │ │ Builder   │ │ Detector    │  │  │
│  │  └────────────┘ └──────────┘ └───────────┘ └─────────────┘  │  │
│  │  ┌────────────┐ ┌──────────┐                                 │  │
│  │  │ Dead Code  │ │ Perf     │                                 │  │
│  │  │ Detector   │ │ Patterns │                                 │  │
│  │  └────────────┘ └──────────┘                                 │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │              Output Layer                                      │  │
│  │  ┌──────────┐  ┌──────────────┐  ┌─────────────────────────┐ │  │
│  │  │ Quality  │  │   Reporter   │  │    MCP Server           │ │  │
│  │  │  Gate    │  │ (Console/JSON)│  │  (tools exposure)      │ │  │
│  │  └──────────┘  └──────────────┘  └─────────────────────────┘ │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │              CLI Interface                                     │  │
│  │  analyze | symbols | query | gate | security | complexity     │  │
│  │  angular | css | templates | deps | smells | report           │  │
│  └───────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Feature Comparison Table

| Feature | Sidecar API (rg+ctags+tree-sitter+roslyn) | Parikrama Code Analyzer |
|---------|------------------------------------------|------------------------|
| **Installation** | Complex (multiple binaries) | Zero-install (pure Node.js) |
| **Dependencies** | rg, ctags, tree-sitter, Roslyn .exe | None (Node.js built-in only) |
| **Disk Size** | ~100-200MB (binaries) | ~50KB (source code) |
| **Setup Time** | 15-30 minutes | 0 seconds |
| **Languages** | Any (via ctags/tree-sitter grammars) | TS/JS/HTML/SCSS (focused) |
| **C# Support** | ✅ Full (Roslyn) | ❌ Not yet (extensible) |
| **NestJS Support** | ✅ (via TS tree-sitter) | ✅ (TypeScript native) |
| **Text Search** | ✅ ripgrep (fastest) | ⚠️ Node.js fs.readdir (fast enough) |
| **Symbol Extraction** | ✅ Universal Ctags | ✅ Regex-based (2929 symbols in 200ms) |
| **AST Parsing** | ✅ Tree-sitter (full AST) | ⚠️ Regex patterns (no full AST) |
| **Semantic Analysis** | ✅ Roslyn (.NET only) | ⚠️ Pattern matching (limited) |
| **Angular Patterns** | ❌ | ✅ 10 Angular-specific rules |
| **Code Complexity** | ❌ | ✅ Cyclomatic + Cognitive + MI |
| **Security Scanning** | ❌ | ✅ 12 CWE-tagged rules |
| **Code Smells** | ❌ | ✅ 13 smell categories |
| **CSS Analysis** | ❌ | ✅ Specificity, z-index, colors |
| **Template Analysis** | ❌ | ✅ A11y, performance, bindings |
| **Dependency Graph** | ❌ (manual) | ✅ Circular deps, coupling |
| **Duplication** | ❌ | ✅ Token-based detection |
| **Dead Code** | ❌ | ✅ Unused exports, unreachable |
| **Quality Gate** | ❌ | ✅ Configurable pass/fail |
| **Technical Debt** | ❌ | ✅ Effort-based estimation |
| **MCP Server** | ✅ | ✅ (added) |
| **CI/CD Integration** | ⚠️ Custom | ✅ Exit codes, JSON reports |
| **Speed (full scan)** | ~2-5 seconds | ~666ms (396 files) |
| **Cross-platform** | ⚠️ Platform binaries needed | ✅ Runs anywhere Node.js runs |
| **Offline** | ✅ | ✅ |

---

## Approach Comparison

### Sidecar API Approach
```
Request → SidecarAPI → ripgrep (text search)
                     → ctags (symbol tags)
                     → tree-sitter (AST queries)
                     → Roslyn (C# semantics)
                     → Response
```

**Philosophy:** Use best-in-class external tools for each job, orchestrate via API.

### Parikrama Approach
```
Request → Node.js Engine → Regex Pattern Matching
                         → Symbol Database (in-memory)
                         → 10 Analyzer Modules
                         → Quality Gate
                         → Response
```

**Philosophy:** Zero-dependency, framework-aware analysis with built-in quality metrics.

---

## When to Use Which

### Use Sidecar API When:
- You need **multi-language** support (C#, Python, Go, Rust, etc.)
- You need **full AST** precision for refactoring tools
- You need **semantic analysis** (type resolution, call graphs)
- You're building a **general-purpose code editor** or **IDE plugin**
- Team can manage binary dependencies

### Use Parikrama Code Analyzer When:
- You're working with **Angular/TypeScript/SCSS** projects
- You need **quality metrics** (complexity, smells, security, debt)
- You want **zero setup** — just run it
- You need **CI/CD quality gates**
- You want **framework-specific analysis** (Angular decorators, patterns)
- You want fast iteration without installing binaries
- You're running in **constrained environments** (CI runners, containers)

---

## Hybrid Approach (Recommended for Multi-Language)

For projects that need both:

```
┌─────────────────────────────────────────────────────────┐
│                   MCP Server (Unified)                    │
│                                                         │
│  ┌─────────────────────┐  ┌──────────────────────────┐ │
│  │ Parikrama Analyzer  │  │  Sidecar Tools           │ │
│  │ (Angular/TS/SCSS)   │  │  (C#/Python/others)      │ │
│  │                     │  │                          │ │
│  │ - Quality Gate      │  │  - ripgrep search        │ │
│  │ - Symbol Query      │  │  - ctags extraction      │ │
│  │ - 10 Analyzers      │  │  - tree-sitter parse     │ │
│  │ - Security Scan     │  │  - Roslyn (.NET)         │ │
│  │ - Tech Debt         │  │                          │ │
│  └─────────────────────┘  └──────────────────────────┘ │
│                                                         │
│  Routing: .ts/.html/.scss → Parikrama                   │
│           .cs/.py/.go     → Sidecar                     │
└─────────────────────────────────────────────────────────┘
```

---

## Summary

| Dimension | Sidecar (Reference) | Parikrama (Ours) | Winner |
|-----------|--------------------|--------------------|--------|
| Setup ease | ❌ Complex | ✅ Zero | Parikrama |
| Multi-language | ✅ Broad | ⚠️ TS/JS/HTML/CSS | Sidecar |
| AST accuracy | ✅ Full tree | ⚠️ Regex-based | Sidecar |
| Quality metrics | ❌ None | ✅ Comprehensive | Parikrama |
| Framework awareness | ❌ Generic | ✅ Angular-specific | Parikrama |
| Security scanning | ❌ None | ✅ CWE-tagged | Parikrama |
| Speed | Good | ✅ Faster (no IPC) | Parikrama |
| Portability | ⚠️ Binaries | ✅ Pure JS | Parikrama |
| CI/CD ready | ⚠️ Custom | ✅ Built-in | Parikrama |
| Maintenance | High (binaries) | Low (single source) | Parikrama |
