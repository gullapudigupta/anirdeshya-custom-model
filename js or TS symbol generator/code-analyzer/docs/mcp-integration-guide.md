# Parikrama Code Analyzer — MCP Integration Guide

> How to configure, use, and extend the MCP (Model Context Protocol) server  
> for AI-powered code intelligence in Kiro, Claude, and other MCP-compatible agents.

---

## Table of Contents

1. [Overview](#overview)
2. [Installation & Configuration](#installation--configuration)
3. [Available MCP Tools (Current)](#available-mcp-tools-current)
4. [New Sidecar-Style MCP Tools (CAT-015 to CAT-026)](#new-sidecar-style-mcp-tools)
5. [How to Refresh the Symbol Index](#how-to-refresh-the-symbol-index)
6. [How to Access the Code Analyzer](#how-to-access-the-code-analyzer)
7. [Workflow Examples](#workflow-examples)
8. [Extending the MCP Server](#extending-the-mcp-server)
9. [REST API as Alternative](#rest-api-as-alternative)
10. [Troubleshooting](#troubleshooting)

---

## Overview

The Parikrama Code Analyzer exposes its capabilities through three interfaces:

```
┌─────────────────────────────────────────────────────────────────┐
│                    PARIKRAMA CODE ANALYZER                        │
│                                                                   │
│   ┌──────────────┐    ┌──────────────┐    ┌──────────────────┐  │
│   │  CLI          │    │  MCP Server   │    │  REST API        │  │
│   │  (cli.js)     │    │  (mcp-server) │    │  (api/server.js) │  │
│   │              │    │              │    │                  │  │
│   │  Human use    │    │  AI agents    │    │  IDE plugins     │  │
│   │  CI/CD        │    │  Kiro/Claude  │    │  Web dashboards  │  │
│   └──────────────┘    └──────────────┘    └──────────────────┘  │
│                              │                                    │
│                              ▼                                    │
│   ┌──────────────────────────────────────────────────────────┐   │
│   │              Shared Core Engine                            │   │
│   │  Symbol Extractor → Query Engine → 10 Analyzers           │   │
│   │  + 6 Services + 3 Utilities + 2 Bridges                  │   │
│   └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

**MCP Server** is the primary interface for AI agents. It exposes tools that Kiro/Claude can call directly during conversations.

---

## Installation & Configuration

### MCP Configuration for Kiro

Add to `.kiro/settings/mcp.json` (workspace level) or `~/.kiro/settings/mcp.json` (user level):

```json
{
  "mcpServers": {
    "parikrama-code-analyzer": {
      "command": "node",
      "args": ["tools/code-analyzer/mcp-server.js"],
      "disabled": false,
      "autoApprove": [
        "query_symbols",
        "get_file_complexity",
        "check_quality_gate",
        "get_angular_issues",
        "get_snippet",
        "get_signature",
        "get_outline",
        "find_callers",
        "compose_context",
        "get_diff_context"
      ]
    }
  }
}
```

### Verify It Works

After configuring, ask Kiro:
> "Use the parikrama-code-analyzer MCP to query symbols for AuthService"

Or test manually:
```bash
# Start MCP server in stdio mode (for testing)
node tools/code-analyzer/mcp-server.js
```

The server communicates via JSON-RPC over stdin/stdout (MCP protocol).

---

## Available MCP Tools (Current)

These 10 tools are currently exposed via the MCP server:

### 1. `query_symbols`

Search for code symbols by name, type, or file pattern.

**Input:**
```json
{
  "query": "Auth",
  "type": "service",
  "file": "auth/"
}
```

**What it returns:** Matching symbols with type, file, line, metadata (selector, extends, methods).

**Use when:** You need to find a class, service, component, interface, or function.

---

### 2. `get_file_complexity`

Get cyclomatic complexity, cognitive complexity, and maintainability index for a file.

**Input:**
```json
{
  "filePath": "src/app/auth/auth.service.ts"
}
```

**What it returns:** Complexity metrics, per-method breakdown, and issues.

**Use when:** You need to understand how complex a file is, or identify methods that need refactoring.

---

### 3. `analyze_codebase`

Run full or scoped analysis across the entire codebase.

**Input:**
```json
{
  "scope": "full",
  "quick": true
}
```

**Scope options:** `full`, `security`, `angular`, `complexity`, `smells`

**What it returns:** Quality gate status, ratings, file counts, top issues.

**Use when:** You want an overview of codebase health or need to check specific quality dimensions.

---

### 4. `check_security`

Run CWE-tagged security vulnerability scan.

**Input:**
```json
{
  "filePath": "src/app/auth/auth.service.ts"
}
```

**What it returns:** Vulnerabilities and hotspots with CWE IDs, severity, and location.

**Use when:** Checking for security issues before deployment or reviewing sensitive code.

---

### 5. `check_quality_gate`

Run quality gate with pass/fail result.

**Input:**
```json
{
  "relaxed": false
}
```

**What it returns:** Gate status (PASSED/FAILED), which conditions failed, metrics used.

**Use when:** CI/CD check, or before merging a PR to ensure quality standards are met.

---

### 6. `get_dependencies`

Get import graph and circular dependency detection.

**Input:**
```json
{
  "filePath": "src/app/auth/auth.service.ts",
  "detectCircular": true
}
```

**What it returns:** Import list for a file, or full dependency graph stats with circular deps.

**Use when:** Understanding module relationships, finding circular dependencies, or planning refactoring.

---

### 7. `find_code_smells`

Detect code smells with effort estimation.

**Input:**
```json
{
  "filePath": "src/app/home/home.component.ts"
}
```

**What it returns:** Smell type, severity, line, effort to fix, and technical debt calculation.

**Use when:** Code review, identifying refactoring candidates.

---

### 8. `analyze_template`

Analyze Angular HTML templates.

**Input:**
```json
{
  "filePath": "src/app/home/home.component.html"
}
```

**What it returns:** Accessibility issues, performance patterns, binding counts, directive usage.

**Use when:** Reviewing templates for a11y compliance, performance, or best practices.

---

### 9. `analyze_styles`

Analyze SCSS/CSS files.

**Input:**
```json
{
  "filePath": "src/app/home/home.component.scss"
}
```

**What it returns:** Specificity scores, nesting depth, z-index usage, color consistency, !important count.

**Use when:** CSS architecture review, finding specificity wars, z-index management.

---

### 10. `get_angular_issues`

Angular-specific pattern analysis.

**Input:**
```json
{
  "filePath": "src/app/home/home.component.ts",
  "category": "performance"
}
```

**Categories:** `performance`, `reliability`, `security`, `modernization`, `code-smell`, `best-practice`

**What it returns:** Angular-specific issues (subscription leaks, change detection, lifecycle, standalone migration).

**Use when:** Angular code review, modernization planning, finding memory leaks.

---

## New Sidecar-Style MCP Tools

These tools should be added to `mcp-server.js` to expose the new services (CAT-015 to CAT-026):

### How to Add New Tools to the MCP Server

Add these tool definitions and handlers to `tools/code-analyzer/mcp-server.js`:

```javascript
// ─── Additional Imports (add to top) ─────────────────────────────────────────

const { SnippetService } = require('./src/services/snippet-service');
const { SignatureService } = require('./src/services/signature-service');
const { OutlineService } = require('./src/services/outline-service');
const { CallersService } = require('./src/services/callers-service');
const { DiffContextService } = require('./src/services/diff-context-service');
const { ContextComposer } = require('./src/services/context-composer');
const { TokenAnalytics } = require('./src/utils/token-analytics');

// ─── Initialize services ─────────────────────────────────────────────────────

const snippetService = new SnippetService(ROOT);
const signatureService = new SignatureService(ROOT);
const outlineService = new OutlineService(ROOT);
const callersService = new CallersService(ROOT);
const diffContextService = new DiffContextService(ROOT);
const analytics = new TokenAnalytics(ROOT);
```

### Tool Definitions to Add

```javascript
// Add these to the tools array in 'tools/list' handler:

{
  name: 'get_snippet',
  description: 'Get ±N context lines around a specific line in a file. Returns formatted code with line numbers. Essential for understanding code around a specific point.',
  inputSchema: {
    type: 'object',
    properties: {
      file: { type: 'string', description: 'Relative file path (e.g., src/app/auth/auth.service.ts)' },
      line: { type: 'number', description: 'Target line number (1-based)' },
      before: { type: 'number', description: 'Lines before target (default: 5)', default: 5 },
      after: { type: 'number', description: 'Lines after target (default: 10)', default: 10 },
    },
    required: ['file', 'line'],
  },
},
{
  name: 'get_signature',
  description: 'Get the declaration line of a symbol — no body, ~80 chars. Cheapest token lookup for quick reference.',
  inputSchema: {
    type: 'object',
    properties: {
      symbolName: { type: 'string', description: 'Name of the symbol (class, function, interface, etc.)' },
    },
    required: ['symbolName'],
  },
},
{
  name: 'get_outline',
  description: 'Get structural outline of a file: all symbols with kind and line, grouped by class. No code bodies. Very token-efficient.',
  inputSchema: {
    type: 'object',
    properties: {
      file: { type: 'string', description: 'Relative file path' },
      format: { type: 'string', description: 'Output format', enum: ['tree', 'flat', 'compact'], default: 'tree' },
    },
    required: ['file'],
  },
},
{
  name: 'find_callers',
  description: 'Find all call-sites of a method/function across the codebase. Each result includes the enclosing method and class.',
  inputSchema: {
    type: 'object',
    properties: {
      symbolName: { type: 'string', description: 'Method name or Class.method format (e.g., "AuthService.login")' },
      maxResults: { type: 'number', description: 'Max results (default: 30)', default: 30 },
    },
    required: ['symbolName'],
  },
},
{
  name: 'compose_context',
  description: 'Compose token-budgeted LLM context for a symbol. Orchestrates multiple services to produce optimal context within a token budget.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Symbol name or search query' },
      mode: { type: 'string', description: 'Context verbosity', enum: ['signatures', 'compact', 'full'], default: 'compact' },
      tokenBudget: { type: 'number', description: 'Max tokens to use (default: auto based on mode)' },
    },
    required: ['query'],
  },
},
{
  name: 'get_diff_context',
  description: 'Get git diff annotated with enclosing symbol names. 20-50x smaller than reading changed files. Shows what changed and where.',
  inputSchema: {
    type: 'object',
    properties: {
      staged: { type: 'boolean', description: 'Show staged changes (default: false)', default: false },
      commit: { type: 'string', description: 'Compare against commit (e.g., HEAD~3)' },
      file: { type: 'string', description: 'Optional: diff for a specific file only' },
    },
  },
},
{
  name: 'refresh_index',
  description: 'Force re-index the symbol database. Use after significant code changes to ensure fresh results.',
  inputSchema: {
    type: 'object',
    properties: {},
  },
},
```

### Handler Implementations

```javascript
// Add these cases to the tools/call switch statement:

case 'get_snippet':
  return handleSnippet(args);
case 'get_signature':
  return handleSignature(args);
case 'get_outline':
  return handleOutline(args);
case 'find_callers':
  return handleCallers(args);
case 'compose_context':
  return handleComposeContext(args);
case 'get_diff_context':
  return handleDiffContext(args);
case 'refresh_index':
  return handleRefreshIndex(args);

// ─── New Handler Implementations ─────────────────────────────────────────────

function handleSnippet(args) {
  const { file, line, before = 5, after = 10 } = args;
  const result = snippetService.getSnippet(file, line, { before, after });
  
  if (result.error) {
    return { content: [{ type: 'text', text: `Error: ${result.error}` }] };
  }

  const baseline = analytics.estimateFileTokens(file);
  analytics.recordRequest('snippet', { outputTokens: result.tokenEstimate, baselineTokens: baseline, file });

  return { content: [{ type: 'text', text: result.text }] };
}

function handleSignature(args) {
  const engine = getQueryEngine();
  const db = engine.getDatabase();
  const result = signatureService.getSignature(args.symbolName, db);

  if (result.error) {
    return { content: [{ type: 'text', text: `Not found: ${args.symbolName}` }] };
  }

  analytics.recordRequest('signature', { outputTokens: result.tokenEstimate, baselineTokens: 500, symbol: args.symbolName });

  return {
    content: [{
      type: 'text',
      text: `[${result.type}] ${result.signature}\n  → ${result.file}:${result.line} (~${result.tokenEstimate} tokens)`,
    }],
  };
}

function handleOutline(args) {
  const { file, format = 'tree' } = args;
  const result = outlineService.getOutline(file, { format });

  if (result.error) {
    return { content: [{ type: 'text', text: `Error: ${result.error}` }] };
  }

  analytics.recordRequest('outline', { outputTokens: result.tokenEstimate, baselineTokens: analytics.estimateFileTokens(file), file });

  return {
    content: [{
      type: 'text',
      text: `${file} (${result.totalLines} lines, ${result.symbolCount} symbols):\n\n${result.text}`,
    }],
  };
}

function handleCallers(args) {
  const { symbolName, maxResults = 30 } = args;
  const result = callersService.findCallers(symbolName, { maxResults });

  analytics.recordRequest('callers', { outputTokens: result.tokenEstimate, baselineTokens: 5000, symbol: symbolName });

  return {
    content: [{
      type: 'text',
      text: `${result.totalCallers} caller(s) of ${symbolName}:\n\n${result.text}`,
    }],
  };
}

function handleComposeContext(args) {
  const { query, mode = 'compact', tokenBudget } = args;
  const composer = new ContextComposer(ROOT);
  const result = composer.compose(query, { mode, tokenBudget });

  if (result.error) {
    return { content: [{ type: 'text', text: `Error: ${result.error}` }] };
  }

  analytics.recordRequest('compose', { outputTokens: result.tokenUsage.used, baselineTokens: result.tokenUsage.budget, symbol: query });

  return {
    content: [{
      type: 'text',
      text: `Context for "${query}" (${mode} mode, ${result.tokenUsage.utilization} budget used):\n\n${result.text}`,
    }],
  };
}

function handleDiffContext(args) {
  const { staged = false, commit = null, file = null } = args;
  const result = diffContextService.getDiffContext({ staged, commit, file });

  if (result.hunks.length === 0) {
    return { content: [{ type: 'text', text: 'No changes detected.' }] };
  }

  analytics.recordRequest('diff', { outputTokens: result.tokenEstimate, baselineTokens: result.tokenEstimate * 20 });

  return {
    content: [{
      type: 'text',
      text: `${result.summary}\n\n${result.text}`,
    }],
  };
}

function handleRefreshIndex(args) {
  // Force rebuild
  queryEngine = null;
  lastIndexTime = 0;
  snippetService.clearCache();
  signatureService.clearCache();
  outlineService.clearCache();
  
  const engine = getQueryEngine();
  const stats = engine.getStats();

  return {
    content: [{
      type: 'text',
      text: `Symbol index refreshed: ${stats.totalSymbols} symbols across ${stats.files} files.`,
    }],
  };
}
```

---

## How to Refresh the Symbol Index

The symbol index is cached in memory with a 60-second TTL by default. Here are all the ways to refresh it:

### Method 1: Automatic (TTL Expiry)

The index auto-refreshes every 60 seconds when queried:
```javascript
const INDEX_TTL = 60000; // in mcp-server.js
```

### Method 2: MCP Tool Call

Ask Kiro: *"Use the parikrama-code-analyzer to refresh the index"*

Or call the `refresh_index` MCP tool directly.

### Method 3: REST API

```bash
curl -X POST http://localhost:3002/refresh
```

Response:
```json
{
  "status": "refreshed",
  "stats": { "totalSymbols": 2929, "files": 396 }
}
```

### Method 4: Auto-Refresh (Server Mode)

When running the REST API server, auto-refresh is enabled by default:
- Polls every 5 seconds for file changes (via `git diff`)
- Debounces 30 seconds to batch rapid changes
- Clears all caches (snippet, signature, outline) on refresh

```javascript
// In api/server.js — already configured:
const autoRefresh = new AutoRefresh(rootDir, {
  debounceMs: 30000,
  onRefresh: (changedFiles) => {
    indexed = false;
    snippetService.clearCache();
    signatureService.clearCache();
    outlineService.clearCache();
  },
});
autoRefresh.start();
```

### Method 5: CLI

```bash
# Quick re-index via symbols command
node tools/code-analyzer/cli.js symbols
```

### Method 6: Programmatic (in custom scripts)

```javascript
const { QueryEngine } = require('./tools/code-analyzer/src/query-engine');

// Force rebuild
const qe = new QueryEngine('C:/project');
qe.buildIndex('C:/project/src');
const stats = qe.getStats();
console.log(`Indexed ${stats.totalSymbols} symbols`);
```

---

## How to Access the Code Analyzer

### Access Method Comparison

| Method | Best For | Latency | Setup |
|--------|----------|---------|-------|
| **MCP Server** | AI agents (Kiro, Claude) | ~200ms first call, ~5ms cached | mcp.json config |
| **REST API** | IDE plugins, web UIs, CI/CD | ~50ms (HTTP overhead) | Start server process |
| **CLI** | Human developers, shell scripts | ~500ms (full scan) | None (just run) |
| **Direct Import** | Custom Node.js scripts | ~5ms (in-process) | `require(...)` |

### Access via MCP (Recommended for AI Agents)

1. Configure in `.kiro/settings/mcp.json`
2. Kiro calls tools automatically based on context
3. No server process needed — starts on demand

```
User: "What are the Angular issues in the auth module?"
Kiro: [calls get_angular_issues with file: "src/app/auth/"]
```

### Access via REST API (Recommended for IDE/Web Integration)

1. Start the server: `node tools/code-analyzer/src/api/server.js`
2. Make HTTP requests from any language/tool

```bash
# From terminal
curl -X POST http://localhost:3002/snippet \
  -H "Content-Type: application/json" \
  -d '{"file": "src/app/auth/auth.service.ts", "line": 42, "before": 5, "after": 10}'

# From Python
import requests
r = requests.post('http://localhost:3002/compose', json={
    "query": "AuthService", 
    "mode": "compact"
})
print(r.json()['text'])

# From a VS Code extension
fetch('http://localhost:3002/outline', {
  method: 'POST',
  body: JSON.stringify({ file: activeEditor.document.fileName, format: 'tree' })
})
```

### Access via CLI (Recommended for Humans/CI)

```bash
# Full analysis
node tools/code-analyzer/cli.js analyze

# Quick symbol search  
node tools/code-analyzer/cli.js query AuthService

# Quality gate (exits with code 1 on failure)
node tools/code-analyzer/cli.js gate

# Security scan
node tools/code-analyzer/cli.js security

# npm scripts (configured in package.json)
npm run analyze
npm run analyze:security
npm run analyze:gate
npm run analyze:symbols
```

### Access via Direct Import (Recommended for Custom Scripts)

```javascript
// Any Node.js script can import and use services directly:
const { ContextComposer } = require('./tools/code-analyzer/src/services/context-composer');
const { SnippetService } = require('./tools/code-analyzer/src/services/snippet-service');
const { QueryEngine } = require('./tools/code-analyzer/src/query-engine');

const ROOT = require('path').resolve(__dirname);

// Build index once, query many times
const qe = new QueryEngine(ROOT);
qe.buildIndex();

// Use services
const snippets = new SnippetService(ROOT);
const composer = new ContextComposer(ROOT);

// Example: Get context for all services
const services = qe.findServices();
for (const svc of services) {
  const ctx = composer.compose(svc.name, { mode: 'signatures' });
  console.log(ctx.text);
}
```

---

## Workflow Examples

### Workflow 1: Understanding a Component Before Editing

```
User: "I need to modify HomeComponent. Show me its structure."

Kiro calls: get_outline({ file: "src/app/home/home.component.ts", format: "tree" })

Result:
  ⬡ HomeComponent (L12)
    ├─ • items: TodoItem[] (L15)
    ├─ • isLoading: boolean (L16)
    ├─ → ngOnInit (L22)
    ├─ → loadItems (L30)
    ├─ → refresh (L45)
    ├─ → deleteItem (L58)
    └─ → private handleError (L72)

User: "Show me the loadItems method"

Kiro calls: get_snippet({ file: "src/app/home/home.component.ts", line: 30, before: 2, after: 15 })
```

### Workflow 2: Finding Who Uses a Service Method

```
User: "Who calls AuthService.login?"

Kiro calls: find_callers({ symbolName: "AuthService.login", maxResults: 20 })

Result:
  5 caller(s) of AuthService.login:
    src/app/login/login.component.ts:45 in onSubmit() → this.authService.login(...)
    src/app/auth/auto-login.service.ts:22 in tryAutoLogin() → this.authService.login(...)
    src/app/settings/link-account.component.ts:67 in linkGoogle() → ...
```

### Workflow 3: Code Review of Recent Changes

```
User: "What changed in the last commit?"

Kiro calls: get_diff_context({ commit: "HEAD~1" })

Result:
  2 file(s), 3 hunk(s), +15/-4, symbols: AuthService.handleToken, UserModel.fromJSON

  ── src/app/auth/auth.service.ts ──
  @@ L42 [AuthService.handleToken] +3/-1
  - this.token = token;
  + this.token = token;
  + this.tokenExpiry = Date.now() + 3600000;
  + this.refreshScheduled = true;
```

### Workflow 4: Quick Reference During Development

```
User: "What's the signature of the ThemeService?"

Kiro calls: get_signature({ symbolName: "ThemeService" })

Result:
  [service] export class ThemeService
    → src/app/appwrite/shared-components/theme-picker/theme.service.ts:8 (~12 tokens)
```

### Workflow 5: Deep Understanding for Refactoring

```
User: "I need to refactor the DeviceComponent. Give me full context."

Kiro calls: compose_context({ query: "DeviceComponent", mode: "full", tokenBudget: 3000 })

Result includes:
  ── Declaration ──
  export class DeviceComponent implements OnInit, OnDestroy

  ── Method Signatures ──
    ngOnInit()
    ngOnDestroy()
    async syncDevice(device: Device): Promise<void>
    private handleBluetoothError(err: Error): void

  ── File Outline ──
  ⬡ DeviceComponent (L15)
    ├─ → ngOnInit (L25)
    ├─ → syncDevice (L40)
    └─ → private handleBluetoothError (L78)

  ── Source Code ──
  [25 lines around the class definition]

  ── Callers (3) ──
    src/app/sync/sync.service.ts:55 in runSync()
    src/app/settings/settings.page.ts:90 in onDeviceSelect()
```

### Workflow 6: Refreshing After Major Changes

```
User: "I just moved a bunch of files around. Refresh the analyzer index."

Kiro calls: refresh_index({})

Result:
  Symbol index refreshed: 2945 symbols across 398 files.
```

### Workflow 7: Security Review Before Deployment

```
User: "Check the auth module for security issues"

Kiro calls: check_security({ filePath: "src/app/auth/auth.service.ts" })
Then calls: get_diff_context({ staged: true })

Combines security findings with what's about to be committed.
```

---

## Extending the MCP Server

### Adding a New Tool

1. **Define the tool** in the `tools/list` handler:

```javascript
{
  name: 'my_new_tool',
  description: 'What it does (keep under 100 chars)',
  inputSchema: {
    type: 'object',
    properties: {
      param1: { type: 'string', description: 'What this param is' },
    },
    required: ['param1'],
  },
}
```

2. **Add the handler** in the `tools/call` switch:

```javascript
case 'my_new_tool':
  return handleMyNewTool(args);
```

3. **Implement the handler:**

```javascript
function handleMyNewTool(args) {
  // Your logic here
  const result = doSomething(args.param1);
  
  return {
    content: [{
      type: 'text',
      text: JSON.stringify(result, null, 2),
    }],
  };
}
```

### Adding Token Analytics to Any Handler

```javascript
function handleMyTool(args) {
  const result = myService.doWork(args);
  
  // Track token savings
  const baseline = analytics.estimateFileTokens(args.file);
  analytics.recordRequest('my_tool', {
    outputTokens: result.tokenEstimate || Math.ceil(JSON.stringify(result).length / 4),
    baselineTokens: baseline,
    file: args.file,
  });
  
  return { content: [{ type: 'text', text: result.text }] };
}
```

---

## REST API as Alternative

The REST API server (`tools/code-analyzer/src/api/server.js`) provides the same capabilities over HTTP. Use it when:

- You need access from non-Node.js languages (Python, Go, etc.)
- You're building a web dashboard
- You need concurrent access from multiple processes
- You want a persistent server with auto-refresh

### Starting the Server

```bash
# Default port 3002
node tools/code-analyzer/src/api/server.js

# Custom port
PORT=4000 node tools/code-analyzer/src/api/server.js
```

### All Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/health` | Health check (uptime, indexed status) |
| `GET` | `/stats` | Index stats + cache stats + analytics |
| `POST` | `/snippet` | Code snippet (file, line, before, after) |
| `POST` | `/signature` | Symbol signature (symbolName) |
| `POST` | `/outline` | File outline (file, format) |
| `POST` | `/callers` | Find callers (symbolName, maxResults) |
| `POST` | `/compose` | LLM context (query, mode, tokenBudget) |
| `POST` | `/diff-context` | Git diff (staged, commit, file) |
| `GET` | `/analytics` | Token analytics report |
| `POST` | `/query` | Symbol query (name, type) |
| `POST` | `/refresh` | Force re-index |

### CORS

The server includes CORS headers allowing access from any origin — suitable for browser-based tools and local IDE plugins.

---

## Troubleshooting

### "Symbol not found" but it exists

The index may be stale. Solutions:
1. Call `refresh_index` MCP tool
2. POST to `/refresh` endpoint
3. Wait 60 seconds (auto TTL expiry)
4. Restart the MCP server

### MCP server won't start

Check:
```bash
# Test manually
node tools/code-analyzer/mcp-server.js
# Should output: "Parikrama Code Analyzer MCP Server running on stdio"

# Check for missing dependencies
node -e "require('./tools/code-analyzer/mcp-server.js')"
```

Common issues:
- Missing `@modelcontextprotocol/sdk` — run `npm install`
- Wrong path in mcp.json — must be relative to workspace root

### REST API server port already in use

```bash
# Find what's using port 3002
netstat -ano | findstr :3002

# Use a different port
set PORT=4000 && node tools/code-analyzer/src/api/server.js
```

### Stale results after file moves

File moves don't trigger git diff in the same way. Force a full refresh:
```bash
curl -X POST http://localhost:3002/refresh
```

Or via MCP: call `refresh_index` tool.

### Performance issues with large files

The services use file caching. If memory usage grows:
1. The LRU cache auto-evicts (default 200 entries)
2. Snippet cache has 60s TTL
3. Call `clearCache()` on services if needed

### Token budget exceeded

The ContextComposer respects budgets strictly. If you get truncated results:
- Increase `tokenBudget` in the request
- Use `mode: "signatures"` for minimum context
- Use `mode: "full"` with budget 3000+ for deep context

---

## File Structure Reference

```
tools/code-analyzer/
├── cli.js                           # CLI interface (12 commands)
├── mcp-server.js                    # MCP server (10 tools → extend to 17)
├── package.json                     # Dependencies (just @modelcontextprotocol/sdk)
│
├── src/
│   ├── ast-utils.js                 # Core: regex patterns, file utils
│   ├── symbol-extractor.js          # Core: extract symbols from files
│   ├── query-engine.js              # Core: search/query symbols
│   ├── quality-gate.js              # Quality gate with thresholds
│   ├── reporter.js                  # Console/JSON report generation
│   │
│   ├── analyzers/                   # 10 analysis modules
│   │   ├── angular-patterns.js      # Angular-specific rules
│   │   ├── code-smells.js           # 13 smell types
│   │   ├── complexity.js            # Cyclomatic + Cognitive + MI
│   │   ├── dead-code.js             # Unused exports, unreachable
│   │   ├── dependency-graph.js      # Circular deps, coupling
│   │   ├── duplication.js           # Token-based block comparison
│   │   ├── performance.js           # RxJS, memory leaks
│   │   ├── scss-analyzer.js         # CSS specificity, z-index
│   │   ├── security.js              # 12 CWE-tagged rules
│   │   └── template-analyzer.js     # HTML a11y, bindings
│   │
│   ├── services/                    # 6 LLM context services (NEW)
│   │   ├── snippet-service.js       # ±N context lines
│   │   ├── signature-service.js     # Declaration only (~80 chars)
│   │   ├── outline-service.js       # File structure (no bodies)
│   │   ├── callers-service.js       # Find all call-sites
│   │   ├── diff-context-service.js  # Git diff + symbol annotation
│   │   └── context-composer.js      # Token-budgeted LLM bundles
│   │
│   ├── utils/                       # 3 utility modules (NEW)
│   │   ├── cache.js                 # LRU cache with TTL
│   │   ├── token-analytics.js       # Token savings tracking
│   │   └── auto-refresh.js          # File change detection
│   │
│   ├── api/                         # REST API (NEW)
│   │   └── server.js               # HTTP server (port 3002)
│   │
│   └── integrations/                # Optional bridges (NEW)
│       ├── ripgrep-bridge.js        # rg binary integration
│       └── treesitter-bridge.js     # tree-sitter integration
│
├── docs/
│   ├── api-services-reference.md    # Full API reference
│   ├── mcp-integration-guide.md     # This document
│   ├── architecture-comparison.md   # Sidecar vs Parikrama comparison
│   ├── gap-analysis-vs-sidecar.md   # Gap analysis (now closed)
│   └── complete-analysis-report.md  # Initial scan results
│
└── reports/                         # Generated reports
    ├── analysis-report.json         # Last full analysis
    └── token-analytics.json         # Token savings report
```
