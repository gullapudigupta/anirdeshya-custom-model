# Parikrama Code Analyzer — API & Services Reference

> Complete reference for all REST API endpoints, service classes, and utility modules.  
> All services are zero-dependency Node.js modules following the same constructor pattern.

---

## Table of Contents

1. [Quick Start](#quick-start)
2. [REST API Server (Port 3002)](#rest-api-server)
3. [Service Classes](#service-classes)
   - [SnippetService](#snippetservice)
   - [SignatureService](#signatureservice)
   - [OutlineService](#outlineservice)
   - [CallersService](#callersservice)
   - [DiffContextService](#diffcontextservice)
   - [ContextComposer](#contextcomposer)
4. [Utility Modules](#utility-modules)
   - [LRUCache & AnalyzerCache](#lrucache--analyzercache)
   - [TokenAnalytics](#tokenanalytics)
   - [AutoRefresh](#autorefresh)
5. [Integration Bridges](#integration-bridges)
   - [RipgrepBridge](#ripgrepbridge)
   - [TreeSitterBridge](#treesitterbridge)
6. [Token Efficiency Guide](#token-efficiency-guide)

---

## Quick Start

### Start the REST API Server

```bash
# From project root
node tools/code-analyzer/src/api/server.js

# Custom port
PORT=4000 node tools/code-analyzer/src/api/server.js
```

Output:
```
  🕉️  Parikrama Code Analyzer API Server
  ─────────────────────────────────────────
  Root:  C:\sarah laptop\first app\mobileapp\parikrama_todo
  Port:  3002
  Status: Running

  Endpoints:
    GET /health
    GET /stats
    POST /snippet
    POST /signature
    POST /outline
    POST /callers
    POST /compose
    POST /diff-context
    GET /analytics
    POST /query
    POST /refresh

  Ready at http://localhost:3002
```

### Use Services Programmatically

```javascript
const { SnippetService } = require('./tools/code-analyzer/src/services/snippet-service');
const { SignatureService } = require('./tools/code-analyzer/src/services/signature-service');
const { OutlineService } = require('./tools/code-analyzer/src/services/outline-service');
const { ContextComposer } = require('./tools/code-analyzer/src/services/context-composer');

const ROOT = 'C:/sarah laptop/first app/mobileapp/parikrama_todo';

// Get a code snippet
const snippets = new SnippetService(ROOT);
const result = snippets.getSnippet('src/app/auth/auth.service.ts', 42, { before: 5, after: 10 });
console.log(result.text);       // Formatted with line numbers
console.log(result.rawText);    // Just the code
console.log(result.tokenEstimate); // Token cost

// Get a file outline
const outlines = new OutlineService(ROOT);
const outline = outlines.getCompactOutline('src/app/home/home.component.ts');
console.log(outline.compact);   // "C:HomeComponent(ngOnInit,loadItems,refresh)"

// Compose LLM context
const composer = new ContextComposer(ROOT);
const context = composer.compose('AuthService', { mode: 'compact', tokenBudget: 800 });
console.log(context.text);
console.log(context.tokenUsage); // { used: 650, budget: 800, utilization: "81%" }
```

---

## REST API Server

### `GET /health`

Health check endpoint.

**Response:**
```json
{
  "status": "ok",
  "uptime": 123.456,
  "version": "1.0.0",
  "indexed": true
}
```

---

### `GET /stats`

Current index statistics and cache health.

**Response:**
```json
{
  "totalSymbols": 2929,
  "files": 396,
  "byType": {
    "component": 85,
    "service": 51,
    "interface": 75,
    "method": 1200,
    "function": 340
  },
  "cache": {
    "size": 42,
    "maxSize": 200,
    "hits": 156,
    "misses": 23,
    "hitRate": "87%"
  },
  "analytics": {
    "requests": 89,
    "savedTokens": 45200,
    "overallReductionPct": 78
  }
}
```

---

### `POST /snippet`

Get ±N context lines around a file:line.

**Request:**
```json
{
  "file": "src/app/auth/auth.service.ts",
  "line": 42,
  "before": 5,
  "after": 10
}
```

**Response:**
```json
{
  "file": "src/app/auth/auth.service.ts",
  "targetLine": 42,
  "range": { "start": 37, "end": 52 },
  "lines": [
    { "num": 37, "content": "  private handleToken(token: string) {", "isTarget": false },
    { "num": 42, "content": "    this.storage.set('auth_token', token);", "isTarget": true }
  ],
  "text": "  37 │   private handleToken(token: string) {\n→ 42 │     this.storage.set('auth_token', token);",
  "rawText": "  private handleToken(token: string) {\n    ...",
  "tokenEstimate": 85,
  "totalFileLines": 230
}
```

---

### `POST /signature`

Get only the declaration line(s) of a symbol — no body.

**Request:**
```json
{
  "symbolName": "AuthService"
}
```

**Response:**
```json
{
  "name": "AuthService",
  "type": "service",
  "signature": "export class AuthService implements OnDestroy",
  "file": "src/app/auth/auth.service.ts",
  "line": 15,
  "tokenEstimate": 12
}
```

---

### `POST /outline`

Get structural outline of a file — all symbols with kind and line.

**Request:**
```json
{
  "file": "src/app/home/home.component.ts",
  "format": "tree"
}
```

**Format Options:** `"tree"` | `"flat"` | `"compact"`

**Response (tree):**
```json
{
  "file": "src/app/home/home.component.ts",
  "totalLines": 180,
  "symbolCount": 14,
  "tree": [
    {
      "kind": "component",
      "name": "HomeComponent",
      "line": 12,
      "decorator": "Component",
      "members": [
        { "kind": "property", "name": "items", "line": 15, "visibility": "public" },
        { "kind": "method", "name": "ngOnInit", "line": 22, "visibility": "public" },
        { "kind": "method", "name": "loadItems", "line": 30, "visibility": "private" },
        { "kind": "method", "name": "refresh", "line": 45, "visibility": "public" }
      ]
    }
  ],
  "text": "⬡ HomeComponent (L12)\n  ├─ • items (L15)\n  ├─ → ngOnInit (L22)\n  ├─ → private loadItems (L30)\n  └─ → refresh (L45)",
  "tokenEstimate": 38
}
```

**Response (compact):**
```json
{
  "file": "src/app/home/home.component.ts",
  "compact": "C:HomeComponent(ngOnInit,loadItems,refresh) | I:HomeItem",
  "tokenEstimate": 15
}
```

---

### `POST /callers`

Find all call-sites of a method across the codebase.

**Request:**
```json
{
  "symbolName": "AuthService.login",
  "maxResults": 20
}
```

**Response:**
```json
{
  "symbol": "AuthService.login",
  "totalCallers": 5,
  "callers": [
    {
      "file": "src/app/login/login.component.ts",
      "line": 45,
      "enclosingMethod": "onSubmit",
      "enclosingClass": "LoginComponent",
      "context": "this.authService.login(this.form.value)"
    },
    {
      "file": "src/app/auth/auth.guard.ts",
      "line": 22,
      "enclosingMethod": "canActivate",
      "enclosingClass": "AuthGuard",
      "context": "await this.authService.login(credentials)"
    }
  ],
  "text": "  src/app/login/login.component.ts:45 in onSubmit() → this.authService.login(this.form.value)\n  ...",
  "tokenEstimate": 120
}
```

---

### `POST /compose`

Compose token-budgeted LLM context in 3 modes.

**Request:**
```json
{
  "query": "AuthService",
  "mode": "compact",
  "tokenBudget": 800
}
```

**Mode Options:**
| Mode | Budget | Content |
|------|--------|---------|
| `signatures` | ~150 tokens | Declaration lines only |
| `compact` | ~800 tokens | Outline + key signatures + snippet |
| `full` | ~2000 tokens | All of above + callers + larger snippet |

**Response:**
```json
{
  "query": "AuthService",
  "mode": "compact",
  "symbol": { "name": "AuthService", "type": "service", "file": "src/app/auth/auth.service.ts", "line": 15 },
  "sections": [
    { "title": "Declaration", "content": "export class AuthService implements OnDestroy", "tokens": 12 },
    { "title": "File Structure", "content": "C:AuthService(login,logout,refreshToken,isAuthenticated)", "tokens": 18 },
    { "title": "Code", "content": "...", "tokens": 320 }
  ],
  "text": "── Declaration ──\nexport class AuthService implements OnDestroy\n\n── File Structure ──\nC:AuthService(login,logout,refreshToken,isAuthenticated)\n\n── Code ──\n...",
  "tokenUsage": { "used": 650, "budget": 800, "utilization": "81%" }
}
```

---

### `POST /diff-context`

Get git diff annotated with enclosing symbol context.

**Request:**
```json
{
  "staged": false,
  "commit": null,
  "file": null
}
```

**Response:**
```json
{
  "hunks": [
    {
      "file": "src/app/auth/auth.service.ts",
      "startLine": 42,
      "additions": 3,
      "deletions": 1,
      "enclosingSymbol": "AuthService.handleToken",
      "lines": [
        { "type": "del", "content": "    this.token = token;" },
        { "type": "add", "content": "    this.token = token;" },
        { "type": "add", "content": "    this.tokenExpiry = Date.now() + 3600000;" },
        { "type": "add", "content": "    this.refreshScheduled = true;" }
      ]
    }
  ],
  "summary": "1 file(s), 1 hunk(s), +3/-1, symbols: AuthService.handleToken",
  "filesChanged": 1,
  "totalAdditions": 3,
  "totalDeletions": 1,
  "tokenEstimate": 95
}
```

---

### `GET /analytics`

Token analytics report.

**Response:**
```json
{
  "session": {
    "startTime": "2026-08-12T09:30:00.000Z",
    "durationMs": 3600000,
    "durationFormatted": "60.0m"
  },
  "totals": {
    "requests": 89,
    "outputTokens": 12400,
    "baselineTokens": 56200,
    "savedTokens": 43800,
    "overallReductionPct": 78
  },
  "byEndpoint": {
    "snippet": { "requests": 34, "avgOutputTokens": 85, "avgBaselineTokens": 500, "avgReductionPct": 83 },
    "signature": { "requests": 20, "avgOutputTokens": 12, "avgBaselineTokens": 500, "avgReductionPct": 98 },
    "outline": { "requests": 15, "avgOutputTokens": 38, "avgBaselineTokens": 450, "avgReductionPct": 92 },
    "compose": { "requests": 12, "avgOutputTokens": 650, "avgBaselineTokens": 2000, "avgReductionPct": 68 }
  }
}
```

---

### `POST /query`

Symbol query (search by name or type).

**Request:**
```json
{
  "name": "auth",
  "type": "service"
}
```

**Response:**
```json
{
  "results": [
    { "name": "AuthService", "type": "service", "file": "src/app/auth/auth.service.ts", "line": 15 },
    { "name": "AuthGuardService", "type": "service", "file": "src/app/auth/auth-guard.service.ts", "line": 8 }
  ]
}
```

---

### `POST /refresh`

Force re-index the symbol database.

**Response:**
```json
{
  "status": "refreshed",
  "stats": { "totalSymbols": 2929, "files": 396, "byType": { "component": 85, "..." } }
}
```

---

## Service Classes

All services follow the same constructor pattern:

```javascript
const service = new ServiceClass(rootDir);
```

### SnippetService

**File:** `tools/code-analyzer/src/services/snippet-service.js`

| Method | Arguments | Returns | Description |
|--------|-----------|---------|-------------|
| `getSnippet(file, line, opts)` | `file: string, line: number, opts: {before, after, maxWidth}` | `{file, targetLine, range, lines[], text, rawText, tokenEstimate}` | Get ±N context lines |
| `getMultiSnippets(requests)` | `[{file, line, before, after}]` | `Array<SnippetResult>` | Batch snippets |
| `getSymbolSnippet(name, db, opts)` | `name: string, db: SymbolDatabase` | `{symbol, snippet}` | Snippet around a named symbol |
| `getRange(file, start, end)` | `file: string, startLine: number, endLine: number` | `{file, range, lines[], rawText, tokenEstimate}` | Arbitrary line range |
| `clearCache()` | — | — | Clear file cache |
| `invalidateFile(path)` | `path: string` | — | Invalidate one file from cache |

**Example:**
```javascript
const { SnippetService } = require('./src/services/snippet-service');
const svc = new SnippetService('C:/project');

// Get 5 lines before and 10 after line 42
const result = svc.getSnippet('src/app/auth/auth.service.ts', 42, { before: 5, after: 10 });
console.log(result.text);           // Formatted with → arrow on target line
console.log(result.tokenEstimate);  // ~85 tokens vs ~500 for whole file

// Batch multiple snippets
const batch = svc.getMultiSnippets([
  { file: 'src/app/auth/auth.service.ts', line: 42, before: 3, after: 3 },
  { file: 'src/app/home/home.component.ts', line: 15, before: 2, after: 8 },
]);
```

---

### SignatureService

**File:** `tools/code-analyzer/src/services/signature-service.js`

| Method | Arguments | Returns | Description |
|--------|-----------|---------|-------------|
| `getSignature(name, db?)` | `name: string, db?: SymbolDatabase` | `{name, type, signature, file, line, tokenEstimate}` | Declaration only (~80 chars) |
| `getSignatures(names, db?)` | `string[]` | `Array<SignatureResult>` | Batch signatures |
| `getFileSignatures(file)` | `file: string` | `Array<{name, type, signature, line}>` | All signatures in a file |
| `getClassMethodSignatures(cls, db)` | `cls: string, db: SymbolDatabase` | `{className, methods[], tokenEstimate}` | All method sigs of a class |
| `clearCache()` | — | — | Clear cache |

**Example:**
```javascript
const { SignatureService } = require('./src/services/signature-service');
const svc = new SignatureService('C:/project');

// Cheapest lookup: ~12 tokens
const sig = svc.getSignature('AuthService');
// → { signature: "export class AuthService implements OnDestroy", tokenEstimate: 12 }

// Get all method signatures of a class
const { QueryEngine } = require('./src/query-engine');
const qe = new QueryEngine('C:/project');
qe.buildIndex();
const methods = svc.getClassMethodSignatures('AuthService', qe.getDatabase());
// → { methods: [{ name: "login", signature: "async login(creds: Credentials): Promise<User>" }, ...] }
```

---

### OutlineService

**File:** `tools/code-analyzer/src/services/outline-service.js`

| Method | Arguments | Returns | Description |
|--------|-----------|---------|-------------|
| `getOutline(file, opts)` | `file: string, opts: {format, includePrivate}` | `{file, totalLines, symbolCount, tree/flat/compact, text, tokenEstimate}` | Full outline |
| `getCompactOutline(file)` | `file: string` | Compact format result | Ultra-small for LLM (~15 tokens) |
| `getMultiOutlines(files, opts)` | `string[]` | `Array<OutlineResult>` | Batch outlines |
| `clearCache()` | — | — | Clear cache |

**Format comparison:**
```
tree format:     "⬡ HomeComponent (L12)\n  ├─ → ngOnInit (L22)\n  └─ → refresh (L45)"  → ~40 tokens
flat format:     "  12 component  HomeComponent\n  22 method     HomeComponent.ngOnInit"  → ~35 tokens
compact format:  "C:HomeComponent(ngOnInit,loadItems,refresh)"                            → ~15 tokens
```

**Example:**
```javascript
const { OutlineService } = require('./src/services/outline-service');
const svc = new OutlineService('C:/project');

// Ultra-compact (best for LLM context headers)
const compact = svc.getCompactOutline('src/app/auth/auth.service.ts');
console.log(compact.compact);
// → "C:AuthService(login,logout,refreshToken,isAuthenticated,handleError) | I:AuthState"

// Full tree view
const tree = svc.getOutline('src/app/auth/auth.service.ts', { format: 'tree' });
console.log(tree.text);
// → "◉ AuthService (L15)\n  ├─ → login (L22)\n  ├─ → logout (L45)\n  └─ → private handleError (L78)"
```

---

### CallersService

**File:** `tools/code-analyzer/src/services/callers-service.js`

| Method | Arguments | Returns | Description |
|--------|-----------|---------|-------------|
| `findCallers(symbol, opts)` | `symbol: string, opts: {includeImports, maxResults}` | `{symbol, totalCallers, callers[], text, tokenEstimate}` | Find all call-sites |
| `getCallGraph(className, db)` | `cls: string, db: SymbolDatabase` | `{className, methods[], internalCalls[], externalCallers[]}` | Full call graph |
| `findReferences(symbol)` | `symbol: string` | `{symbol, totalReferences, references[], byKind}` | All references (broader) |

**Symbol format:**
- `"login"` — finds any function/method named login
- `"AuthService.login"` — finds calls to login on AuthService instances

**Example:**
```javascript
const { CallersService } = require('./src/services/callers-service');
const svc = new CallersService('C:/project');

// Find who calls AuthService.login
const result = svc.findCallers('AuthService.login', { maxResults: 20 });
result.callers.forEach(c => {
  console.log(`${c.file}:${c.line} in ${c.enclosingClass}.${c.enclosingMethod}()`);
});

// Find all references to a symbol (imports, type usage, extends, etc.)
const refs = svc.findReferences('AuthService');
console.log(refs.byKind);
// → { import: 12, instantiation: 0, call: 5, "type-reference": 3, extends: 1 }
```

---

### DiffContextService

**File:** `tools/code-analyzer/src/services/diff-context-service.js`

| Method | Arguments | Returns | Description |
|--------|-----------|---------|-------------|
| `getDiffContext(opts)` | `opts: {staged, commit, file, contextLines}` | `{hunks[], summary, filesChanged, totalAdditions, totalDeletions, text, tokenEstimate}` | Annotated diff |
| `getChangedFiles(opts)` | `opts: {staged, commit}` | `Array<{status, file}>` | Changed files list |
| `getFileDiffContext(file, opts)` | `file: string` | Same as getDiffContext | Single-file diff |
| `getCompactDiffSummary(opts)` | Same as getDiffContext | `{filesChanged, symbolsAffected[], compact, tokenEstimate}` | Ultra-compact summary |

**Example:**
```javascript
const { DiffContextService } = require('./src/services/diff-context-service');
const svc = new DiffContextService('C:/project');

// Unstaged changes with symbol context
const diff = svc.getDiffContext();
diff.hunks.forEach(h => {
  console.log(`${h.file}:${h.startLine} [${h.enclosingSymbol}] +${h.additions}/-${h.deletions}`);
});

// Staged changes (what's about to be committed)
const staged = svc.getDiffContext({ staged: true });

// Changes in last 3 commits
const recent = svc.getDiffContext({ commit: 'HEAD~3' });

// Ultra-compact summary for LLM context
const summary = svc.getCompactDiffSummary();
console.log(summary.compact);
// → "src/app/auth/auth.service.ts:42 [AuthService.handleToken] +3/-1\nsrc/app/home/home.component.ts:15 [HomeComponent.ngOnInit] +5/-0"
```

---

### ContextComposer

**File:** `tools/code-analyzer/src/services/context-composer.js`

| Method | Arguments | Returns | Description |
|--------|-----------|---------|-------------|
| `compose(query, opts)` | `query: string, opts: {mode, tokenBudget}` | `{query, mode, symbol, sections[], text, tokenUsage}` | Main composition |
| `composeFileContext(file, opts)` | `file: string, opts: {mode, tokenBudget}` | Same shape | Context for a file |
| `composeMulti(queries, opts)` | `string[], opts` | `{queries, results[], text, tokenUsage}` | Batch composition |
| `clearCache()` | — | — | Clear all sub-service caches |

**Mode comparison:**

| Mode | Token Budget | Includes | Use When |
|------|-------------|----------|----------|
| `signatures` | ~150 | Declaration lines only | Quick reference, large context window |
| `compact` | ~800 | Signature + compact outline + short snippet | Default for most LLM queries |
| `full` | ~2000 | All above + callers + large snippet | Deep understanding needed |

**Example:**
```javascript
const { ContextComposer } = require('./src/services/context-composer');
const composer = new ContextComposer('C:/project');

// Compact context for an LLM prompt
const ctx = composer.compose('AuthService', { mode: 'compact', tokenBudget: 800 });
console.log(ctx.text);
console.log(`Used ${ctx.tokenUsage.used}/${ctx.tokenUsage.budget} tokens (${ctx.tokenUsage.utilization})`);

// Full context for deep analysis
const full = composer.compose('DeviceComponent', { mode: 'full', tokenBudget: 3000 });

// Multiple symbols in one budget
const multi = composer.composeMulti(['AuthService', 'UserModel', 'LoginComponent'], { 
  mode: 'signatures', 
  tokenBudget: 500 
});
```

---

## Utility Modules

### LRUCache & AnalyzerCache

**File:** `tools/code-analyzer/src/utils/cache.js`

```javascript
const { LRUCache, AnalyzerCache } = require('./src/utils/cache');

// Generic LRU cache
const cache = new LRUCache({ maxSize: 200, defaultTTL: 60000 });
cache.set('key', value);
cache.get('key');                      // Returns value or undefined (expired)
cache.has('key');                      // true/false
cache.getOrSet('key', () => compute()); // Compute if missing
cache.invalidatePattern(/^symbols:/);  // Bulk invalidation
cache.invalidateFile('src/app/auth/auth.service.ts'); // File-based invalidation
cache.getStats();                      // { hits, misses, hitRate, evictions, ... }

// Static key builder
const key = LRUCache.makeKey('symbols', 'AuthService', 'methods');
// → "symbols:AuthService:methods"

// Pre-configured analyzer cache with different TTLs per data type
const analyzerCache = new AnalyzerCache({
  symbolCacheTTL: 120000,   // 2 min
  outlineCacheTTL: 120000,  // 2 min
  snippetCacheTTL: 60000,   // 1 min (files change faster)
  analysisCacheTTL: 300000, // 5 min
});

analyzerCache.setSymbol('AuthService', data);
analyzerCache.getSymbol('AuthService');
analyzerCache.setOutline('src/app/auth/auth.service.ts', outlineData);
analyzerCache.onFileChange('src/app/auth/auth.service.ts'); // Invalidates related
```

---

### TokenAnalytics

**File:** `tools/code-analyzer/src/utils/token-analytics.js`

```javascript
const { TokenAnalytics } = require('./src/utils/token-analytics');
const analytics = new TokenAnalytics('C:/project');

// Record each request
analytics.recordRequest('snippet', {
  outputTokens: 85,
  baselineTokens: 500,    // What it would cost to send the whole file
  file: 'src/app/auth/auth.service.ts',
});

analytics.recordRequest('signature', {
  outputTokens: 12,
  baselineTokens: 500,
  symbol: 'AuthService',
});

// Get the report
const report = analytics.getReport();
console.log(report.text);
// Token Analytics Report
// ═══════════════════════
// Total Requests:    89
// Output Tokens:     12,400
// Baseline Tokens:   56,200
// Tokens Saved:      43,800
// Overall Reduction: 78%
//
// By Endpoint:
//   snippet      34 reqs, avg 83% reduction, saved 14110 tokens
//   signature    20 reqs, avg 98% reduction, saved 9760 tokens

// Estimate baseline cost of a file
const baseline = analytics.estimateFileTokens('src/app/auth/auth.service.ts');
// → 512 (tokens needed to send the whole file)

// Save report to disk
analytics.saveReport(); // → tools/code-analyzer/reports/token-analytics.json
```

---

### AutoRefresh

**File:** `tools/code-analyzer/src/utils/auto-refresh.js`

```javascript
const { AutoRefresh } = require('./src/utils/auto-refresh');

const refresh = new AutoRefresh('C:/project', {
  debounceMs: 30000,        // Wait 30s after last change
  pollIntervalMs: 5000,     // Check every 5s
  extensions: ['.ts', '.html', '.scss'],
  useGitDiff: true,         // Use git diff for change detection
  onRefresh: (changedFiles) => {
    console.log(`Re-indexing ${changedFiles.length} files...`);
    queryEngine = new QueryEngine(ROOT);
    queryEngine.buildIndex();
    snippetService.clearCache();
  },
});

refresh.start();

// Get status
refresh.getStatus();
// → { running: true, mode: 'git-poll', pendingChanges: [], stats: { checksPerformed: 12, ... } }

// Manual check
refresh.checkNow();

// Force full re-index
refresh.forceRefresh();

// Stop watching
refresh.stop();
```

---

## Integration Bridges

### RipgrepBridge

**File:** `tools/code-analyzer/src/integrations/ripgrep-bridge.js`

Provides 5-10x faster text search when `rg` binary is available. Falls back to Node.js regex seamlessly.

```javascript
const { RipgrepBridge } = require('./src/integrations/ripgrep-bridge');
const rg = new RipgrepBridge('C:/project');

// Check availability
console.log(rg.isAvailable()); // true/false
console.log(rg.getInfo());     // { available: true, version: "14.1.0", fallback: "Node.js fs + RegExp" }

// Search (automatically uses rg if available, Node.js if not)
const results = rg.search('handleLogin', {
  filePattern: '*.ts',
  caseSensitive: false,
  maxResults: 20,
  wholeWord: true,
  searchDir: 'src',
  exclude: ['.spec.', 'node_modules'],
});
console.log(`${results.totalMatches} matches via ${results.method} in ${results.duration}ms`);

// Find files by pattern
const tsFiles = rg.findFiles('*.service.ts');

// Count occurrences
const count = rg.count('TODO|FIXME', { filePattern: '*.ts' });

// Search and preview replacement
const preview = rg.searchAndPreview('getUserName', 'getUsername', { filePattern: '*.ts' });
```

---

### TreeSitterBridge

**File:** `tools/code-analyzer/src/integrations/treesitter-bridge.js`

Provides precise AST parsing when tree-sitter npm packages are installed. Falls back to regex-based extraction.

```javascript
const { TreeSitterBridge } = require('./src/integrations/treesitter-bridge');
const ts = new TreeSitterBridge('C:/project');

// Check availability
console.log(ts.isAvailable()); // true if tree-sitter is installed
console.log(ts.getInfo());
// { available: false, languages: [], fallback: "Regex-based parsing (ast-utils.js)" }

// Extract methods with precise boundaries (works with or without tree-sitter)
const methods = ts.extractMethods('src/app/auth/auth.service.ts');
methods.forEach(m => {
  console.log(`${m.parent}.${m.name} lines ${m.startLine}-${m.endLine}`);
});

// Get a specific method body
const body = ts.extractMethodBody('src/app/auth/auth.service.ts', 'login', 'AuthService');
console.log(body.body); // Exact method body text

// Extract class structure
const classes = ts.extractClasses('src/app/auth/auth.service.ts');

// Symbol at cursor position (useful for IDE integration)
const symbol = ts.getSymbolAtPosition('src/app/auth/auth.service.ts', 42, 10);
```

---

## Token Efficiency Guide

The entire service layer is designed to minimize token usage when serving context to LLMs.

### Token Cost Comparison

| Operation | Whole File | Our Service | Savings |
|-----------|-----------|-------------|---------|
| "What's in auth.service.ts?" | ~500 tokens | `outline` → ~38 tokens | **92%** |
| "What does AuthService look like?" | ~500 tokens | `signature` → ~12 tokens | **98%** |
| "Show me the login method" | ~500 tokens | `snippet` → ~85 tokens | **83%** |
| "Who calls login()?" | Read 10 files (~5000) | `callers` → ~120 tokens | **98%** |
| "Full understanding of AuthService" | ~500 tokens | `compose/compact` → ~650 tokens | **0%*** |
| "What changed in last commit?" | Read all files (~8000) | `diff-context` → ~95 tokens | **99%** |

*Compact mode adds structured context that raw file doesn't provide — worth the investment.

### Recommended Usage Patterns

```javascript
// Quick reference (use signatures mode)
composer.compose('AuthService', { mode: 'signatures' }); // ~12 tokens

// Understanding a symbol (use compact mode) 
composer.compose('AuthService', { mode: 'compact' });    // ~650 tokens

// Deep analysis (use full mode)
composer.compose('AuthService', { mode: 'full' });       // ~1800 tokens

// Before editing a file
composer.composeFileContext('src/app/auth/auth.service.ts', { mode: 'compact' });

// Understanding recent changes
diffContextService.getCompactDiffSummary(); // ~50 tokens
```

---

## Error Handling

All services return error objects instead of throwing:

```json
{
  "error": "File not found: src/app/nonexistent.ts",
  "file": "src/app/nonexistent.ts"
}
```

Check for `.error` property before using results:

```javascript
const result = snippetService.getSnippet('nonexistent.ts', 10);
if (result.error) {
  console.log(`Failed: ${result.error}`);
} else {
  console.log(result.text);
}
```
