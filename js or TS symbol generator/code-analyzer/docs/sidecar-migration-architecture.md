# Sidecar + Code Analyzer: Unified Architecture

## Overview

This document describes the architecture after migrating the AI Sidecar from
`ai_tools_setup/sidecar-api/` into `tools/code-analyzer/ai_tools_setup/`. The
result is a consolidated tools directory with three MCP server options.

---

## Architecture Diagram

```
tools/code-analyzer/
├── mcp-server-unified.js        ← COMBINED: 16 tools (6 context + 10 analysis)
├── mcp-server-analyzer.js       ← STANDALONE: 10 quality analysis tools only
├── ai_tools_setup/              ← SIDECAR: C#/Roslyn/ctags context server
│   ├── mcp-server.js            ← STANDALONE: 12 sidecar tools (proxies to API)
│   ├── src/index.js             ← Express REST API on port 3001
│   ├── src/handlers/            ← Route handlers (12 endpoints)
│   ├── src/services/            ← C# services (Roslyn, search, AST)
│   ├── src/utils/               ← Cache, logger, token analytics, tool executor
│   ├── RoslynSymbolExtractor/   ← .NET tool for C# symbol extraction
│   ├── symbols/symbols.json     ← Roslyn-extracted C# symbols
│   └── artifacts/tags           ← ctags index
├── src/
│   ├── analyzers/               ← Quality analysis (Angular/TS/SCSS/HTML)
│   ├── services/                ← Context serving (TS/Angular reimplementation)
│   ├── utils/                   ← LRU cache, auto-refresh, token analytics
│   └── ...
└── docs/
```

---

## MCP Server Options

### 1. Combined Server (DEFAULT — Active)

**File:** `tools/code-analyzer/mcp-server-unified.js`
**Tools:** 16 (6 context serving + 10 quality analysis)
**Language:** TypeScript/Angular/HTML/SCSS

This is the primary MCP server for the Parikrama project. It provides:
- Context serving (snippet, signature, outline, callers, diff-context, compose)
- Quality analysis (complexity, security, smells, Angular patterns, etc.)

```json
{
  "command": "node",
  "args": ["tools/code-analyzer/mcp-server-unified.js"]
}
```

### 2. Code Analyzer Only (Standalone — Disabled)

**File:** `tools/code-analyzer/mcp-server-analyzer.js`
**Tools:** 10 quality analysis tools
**Language:** TypeScript/Angular/HTML/SCSS

Use when you only need quality analysis without context serving.

```json
{
  "command": "node",
  "args": ["tools/code-analyzer/mcp-server-analyzer.js"]
}
```

### 3. Sidecar Only (Standalone — Disabled)

**File:** `tools/code-analyzer/ai_tools_setup/mcp-server.js`
**Tools:** 12 C#/Roslyn context tools
**Language:** C#/.NET
**Requires:** Express API running on port 3001

Use for C# projects that need Roslyn symbol resolution, tree-sitter C# parsing,
and ripgrep-powered search with symbol enrichment.

```json
{
  "command": "node",
  "args": ["tools/code-analyzer/ai_tools_setup/mcp-server.js"]
}
```

**Starting the API:**
```bash
cd tools/code-analyzer/ai_tools_setup
npm install
npm start    # Starts Express on port 3001
```

---

## API Endpoints (Sidecar REST — Port 3001)

| Method | Endpoint | Description | Token Cost |
|--------|----------|-------------|------------|
| GET | `/health` | API status + resource check | — |
| GET | `/search?q=...` | Ripgrep full-text search + symbol enrichment | ~150 tokens |
| GET | `/symbols?query=...` | Roslyn + ctags merged symbol lookup | ~200 tokens |
| GET | `/snippet?file=...&start=N` | Code lines ±5 context | ~150 tokens |
| GET | `/signature?query=...` | Declaration only (~80 chars) | ~20 tokens |
| GET | `/outline?file=...` | File structure, no bodies | ~75 tokens |
| GET | `/callers?name=...` | All call-sites of a method | ~100 tokens |
| GET | `/diff-context` | Changed lines + enclosing symbol | ~150 tokens |
| GET | `/ast-node?file=...` | Tree-sitter method/class extraction | ~100 tokens |
| GET | `/analytics` | Token savings statistics | — |
| POST | `/compose-context` | Token-budgeted LLM bundle | ~300 tokens |
| POST | `/refresh` | Re-run Roslyn + ctags | — |

---

## Cross-Project Compatibility (Roslyn Analyzer)

The Roslyn Symbol Extractor remains in `ai_tools_setup/RoslynSymbolExtractor/`.
It provides:

- **27,544+ C# symbols** extracted via Microsoft.CodeAnalysis
- **Output formats:** JSON (symbols.json) and ctags (extended format)
- **Symbol types:** Classes, structs, interfaces, enums, methods, properties, fields, delegates, namespaces
- **Cross-project:** Works with any .sln or .csproj — not tied to one repo

### Running the Extractor

```powershell
# Direct (if .exe is compiled)
.\tools\code-analyzer\ai_tools_setup\RoslynSymbolExtractor\bin\Release\net48\RoslynSymbolExtractor.exe "path\to.sln" "output.json" --json

# Via script
powershell -File tools\code-analyzer\ai_tools_setup\run_symbol_extractor.ps1
```

### Why Keep Roslyn in Sidecar

1. **Language boundary:** Roslyn = C# only. The code-analyzer handles TypeScript/Angular.
2. **Dependencies:** Roslyn needs .NET Framework 4.8+, tree-sitter-c-sharp needs native bindings
3. **Portability:** The sidecar can be pointed at ANY C# solution by changing `REPO_ROOT`
4. **Separation of concerns:** Quality analysis (linting, smells) vs context serving (symbols, navigation)

---

## Token Reduction Strategy

### Whole-File vs Sidecar Approach

| Lookup | Whole File | Sidecar | Reduction |
|--------|-----------|---------|-----------|
| "What does X look like?" | ~3,750 tokens | ~20 tokens (`/signature`) | **99.5%** |
| "What's in this file?" | ~3,750 tokens | ~75 tokens (`/outline`) | **98%** |
| "Show me line 42" | ~3,750 tokens | ~150 tokens (`/snippet`) | **96%** |
| "Who calls X?" | ~15,000 tokens | ~100 tokens (`/callers`) | **99.3%** |
| "What changed?" | ~50,000 tokens | ~150 tokens (`/diff-context`) | **99.7%** |

### Decision Guide

```
"Where is X defined?"          → query_symbols (code-analyzer)
"What does X look like?"       → get_signature ← cheapest
"What is in file Y?"           → get_outline   ← no bodies
"Full body of method X?"       → get_snippet with context=15
"Who calls X?"                 → get_callers
"What changed?"                → get_diff_context
"LLM context bundle"           → compose_context
"Is the code quality OK?"      → check_quality_gate
"Security issues?"             → check_security
"Angular anti-patterns?"       → get_angular_issues
```

---

## Deduplication Analysis

### Services That Are NOT Duplicates

| Module | code-analyzer (TS/Angular) | ai_tools_setup (C#/Roslyn) |
|--------|---------------------------|----------------------------|
| Snippet | Reads `.ts`, `.html`, `.scss` | Reads `.cs` via Roslyn paths |
| Signature | QueryEngine + TS AST | SymbolService (Roslyn+ctags) |
| Outline | Angular decorators, components | C# classes, methods, properties |
| Callers | Regex file scan for TS | Ripgrep + ctags enrichment |
| Diff | Filters `.ts,.html,.scss` | Filters `.cs` only |
| Compose | QueryEngine-based | Roslyn + ripgrep + snippet |
| Cache | Custom LRU (LRUCache class) | node-cache with TTL |
| Analytics | TokenAnalytics class | Express middleware |

**Conclusion:** These are parallel implementations for different languages.
Both must remain for their respective project types.

### What Was Removed as True Duplicates

- The old sidecar `src/mcp/mcpServer.js` (JSON-RPC proxy) was not copied into
  the unified server — it's replaced by the new `ai_tools_setup/mcp-server.js`
- The original `ai_tools_setup/` directory is marked for deletion via `MOVED.md`

---

## Setup Instructions

### Initial Setup (New Machine)

```bash
# 1. Install code-analyzer dependencies (no npm install needed — pure Node.js)
# 2. Install sidecar dependencies
cd tools/code-analyzer/ai_tools_setup
npm install

# 3. (Optional) Run Roslyn extractor if you have a C# solution
powershell -File run_symbol_extractor.ps1

# 4. (Optional) Generate ctags
ctags -R --languages=C# --output-format=json -f artifacts/tags <repo-root>
```

### Switching MCP Servers

Edit `.kiro/settings/mcp.json`:
- **Default:** `"code-analyzer"` (combined, 16 tools) — already active
- **C# project work:** Enable `"sidecar"`, start the API first
- **Analysis only:** Enable `"code-analyzer-only"`, disable `"code-analyzer"`

---

## Migration Checklist

- [x] Copy sidecar source to `tools/code-analyzer/ai_tools_setup/`
- [x] Update config paths for new location
- [x] Create separate MCP server for sidecar (proxy to REST API)
- [x] Create separate MCP server for code-analyzer (standalone)
- [x] Keep combined MCP server as default (already existed)
- [x] Copy RoslynSymbolExtractor for cross-project compatibility
- [x] Copy symbols.json and tags artifacts
- [x] Copy setup scripts (run_symbol_extractor, register_refresh_task)
- [x] Update .kiro/settings/mcp.json with all three servers
- [x] Mark old ai_tools_setup for deletion (MOVED.md)
- [x] Verify no true duplicate code between TS and C# implementations
- [x] Create comprehensive documentation

---

## What You Get With This Approach

### Benefits

1. **Single `tools/` directory** — All development tooling lives in one place
2. **Three MCP server options** — Combined (default), analyzer-only, sidecar-only
3. **Language separation** — TypeScript analysis and C# analysis don't interfere
4. **Cross-project Roslyn** — The extractor works with any C# solution
5. **Token efficiency** — 96-99.7% reduction vs reading whole files
6. **REST API preserved** — The Express server still works on port 3001 for IDE plugins
7. **Auto-refresh** — Both systems detect source changes and re-index
8. **Shared infrastructure** — Both use similar caching, analytics, and logging patterns

### Trade-offs

1. **Two install steps** — code-analyzer is zero-install, sidecar needs `npm install`
2. **Sidecar requires API running** — Must start Express before using sidecar MCP
3. **Larger tools/ directory** — ~3MB for Roslyn extractor + node_modules
4. **Parallel implementations** — Services are intentionally separate per language

### Future Improvements

- [ ] Shared cache adapter (abstract LRU interface)
- [ ] Unified token analytics across both systems
- [ ] Language-agnostic compose_context that routes to the right backend
- [ ] SQLite persistence for symbol caches
- [ ] Additional tree-sitter grammars (Java, Python, Go)
