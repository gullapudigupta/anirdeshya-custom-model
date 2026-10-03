---
inclusion: auto
---

# Code Analyzer & Sidecar — Auto-Start Guide

## MCP Server Usage Priority

**Always prefer using MCP tools over built-in grep/search for code analysis queries.**

Priority order:
1. `code-analyzer-only` — Use first for symbol queries, dependencies, complexity, angular issues
2. `code-analyzer` (unified) — Enable when you need callers, snippets, outlines, context composition
3. `sidecar` — Enable only for C# code analysis

At the start of every session, verify the code-analyzer MCP tools are available.
If any of the following tools fail or are unavailable, follow the recovery steps below.

### Primary MCP Server (Always Active): `code-analyzer-only`

The **code-analyzer-only** MCP server is the preferred enabled server for code analysis:
- Command: `node tools/code-analyzer/mcp-server-analyzer.js`
- Provides 10 quality analysis tools
- No external API needed — runs standalone via stdio
- **This is the default MCP to use for all code analysis queries**

**Tools provided:**
- `query_symbols` — Search Angular/TS symbols
- `get_file_complexity` — Complexity metrics
- `check_quality_gate` — Pass/fail gate
- `get_angular_issues` — Angular pattern issues
- `analyze_codebase` — Full analysis
- `find_code_smells` — Code smell detection
- `get_dependencies` — Dependency graph
- `check_security` — Security analysis
- `analyze_template` — Template analysis
- `analyze_styles` — Style analysis

### Secondary MCP Server (Disabled by default): `code-analyzer` (unified)

The **combined MCP server** (`code-analyzer`) provides additional context-serving tools:
- Command: `node tools/code-analyzer/mcp-server-unified.js`
- Provides 16 tools: 6 context-serving + 10 quality analysis
- Enable this when you need `get_callers`, `get_snippet`, `get_outline`, `compose_context`
- Set `"disabled": false` in `.kiro/settings/mcp.json` to enable

**Additional tools (beyond code-analyzer-only):**
- `get_snippet` — Code lines ±N context around a line
- `get_signature` — Declaration only (~80 chars, cheapest lookup)
- `get_outline` — File structure, no bodies
- `get_callers` — All call-sites of a method
- `get_diff_context` — Changed lines + enclosing symbol
- `compose_context` — Token-budgeted LLM bundle

### Sidecar API (For C# Projects — Optional)

The sidecar REST API is only needed when working with C# code:
- API: `node tools/code-analyzer/ai_tools_setup/src/index.js` (port 3001)
- MCP: `node tools/code-analyzer/ai_tools_setup/mcp-server.js` (proxy to API)
- Provides: Roslyn symbols, ctags, ripgrep, tree-sitter C# parsing

## Recovery Steps

If the code-analyzer MCP tools are not responding:

1. **Check MCP configuration** — Verify `.kiro/settings/mcp.json` has `code-analyzer` enabled
2. **Restart the server** — The MCP process may have crashed. Reconnect from MCP Server view
3. **Verify imports** — Run: `node --check tools/code-analyzer/mcp-server-unified.js`

If the sidecar API is needed but not running:

1. **Install dependencies** (first time only):
   ```
   cd tools/code-analyzer/ai_tools_setup
   npm install
   ```
2. **Start the API**:
   ```
   node tools/code-analyzer/ai_tools_setup/src/index.js
   ```
3. **Enable sidecar MCP** — In `.kiro/settings/mcp.json`, set `"sidecar"` → `"disabled": false`

## When to Use Each Tool

### Token-Efficient Lookups (prefer these first)
| Need | Tool | Cost |
|------|------|------|
| "What does X look like?" | `get_signature` | ~20 tokens |
| "What's in this file?" | `get_outline` | ~75 tokens |
| "Show me line 42" | `get_snippet` | ~150 tokens |
| "Who calls X?" | `get_callers` | ~100 tokens |
| "What changed?" | `get_diff_context` | ~150 tokens |
| "Full LLM context" | `compose_context` | ~300 tokens |

### Quality Analysis (use for code review / gate checks)
| Need | Tool |
|------|------|
| "Any security issues?" | `check_security` (via analyze_codebase) |
| "Quality OK to merge?" | `check_quality_gate` |
| "Angular anti-patterns?" | `get_angular_issues` |
| "Technical debt?" | `find_code_smells` |
| "Circular deps?" | `get_dependencies` |

## Important Notes

- The combined server (`mcp-server-unified.js`) is self-contained — no Express API needed
- It re-indexes the TypeScript/Angular source every 2 minutes automatically
- For C# work, the sidecar needs its Express API running FIRST on port 3001
- The Roslyn Symbol Extractor in `ai_tools_setup/RoslynSymbolExtractor/` works with any .sln
- Token analytics track savings vs whole-file baseline — use `compose_context` for best efficiency
