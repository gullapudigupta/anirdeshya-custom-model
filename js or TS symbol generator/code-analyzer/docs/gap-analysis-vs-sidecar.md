# Gap Analysis: code-analyzer vs ai_tools_setup (Sidecar API)

## Full Feature Comparison

### ai_tools_setup Features (11 endpoints + MCP)

| # | Feature | Endpoint | What It Does |
|---|---------|----------|--------------|
| 1 | **Full-text search** (ripgrep) | `GET /search` | Fast regex search via `rg` binary, returns file/line/column/matches |
| 2 | **Symbol lookup** (Roslyn + ctags merged) | `GET /symbols` | 27,544 C# symbols with Kind, Name, Location, Line, Signature |
| 3 | **Code snippet** | `GET /snippet` | Lines ±5 context around a given line number |
| 4 | **Signature only** | `GET /signature` | Declaration line only (~80 chars) — cheapest lookup |
| 5 | **File outline** | `GET /outline` | All classes/methods/properties with line numbers, no bodies |
| 6 | **Caller graph** | `GET /callers` | All call-sites of a method + enclosing symbol |
| 7 | **Diff context** | `GET /diff-context` | Git diff annotated with enclosing symbol per hunk |
| 8 | **AST node extraction** (tree-sitter) | `GET /ast-node` | Full method/class body via tree-sitter parse |
| 9 | **Context composition** | `POST /compose-context` | LLM-ready bundle (compact/signatures/full modes) |
| 10 | **Auto-refresh** | Middleware | Detects source changes via `git diff`, re-indexes |
| 11 | **Token analytics** | `GET /analytics` | Measures token savings vs whole-file baseline |
| 12 | **MCP Server** | stdio JSON-RPC | All 11 tools exposed via MCP protocol |
| 13 | **LRU Cache** | In-memory | 1-hour TTL, generated key per request |
| 14 | **Winston logging** | File-based | combined.log + error.log |
| 15 | **Express REST API** | HTTP | Port 3001, CORS, body parser |
| 16 | **Scheduled refresh** | Windows Task | Register/unregister auto-refresh every N hours |
| 17 | **Tool executor** | Child process | Spawns rg, git, ctags as child processes |

### code-analyzer Features (12 commands + MCP)

| # | Feature | Command/Tool | What It Does |
|---|---------|-------------|--------------|
| 1 | **Symbol extraction** | `symbols` / `query_symbols` | 2,929 Angular/TS symbols with type, decorator, metadata |
| 2 | **Symbol search** | `query` / `query_symbols` | Fuzzy search by name/type/file/decorator |
| 3 | **Complexity metrics** | `complexity` / `get_file_complexity` | Cyclomatic + Cognitive + Maintainability Index |
| 4 | **Angular patterns** | `angular` / `get_angular_issues` | 10 Angular-specific rules (change detection, leaks) |
| 5 | **Code smells** | `smells` / `find_code_smells` | 13 smell types with effort estimation |
| 6 | **Security scanning** | `security` / `check_security` | 12 CWE-tagged rules |
| 7 | **CSS/SCSS analysis** | `css` / `analyze_styles` | Specificity, colors, z-index, nesting |
| 8 | **Template analysis** | `templates` / `analyze_template` | A11y, performance, bindings |
| 9 | **Dependency graph** | `deps` / `get_dependencies` | Circular deps, coupling, orphans |
| 10 | **Code duplication** | (integrated in analyze) | Token-based block comparison |
| 11 | **Dead code detection** | (integrated in analyze) | Unused exports, unreachable |
| 12 | **Performance patterns** | (integrated in analyze) | RxJS, memory leaks, lazy loading |
| 13 | **Quality gate** | `gate` / `check_quality_gate` | Pass/fail with configurable thresholds |
| 14 | **Technical debt** | (in smells) | Effort-based estimation (days/hours) |
| 15 | **MCP Server** | `mcp-server.js` | 10 tools exposed via MCP |
| 16 | **JSON reports** | `reports/` | Full analysis saved as JSON |
| 17 | **CLI interface** | `cli.js` | 12 commands with colored output |

---

## Features MISSING from code-analyzer (that ai_tools_setup has)

### 🔴 Critical Gaps (Must Add)

| # | Missing Feature | Sidecar Has | Why Important |
|---|----------------|-------------|---------------|
| 1 | **Code snippet retrieval** | `/snippet` | Get ±N context lines around any line — essential for LLM context |
| 2 | **Signature-only lookup** | `/signature` | Declaration text without body (~80 chars) — cheapest for LLM |
| 3 | **File outline (no bodies)** | `/outline` | Structured overview: all symbols with kind + line, grouped by class |
| 4 | **Caller graph / Find usages** | `/callers` | "Who calls this method?" across entire codebase |
| 5 | **Git diff context** | `/diff-context` | Changed lines annotated with enclosing symbol — essential for code review |
| 6 | **Context composition for LLM** | `/compose-context` | Token-budgeted bundle in 3 verbosity modes (compact/signatures/full) |
| 7 | **Token analytics** | `/analytics` | Measure token savings per request vs whole-file baseline |

### 🟡 Important Gaps (Should Add)

| # | Missing Feature | Sidecar Has | Why Important |
|---|----------------|-------------|---------------|
| 8 | **Full-text search** (ripgrep integration) | `/search` | Our fs.readdir+regex is slower than rg for large repos |
| 9 | **AST node extraction** (tree-sitter) | `/ast-node` | Extract exact method body without surrounding code |
| 10 | **Auto-refresh on source change** | Middleware | Detect file changes and re-index automatically |
| 11 | **LRU cache with TTL** | `node-cache` | Our in-memory index rebuilds every 60s, no proper LRU |
| 12 | **REST API server** (Express HTTP) | Express | Our tool is CLI + MCP only, no HTTP API |
| 13 | **Structured logging** (Winston) | Winston | We use console.log, no persistent logs |

### 🟢 Nice-to-Have Gaps

| # | Missing Feature | Sidecar Has | Why Important |
|---|----------------|-------------|---------------|
| 14 | **Scheduled re-indexing** (Windows Task) | PS1 script | Automated refresh on schedule |
| 15 | **Tool executor abstraction** | `toolExecutor.js` | Clean child_process wrapper for external tools |
| 16 | **Health check endpoint** | `/health` | Resource availability check |
| 17 | **Symbol enrichment pipeline** | `enrichSearchResults` | rg results enriched with ctags+Roslyn symbol info |

---

## Features code-analyzer HAS that ai_tools_setup DOESN'T

| # | Our Feature | Why Sidecar Doesn't Have It |
|---|-------------|---------------------------|
| 1 | Quality Gate (pass/fail) | Sidecar is for serving, not judging |
| 2 | Cyclomatic complexity | Not a code intelligence concern |
| 3 | Cognitive complexity | SonarQube-style, not needed for serving |
| 4 | Security scanning (CWE) | Different purpose (analysis vs serving) |
| 5 | Code smell detection | Quality analysis |
| 6 | Technical debt estimation | Quality metric |
| 7 | Angular pattern analysis | Framework-specific |
| 8 | CSS/SCSS analysis | Language-specific |
| 9 | HTML template analysis | Language-specific |
| 10 | A11y checking | Quality concern |
| 11 | Dependency graph | Architectural analysis |
| 12 | Code duplication | Quality metric |
| 13 | Dead code detection | Quality metric |
| 14 | Performance patterns | Quality metric |
| 15 | Maintainability Index | Rating system |
| 16 | CLI with 12 commands | Developer UX |

---

## Implementation Plan for Missing Features

### Priority 1: LLM Context Features (from Sidecar)

```
tools/code-analyzer/src/
  ├── services/                    # NEW folder
  │   ├── snippet-service.js      # Get code lines ±N context
  │   ├── signature-service.js    # Declaration-only lookup
  │   ├── outline-service.js      # File structure (no bodies)
  │   ├── callers-service.js      # Find all call-sites
  │   ├── diff-context-service.js # Git diff + symbol annotation
  │   └── context-composer.js     # LLM context bundle builder
  │
  ├── utils/                       # NEW folder
  │   ├── cache.js                # LRU cache with TTL
  │   ├── token-analytics.js      # Token reduction measurement
  │   └── tool-executor.js        # Child process wrapper (rg, git)
  │
  └── api/                         # NEW folder
      └── server.js               # Express REST API (optional)
```

### Priority 2: Infrastructure

- **LRU Cache** — Replace 60s TTL with proper LRU (use `node-cache` or implement)
- **Auto-refresh** — Watch for .ts/.html/.scss changes via `fs.watch` or git diff
- **Logging** — Add structured logging (Winston or simpler)
- **REST API** — Optional Express server for IDE/plugin integration

### Priority 3: Tool Integration (Optional)

- **ripgrep bridge** — Use `rg` if available, fallback to Node.js regex
- **tree-sitter bridge** — Use tree-sitter for accurate method extraction if installed
- **ctags bridge** — Use Universal Ctags if available for broader language support

---

## Token Efficiency Comparison

| Operation | Sidecar (optimized) | Code-analyzer (current) | Gap |
|-----------|--------------------|-----------------------|-----|
| "What's in this file?" | `/outline` → 200 chars | `symbols --type=...` → 500 chars | Need outline |
| "What does X look like?" | `/signature` → 80 chars | `query X` → 200 chars | Need signature mode |
| "Full method body" | `/ast-node` → 400 chars | No equivalent | Need AST extract |
| "Who calls X?" | `/callers` → 400 chars | No equivalent | Need callers |
| "What changed?" | `/diff-context` → 600 chars | No equivalent | Need diff-context |
| "LLM context" | `/compose-context` → 800 chars | No equivalent | Need composer |
| "Search for pattern" | `/search` → rg speed | grep_search (tool) | Adequate |

**Key insight:** The sidecar is optimized for **token efficiency** — giving LLMs exactly what they need in minimal tokens. Our analyzer gives **quality insights** but lacks the context-serving infrastructure.

---

## Recommended Roadmap

### Phase 1: Core Context Features (1-2 days)
- [ ] Snippet service (file + line → ±N context)
- [ ] Signature service (symbol → declaration only)
- [ ] Outline service (file → all symbols, no bodies)
- [ ] Add to MCP server as new tools

### Phase 2: Advanced Context (2-3 days)
- [ ] Callers/Find-usages service
- [ ] Git diff-context service
- [ ] Context composer (token-budgeted LLM bundles)
- [ ] Token analytics middleware

### Phase 3: Infrastructure (1-2 days)
- [ ] LRU cache with proper TTL
- [ ] Auto-refresh on file change
- [ ] Optional Express REST API
- [ ] Structured logging

### Phase 4: External Tool Integration (optional, 1-2 days)
- [ ] ripgrep bridge (use if available)
- [ ] tree-sitter bridge (use if available)
- [ ] Health check endpoint with resource status
