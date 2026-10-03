# Gap Analysis V2: code-analyzer vs ai_tools_setup (Sidecar API)

**Date:** August 12, 2026  
**Analyzed:** Full source code of `ai_tools_setup/sidecar-api/src/` (12 handlers, 4 services, 4 utilities, 1 MCP server)

---

## Complete Feature Inventory

### ai_tools_setup/sidecar-api — 17 Capabilities

| # | Capability | Implementation | Token Cost | Purpose |
|---|-----------|---------------|-----------|---------|
| 1 | Full-text regex search | `searchService.js` → spawns `rg` binary | ~400 chars/query | Find where text appears across codebase |
| 2 | Symbol lookup (merged Roslyn+ctags) | `symbolService.js` → 27,544 pre-extracted symbols | ~200 chars | Get Kind/Name/Location/Line/Signature |
| 3 | Code snippet (±N lines) | `snippetService.js` → fs.readFileSync + slice | ~600 chars | See code around a specific line |
| 4 | Signature-only declaration | `signatureHandler.js` → walks forward to `{` or `;` | ~80 chars | Cheapest: just the declaration, no body |
| 5 | File outline (grouped, no bodies) | `outlineHandler.js` → ctags+Roslyn merged per file | ~200-400 chars | Understand file structure without reading it |
| 6 | Caller graph (find all usages) | `callersHandler.js` → rg + filter definitions + annotate enclosing | ~400 chars | Who calls this method? |
| 7 | Git diff context (annotated) | `diffContextHandler.js` → `git diff` + parseDiff + symbol annotation | ~600 chars | What changed? In which method? |
| 8 | AST node extraction (tree-sitter) | `astService.js` → tree-sitter-c-sharp parse → node traversal | ~400 chars | Get exact method body, clean |
| 9 | LLM context composition | `composeContextHandler.js` → orchestrates rg+symbols+snippets | ~800-2000 chars | Token-budgeted bundle for LLM prompts |
| 10 | Token analytics | `tokenAnalytics.js` → middleware measuring reduction % | n/a | Track savings vs whole-file baseline |
| 11 | LRU cache with TTL | `cache.js` → `node-cache` package, 1-hour TTL, key generation | n/a | Avoid re-computation |
| 12 | Auto-refresh on source change | `refreshHandler.js` middleware → `git diff --name-only` | n/a | Detect changes, re-index symbols |
| 13 | Tool executor (child process) | `toolExecutor.js` → spawn/execSync with error handling | n/a | Clean abstraction for external tools |
| 14 | Structured logging (Winston) | `logger.js` → combined.log + error.log | n/a | Persistent, level-based logging |
| 15 | Express REST API (11 routes) | `index.js` → CORS + body-parser + error handling | n/a | HTTP access from any client |
| 16 | MCP Server (12 tools) | `mcpServer.js` → stdio JSON-RPC → HTTP forward to Express | n/a | AI agent integration |
| 17 | Scheduled refresh (Windows Task) | `register_refresh_task.ps1` → schtasks every N hours | n/a | Keep index fresh |

### tools/code-analyzer — 17 Capabilities (Current)

| # | Capability | Implementation | Purpose |
|---|-----------|---------------|---------|
| 1 | Symbol extraction (regex) | `symbol-extractor.js` → 2,929 symbols from TS/JS | Extract classes, methods, decorators |
| 2 | Symbol query (fuzzy) | `query-engine.js` → search by name/type/file/decorator | Find symbols |
| 3 | Cyclomatic complexity | `complexity.js` → decision point counting | McCabe metric |
| 4 | Cognitive complexity | `complexity.js` → SonarQube algorithm (nesting penalty) | Human-readable complexity |
| 5 | Maintainability Index | `complexity.js` → Microsoft MI formula | A-E rating |
| 6 | Angular pattern analysis | `angular-patterns.js` → 10 Angular-specific rules | Change detection, leaks, lifecycle |
| 7 | Code smell detection | `code-smells.js` → 13 smell types + effort estimate | Long methods, god classes, magic numbers |
| 8 | Security scanning | `security.js` → 12 CWE-tagged vulnerability rules | Hardcoded secrets, XSS, unsafe eval |
| 9 | SCSS/CSS analysis | `scss-analyzer.js` → specificity, colors, z-index | Style quality |
| 10 | HTML template analysis | `template-analyzer.js` → a11y, perf, bindings | Accessibility + performance |
| 11 | Dependency graph | `dependency-graph.js` → circular deps, coupling | Architecture health |
| 12 | Code duplication | `duplication.js` → token-based block comparison | DRY violations |
| 13 | Dead code detection | `dead-code.js` → unused exports, unreachable | Remove waste |
| 14 | Performance patterns | `performance.js` → RxJS, memory leaks, lazy loading | Angular perf anti-patterns |
| 15 | Quality gate | `quality-gate.js` → configurable pass/fail conditions | CI/CD gate |
| 16 | MCP Server (10 tools) | `mcp-server.js` → @modelcontextprotocol/sdk | AI agent integration |
| 17 | CLI (12 commands) | `cli.js` → colored terminal output | Developer UX |

---

## Detailed Gap Analysis

### 🔴 CRITICAL GAPS — Must Add (directly impact LLM context efficiency)

#### Gap 1: Code Snippet Retrieval
- **Sidecar:** `GET /snippet?file=X&line=N` → returns ±5 lines with highlighted target
- **Us:** No equivalent. Our MCP returns full analysis results but can't show "lines 45-55 of file X"
- **Impact:** LLMs can't view specific code locations. Must read entire files instead.
- **Implementation:** Read file → slice lines[start-context .. end+context] → return with line numbers
- **Effort:** 1 hour

#### Gap 2: Signature-Only Lookup (Declaration Text)
- **Sidecar:** `GET /signature?query=X` → returns 1-3 lines declaration, ~80 chars. Walks forward from symbol line until `{` or `;`
- **Us:** `query_symbols` returns metadata (type, file, line) but NOT the actual declaration text
- **Impact:** LLMs get "ThemeService at line 763" but can't see `export class ThemeService implements OnInit {`
- **Implementation:** After finding symbol line, read forward until `{` or `;`, return those lines
- **Effort:** 2 hours

#### Gap 3: File Outline (No Code Bodies)
- **Sidecar:** `GET /outline?file=X` → all symbols grouped by class, with kind+line. ~200 chars for 500-line file
- **Us:** `symbols --type=...` can list by type but not "all symbols in file X grouped by parent class"
- **Impact:** LLMs can't quickly understand a file's structure without reading it
- **Implementation:** Filter symbol DB by file → group methods under their parentClass → return structured
- **Effort:** 2 hours

#### Gap 4: Caller Graph / Find All Usages
- **Sidecar:** `GET /callers?name=X` → ripgrep for X → filter out definitions → annotate each hit with enclosing symbol
- **Us:** `findUsages()` in query-engine exists but only checks import statements, not actual call sites
- **Impact:** "Who calls saveTheme()?" requires manual grep. LLM can't efficiently trace call paths.
- **Implementation:** Search all files for `symbolName(` pattern → exclude declaration lines → find enclosing method for each hit
- **Effort:** 3 hours

#### Gap 5: Git Diff Context (Annotated Changes)
- **Sidecar:** `GET /diff-context` → `git diff --unified=3` → parse hunks → annotate each with enclosing symbol. 20-50x smaller than full files.
- **Us:** No equivalent
- **Impact:** Code review without this requires reading entire changed files. Massive token waste.
- **Implementation:** Execute `git diff` → parse unified diff format → for each hunk find nearest symbol above start line
- **Effort:** 4 hours

#### Gap 6: LLM Context Composer (Token-Budgeted)
- **Sidecar:** `POST /compose-context` → 3 modes (compact/signatures/full). Pipeline: rg → symbols → snippets/signatures. Stops when token budget reached.
- **Us:** No equivalent. Each MCP tool returns independently; no orchestrated bundle.
- **Impact:** LLMs must make 3-5 separate tool calls and manually assemble context. Wastes agent turns.
- **Implementation:** Orchestrate: search → resolve symbols → fetch signatures or snippets → budget-cap → return single bundle
- **Effort:** 5 hours

#### Gap 7: Token Analytics (Savings Measurement)
- **Sidecar:** Middleware on every response. Compares actual response size vs "whole file baseline" (3750 tokens). Tracks per-endpoint stats + rolling history.
- **Us:** No measurement of how efficient our responses are
- **Impact:** Can't prove or improve token efficiency. No feedback loop.
- **Implementation:** Wrap each MCP tool call with baseline estimation → calculate reduction % → accumulate stats
- **Effort:** 3 hours

---

### 🟡 IMPORTANT GAPS — Should Add (infrastructure & reliability)

#### Gap 8: Proper LRU Cache with TTL
- **Sidecar:** `node-cache` package, 1-hour TTL, generated composite keys, `flush()` method
- **Us:** `queryEngine` rebuilds index every 60s (brute force). No caching of individual lookups.
- **Impact:** Repeated queries re-scan the filesystem. Slower for interactive use.
- **Effort:** 2 hours

#### Gap 9: Tool Executor Abstraction
- **Sidecar:** `toolExecutor.js` — clean spawn/execSync wrapper with error handling, Windows-safe, logging
- **Us:** We don't spawn external tools (by design). But if we add rg/git bridges, we need this.
- **Impact:** Future extensibility blocker
- **Effort:** 1 hour

#### Gap 10: Auto-Refresh on Source Changes
- **Sidecar:** Middleware on every request runs `git diff --name-only HEAD -- "*.cs"` with 30s debounce
- **Us:** `INDEX_TTL = 60000` (60s hard rebuild). No change detection.
- **Impact:** After editing a file, queries return stale data for up to 60s
- **Effort:** 2 hours (use `git diff --name-only` for .ts/.html/.scss)

#### Gap 11: Express REST API
- **Sidecar:** Full Express server (11 routes, CORS, body-parser, error handling, 404)
- **Us:** CLI + MCP only. No HTTP access.
- **Impact:** Can't integrate with VS Code extensions, browser tools, or other HTTP clients
- **Effort:** 3 hours

#### Gap 12: Structured Logging
- **Sidecar:** Winston logger → `combined.log` + `error.log`, configurable levels via env
- **Us:** `console.log` only. No persistent logs.
- **Impact:** Can't debug issues in background MCP server
- **Effort:** 1 hour (can use simple file append, no need for Winston)

---

### 🟢 NICE-TO-HAVE GAPS — Low Priority

#### Gap 13: AST Node Extraction (tree-sitter)
- **Sidecar:** `astService.js` → tree-sitter-c-sharp. Returns exact method body with start/end positions.
- **Us:** Regex extracts method signatures but not clean bodies. `extractBlock()` exists but crude.
- **Impact:** When LLM needs a full method body, our extraction may include noise
- **Effort:** 4 hours (add `tree-sitter` + `tree-sitter-typescript` as optional deps)

#### Gap 14: Scheduled Re-indexing (Windows Task)
- **Sidecar:** `register_refresh_task.ps1` → Windows schtasks every N hours
- **Us:** No scheduled task. Index refreshes on use (60s TTL).
- **Impact:** Minor — our 60s TTL is adequate for interactive use
- **Effort:** 1 hour

#### Gap 15: Symbol Enrichment Pipeline
- **Sidecar:** rg results enriched with ctags (enclosing symbol) + Roslyn (Kind/Signature)
- **Us:** Our search results are flat regex matches without symbol context
- **Impact:** When using grep/search, results lack "which class/method owns this line"
- **Effort:** 2 hours (reuse our symbol DB to find enclosing class for a given file:line)

#### Gap 16: Health Check Endpoint
- **Sidecar:** `GET /health` → checks symbols.json, ctags file, disk availability
- **Us:** No health check (MCP has no equivalent concept)
- **Impact:** Can't diagnose "why isn't the analyzer working?"
- **Effort:** 30 minutes

---

## Features We Have That Sidecar DOESN'T

| # | Feature | Value |
|---|---------|-------|
| 1 | Quality Gate (pass/fail with exit codes) | CI/CD enforcement |
| 2 | Cyclomatic + Cognitive Complexity | File-level metrics |
| 3 | Maintainability Index (A-E) | Quick health indicator |
| 4 | Security scanning (12 CWE rules) | Vulnerability detection |
| 5 | Code smell detection (13 types) | Maintenance issues |
| 6 | Technical debt estimation | Business impact |
| 7 | Angular pattern analysis (10 rules) | Framework-specific guidance |
| 8 | CSS/SCSS analysis (specificity, colors) | Style quality |
| 9 | HTML template analysis (a11y, perf) | Accessibility compliance |
| 10 | Dependency graph (circular, coupling) | Architecture health |
| 11 | Code duplication detection | DRY violations |
| 12 | Dead code detection | Cleanup guidance |
| 13 | Performance pattern detection | Runtime optimization |
| 14 | Multi-file analysis (396 files in 666ms) | Project-wide scan |
| 15 | JSON report generation | Artifact storage |
| 16 | 12-command CLI with colored output | Developer UX |

---

## Priority Matrix

```
                    HIGH VALUE
                       │
  ┌────────────────────┼────────────────────┐
  │                    │                    │
  │  Context Composer  │  Signature Lookup  │
  │  Caller Graph      │  File Outline      │
  │  Diff Context      │  Snippet Service   │
  │                    │                    │
  │     HARD ──────────┼──────────── EASY   │
  │                    │                    │
  │  Tree-sitter       │  Token Analytics   │
  │  REST API          │  LRU Cache         │
  │  Auto-refresh      │  Health Check      │
  │                    │                    │
  └────────────────────┼────────────────────┘
                       │
                    LOW VALUE
```

---

## Implementation Roadmap

### Sprint 1 — Core Context Serving (estimated: 1 day)
| Task | Description | Effort |
|------|-------------|--------|
| Snippet Service | `get_snippet(file, line, context)` → ±N lines | 1h |
| Signature Service | `get_signature(symbolName)` → declaration text only | 2h |
| File Outline | `get_outline(file)` → grouped symbols, no bodies | 2h |
| Add to MCP | 3 new tools in mcp-server.js | 1h |

### Sprint 2 — Advanced Context (estimated: 1.5 days)
| Task | Description | Effort |
|------|-------------|--------|
| Caller Graph | `get_callers(name)` → all call sites + enclosing method | 3h |
| Diff Context | `get_diff_context(base)` → git diff + symbol annotation | 4h |
| Context Composer | `compose_context(query, maxTokens, mode)` → budgeted bundle | 5h |

### Sprint 3 — Infrastructure (estimated: 0.5 day)
| Task | Description | Effort |
|------|-------------|--------|
| Token Analytics | Measure response size vs baseline, track stats | 3h |
| LRU Cache | Replace 60s rebuild with proper key-based cache | 2h |

### Sprint 4 — Optional Extensions (estimated: 1 day)
| Task | Description | Effort |
|------|-------------|--------|
| Auto-refresh | Git diff detect → re-index on change | 2h |
| Express REST API | Optional HTTP server wrapping all tools | 3h |
| Tool Executor | Spawn rg/git cleanly (for diff-context) | 1h |
| Structured Logging | File-based logger | 1h |

---

## Token Efficiency Target

After implementing Sprint 1+2, our tool should match the sidecar's efficiency:

| Query Type | Current (code-analyzer) | After Gaps Filled | Sidecar |
|------------|------------------------|-------------------|---------|
| "What's in file X?" | Read file (~15000 ch) | `/outline` → 200-400 ch | 200-400 ch |
| "What does Y look like?" | `query Y` → 200 ch metadata | `/signature` → 80 ch | 80 ch |
| "Show me line 45" | Not possible | `/snippet` → 600 ch | 600 ch |
| "Who calls Z?" | Not possible | `/callers` → 400 ch | 400 ch |
| "What changed?" | Not possible | `/diff-context` → 600 ch | 600 ch |
| "LLM context for Q" | 3-5 tool calls | `/compose-context` → 800-2000 ch | 800-2000 ch |

**Target: Feature parity on context serving + our quality analysis advantages.**
