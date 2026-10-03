# AI Tools Setup

Code-analysis toolchain for **Energy Reconversion System** (.NET Framework 4.8).
Provides a local REST API (sidecar) that serves symbol search, code search, and
LLM-ready context to Kiro and other AI tools without uploading source code.

---

## Quick start

```powershell
# 1. Install tools (run PowerShell as Administrator once)
.\00_MASTER_SETUP.ps1

# 2. Extract Roslyn symbols from the solution
.\run_symbol_extractor.ps1

# 3. Start the sidecar API
.\run_sidecar_api.ps1
# or: cd sidecar-api && node src/index.js
```

API is live at `http://localhost:3001`.
Verify with: `Invoke-RestMethod http://localhost:3001/health`

---

## Sidecar API endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET  | `/health` | Liveness check |
| GET  | `/search?q=<term>&limit=<n>` | Full-text search (ripgrep) |
| GET  | `/symbols?query=<name>` | Symbol lookup by name (Roslyn + ctags) |
| GET  | `/symbols?file=<rel/path.cs>` | All symbols in a file |
| GET  | `/symbols?all=true` | Paginated full symbol list |
| GET  | `/snippet?file=<rel/path.cs>&line=<n>` | Code lines around a line number |
| GET  | `/signature?query=<name>` | Declaration line(s) only — no body (~80 chars) |
| GET  | `/signature?file=<f>&line=<n>` | Declaration of symbol at a specific line |
| GET  | `/outline?file=<rel/path.cs>` | Full structural outline — all symbols, no code |
| GET  | `/outline?file=<f>&kind=method,property` | Filtered outline by symbol kind |
| GET  | `/outline?file=<f>&flat=true` | Flat sorted symbol list (no class grouping) |
| GET  | `/callers?name=<methodName>` | All call-sites of a symbol across the repo |
| GET  | `/callers?name=<m>&file=<f>&limit=<n>` | Call-sites scoped to one file |
| GET  | `/diff-context` | Changed lines since HEAD + enclosing symbol per hunk |
| GET  | `/diff-context?base=<branch>` | Changed lines vs a branch or commit |
| GET  | `/diff-context?staged=true` | Only staged (index) changes |
| GET  | `/ast-node?file=<rel/path.cs>&extract=methods` | Tree-sitter method nodes with full body |
| GET  | `/ast-node?file=<rel/path.cs>&extract=classes` | Tree-sitter class nodes |
| POST | `/compose-context` | `{"query":"..","maxTokens":2000,"mode":"compact\|signatures\|full"}` |
| POST | `/refresh` | `{"force":true}` — re-extract symbols + ctags |

### `/compose-context` modes

| Mode | What it returns | Typical token cost |
|------|-----------------|--------------------|
| `compact` (default) | Symbol info + ±5 line snippet | ~400–800 tokens |
| `signatures` | Declaration line only, no snippet | ~50–150 tokens |
| `full` | Symbol info + ±15 line snippet | ~800–2000 tokens |

**Auto-refresh**: every incoming request checks for C# source changes via git diff
(fallback: SHA-256 hash of `symbols.json`). If changes are detected the extractor
runs in the background — no manual trigger needed.

---

## How the four tools work together

```
Your C# source files
        │
        ├──── Roslyn (RoslynSymbolExtractor.exe)
        │         Semantic analysis: reads the syntax tree of every .cs file.
        │         Extracts: classes, structs, interfaces, enums, methods,
        │                   properties, fields, delegates, namespaces.
        │         Output: symbols/symbols.json  (or  symbols/symbols.tags)
        │                 27 000+ entries with Kind, Name, Location, Line, Column.
        │
        ├──── Universal Ctags
        │         Regex + language-grammar based tag generator.
        │         Produces: artifacts/tags  (12 MB, JSON-lines format)
        │         Covers: same symbol types as Roslyn but also adds
        │                 scope/scopeKind (which class owns a method).
        │         Used by: SymbolService for fast line-position lookups
        │                  and scope context that Roslyn does not provide.
        │
        ├──── ripgrep (rg)
        │         Plain-text regex search across every file.
        │         Does NOT understand syntax; just finds text patterns fast.
        │         Used by: /search endpoint, and as Step 1 inside
        │                  /compose-context to locate candidate files.
        │
        └──── Tree-sitter
                  Incremental, error-tolerant parser.
                  Builds a full Concrete Syntax Tree (CST) of a .cs file
                  on demand, directly in Node.js via tree-sitter-c-sharp.
                  Used by: /ast-node endpoint only.
                  Output: structured node objects with type, text, line ranges.
```

### What each tool contributes and why all four are needed

| Tool | What it gives you | What it cannot do |
|------|--------------------|-------------------|
| **Roslyn** | Deep semantic info: exact Kind, correct name for overloads, full location | Slow for whole-solution load; no scope hierarchy |
| **ctags** | Fast symbol-by-file index with scope; line numbers without loading solution | No type information; can misfire on complex generics |
| **ripgrep** | Sub-millisecond full-text search; finds usages and references anywhere | No symbol awareness; returns raw text lines |
| **Tree-sitter** | Full syntax tree of any single file; method bodies, parameter lists, access modifiers | Only one file at a time; no cross-file type resolution |

---

## How tree-sitter fits in detail

### What tree-sitter is

Tree-sitter is an incremental parsing library. Given a `.cs` file it produces
a **Concrete Syntax Tree** — every token, every node, with exact line/column
positions — without needing to compile the file or load a full solution.
It uses the `tree-sitter-c-sharp` grammar.

### What the `/ast-node` endpoint returns

```
GET /ast-node?file=Energy_ReconversionSystem.Business.Logic/SomeLogic.cs&extract=methods
```

Returns an array of method nodes, each with:

```json
{
  "type": "method_declaration",
  "text": "public List<FitnessReportVM> GetConsumptionData(int siteId, DateTime from) { ... }",
  "startLine": 42,
  "endLine": 78,
  "shortText": "public List<FitnessReportVM> GetConsumptionData(int siteId,"
}
```

You get the **full method body as text** with line numbers. That is something
neither Roslyn symbols.json nor ctags provide (both give you a line number but
not the surrounding code block).

### How tree-sitter links to the other tools in the pipeline

#### 1. Tree-sitter + ripgrep (`/compose-context`)

```
POST /compose-context  { "query": "GetConsumptionData" }

Step 1  ripgrep  → finds every file that mentions "GetConsumptionData" (fast)
Step 2  Roslyn   → getSymbolInfo("GetConsumptionData") → Kind=Method, Location, Line
Step 3  Snippet  → reads the file at that line ± 5 lines (plain file read)
        (tree-sitter is not used here because SnippetService does a raw line read)
```

Tree-sitter would be used here if you called `/ast-node` directly to get the
full method body rather than a short snippet. The `composeContextHandler` uses
`SnippetService` (faster, no parse step) for the default context bundle but
you can call `/ast-node` separately to get a clean method body without
surrounding comments or blank lines.

#### 2. Tree-sitter + ctags (symbol scope enrichment)

ctags gives `scope: "FitnessReportLogic"` for a method tag, telling you which
class the method belongs to. Tree-sitter can independently confirm this and
give you the entire class body if needed. They agree on structure but tree-sitter
has finer granularity (access modifiers, generic constraints, attribute lists).

#### 3. Tree-sitter standalone for code quality checks

You can use `/ast-node?type=method_declaration` to extract **all methods** from
a file with their full bodies. This is useful for:
- Counting cyclomatic complexity
- Finding methods above a line-count threshold
- Extracting XML doc comments attached to a method

#### 4. When to use which tool

```
"Where is class FitnessReportLogic defined?"
  → /symbols?query=FitnessReportLogic   (Roslyn + ctags, fast, cross-file)

"Show me every place FitnessReportLogic is used"
  → /search?q=FitnessReportLogic        (ripgrep, full-text, all files)

"Give me the full body of method GetConsumptionData"
  → /ast-node?file=...&extract=methods  (tree-sitter, single file)
    then filter result by method name

"Build a context bundle for an LLM prompt"
  → POST /compose-context               (orchestrates all three above)
```

---

## Token reduction strategy

The goal is to never send a whole file to the LLM. Each endpoint targets a
different level of granularity:

```
Largest (avoid)                                             Smallest (prefer)
────────────────────────────────────────────────────────────────────────────────
Whole file      /snippet (30 ln)  /ast-node   /outline   /signature
~15 000 chars      ~600 chars      ~400 chars   ~200 chars   ~80 chars
```

### Decision guide: which endpoint to call

```
Question                                      Best endpoint
────────────────────────────────────────────────────────────────────────────────
"Where is X defined?"                         /symbols?query=X
"What does X look like (signature only)?"     /signature?query=X      ← cheapest
"What is in file Y?"                          /outline?file=Y         ← no bodies
"Show me the full body of method X"           /ast-node + extract=methods
"Who calls X?"                                /callers?name=X
"What changed since last commit?"             /diff-context           ← most precise
"Give me context for an LLM prompt"           POST /compose-context
"Search for a text pattern"                   /search?q=pattern
"Show a few lines around line N"              /snippet?file=..&line=N
```

### Token budget examples

| Task | Old approach | New approach | Savings |
|------|-------------|-------------|---------|
| Understand a method signature | `/snippet` 30 lines (~600 chars) | `/signature` (~80 chars) | ~87% |
| Understand a 500-line file | Send whole file (~15 000 chars) | `/outline` (~300 chars) | ~98% |
| Find callers of a method | `/search` + 5×`/snippet` (~4 000 chars) | `/callers` (~400 chars) | ~90% |
| Review a code change | Changed files in full (~20 000 chars) | `/diff-context` (~500 chars) | ~97% |
| Context bundle (signatures only) | `compact` mode (~1 200 chars) | `signatures` mode (~200 chars) | ~83% |

### Recommended workflow

```
1. Start with /signature or /outline — almost always enough to orient
2. Need a method body? Use /ast-node for that one method only
3. Need to understand usage? Use /callers
4. Reviewing a change? Always start with /diff-context
5. Need a bundled multi-symbol context? Use /compose-context
6. Never send whole files — if you must use snippets, keep context window small
```

---

## RoslynSymbolExtractor

Extracts C# symbols from the solution using Roslyn's syntax API.

### JSON output (default)

```powershell
.\run_symbol_extractor.ps1
# writes: ai_tools_setup/symbols/symbols.json
```

Or directly:
```
RoslynSymbolExtractor.exe solution.sln out.json --json
```

### ctags output

Produces a sorted Extended ctags file compatible with Universal Ctags, Vim, Neovim, VS Code:

```
RoslynSymbolExtractor.exe solution.sln tags-file --ctags
```

Line format:
```
{name}  {file}  {lineNum};"  {kindLetter}  line:{N}  kind:{kindName}  language:CSharp
```

Kind letters: `c`=class/struct/interface/enum  `m`=method  `p`=property
              `f`=field  `d`=delegate  `n`=namespace

---

## Auto-refresh behaviour

Every API request (except `/health` and `/refresh` itself) runs a lightweight check:

1. **git diff** — `git diff --name-only HEAD -- "*.cs"` + untracked `.cs` files.
2. **File hash fallback** — SHA-256 of `symbols.json` vs last known hash.
   If the hash changed (external update) caches are reloaded without re-running the extractor.

30-second debounce prevents re-runs on rapid consecutive requests.
Force an immediate re-run at any time:

```bash
curl -X POST http://localhost:3001/refresh -H "Content-Type: application/json" -d "{\"force\":true}"
```

---

## Configuration

Copy `sidecar-api/.env.example` → `sidecar-api/.env`:

```
PORT=3001
HOST=localhost
REPO_ROOT=C:\sarah laptop\erv-heart\MyFirstProject-v2\src
LOG_LEVEL=info
```

---

## Required tools

| Tool | Install | Purpose |
|------|---------|---------|
| Universal Ctags | `choco install universal-ctags -y` | Symbol index (tags file) |
| ripgrep | `choco install ripgrep -y` | Full-text code search |
| Node.js 16+ | `choco install nodejs -y` | Sidecar API runtime |
| .NET / MSBuild | Visual Studio or SDK | Build RoslynSymbolExtractor |

Optional:
- `npm install -g tree-sitter-cli` — CLI for tree-sitter grammar testing
- Go + Zoekt — full-repo indexed search at scale

Manual installs: see `INSTALL_COMMANDS.md`

---

## Scripts

| Script | Purpose |
|--------|---------|
| `00_MASTER_SETUP.ps1` | Install tools, create wrappers, restore NuGet, optional scheduled task |
| `RUN_ME_FIRST.ps1` | One-shot: runs setup then starts sidecar API |
| `run_sidecar_api.ps1` | Start sidecar API (Node.js) |
| `run_symbol_extractor.ps1` | Build + run Roslyn extractor (JSON or ctags output) |
| `register_refresh_task.ps1` | Register/unregister Windows scheduled task for auto-refresh |
| `diagnose_setup.ps1` | Verify tools, repo structure, ports; optional smoke tests |
| `update_tools.ps1` | Upgrade installed tools via choco/npm/go |
| `verify_and_link_tools.ps1` | Locate tools on PATH and regenerate wrapper scripts |
| `test_extractor.ps1` | Quick smoke-test for the Roslyn extractor binary |

---

## Troubleshooting

**API won't start** — check `node --version` (needs ≥ 16), check `sidecar-api/logs/error.log`.

**`/health` shows resources missing** — run `run_symbol_extractor.ps1` and regenerate ctags:
```powershell
ctags -R --languages=C# --output-format=json -f ai_tools_setup\artifacts\tags .
```

**rg / ctags not found** — run `verify_and_link_tools.ps1` or check PATH.

**Port 3001 in use** — set `PORT=3002` in `sidecar-api/.env`.

**Symbols stale after code change** — the auto-refresh middleware should catch it;
or call `POST /refresh {"force":true}` manually.

---

## Files in this folder

| Path | Purpose |
|------|---------|
| `RoslynSymbolExtractor/` | C# symbol extractor project |
| `sidecar-api/` | Node.js REST API |
| `symbols/symbols.json` | Extracted Roslyn symbol data (generated) |
| `artifacts/tags` | ctags index file (generated) |
| `AI_Tools_Analysis.md` | Tool selection rationale and architecture notes |
| `AI_Integration_Suggestions.md` | IDE/CI integration patterns |
| `INSTALL_COMMANDS.md` | Manual install commands for each tool |
