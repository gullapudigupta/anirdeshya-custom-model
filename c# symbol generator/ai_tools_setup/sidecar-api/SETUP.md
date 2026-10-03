# Sidecar API Setup & Quick Start

## Summary
Production-ready Node.js Express API that serves token-efficient code context from this repository to LLMs (Kiro, GitHub Copilot, Android Studio CodeGen). Orchestrates ripgrep, ctags, tree-sitter, and Roslyn symbol data behind a single REST interface.

## Prerequisites

1. **Node.js** (v16+)
   - Verify: `node --version` and `npm --version`

2. **Tools installed & verified**
   - Run: `pwsh ai_tools_setup/verify_and_link_tools.ps1`
   - Should create wrappers in `tools/` folder: git, rg, ctags, node

3. **Roslyn symbols extracted**
   - Run: `pwsh ai_tools_setup/run_symbol_extractor.ps1`
   - Produces: `ai_tools_setup/symbols/symbols.json` (27,544 symbols)

4. **ctags file generated**
   - Run: `ctags -R --languages=C# --output-format=json -f ai_tools_setup/artifacts/tags .`

## Installation

```powershell
# Navigate to sidecar directory
cd ai_tools_setup/sidecar-api

# Install npm dependencies
npm install

# Copy and configure .env
copy .env.example .env
# Edit .env: set REPO_ROOT to the absolute repo path
```

## Running the API

```powershell
# Start (production)
npm start

# Start with auto-reload (development)
npm run dev

# Verify
Invoke-RestMethod http://localhost:3001/health
```

Expected `/health` response:
```json
{
  "status": "ok",
  "timestamp": "2026-08-09T12:00:00.000Z",
  "environment": {
    "repoRoot": "C:\\sarah laptop\\erv-heart\\MyFirstProject-v2\\src",
    "nodeEnv": "development"
  },
  "resources": {
    "symbols": { "exists": true, "size": 45678 },
    "tags": { "exists": true },
    "artifacts": { "exists": true }
  }
}
```

## All API Endpoints

### Core lookup

```powershell
# Full-text search (ripgrep)
curl "http://localhost:3001/search?q=GetConsumptionGraphData&limit=5"

# Symbol lookup by name
curl "http://localhost:3001/symbols?query=FitnessReportLogic"

# Symbols in a file
curl "http://localhost:3001/symbols?file=Energy_ReconversionSystem.Business.Logic/SiteLevelReports/FitnessReportLogic.cs"

# Code snippet around a line
curl "http://localhost:3001/snippet?file=...FitnessReportLogic.cs&line=42"
```

### Token-efficient endpoints (prefer these over snippets)

```powershell
# Declaration only — no body (~1-3 lines, cheapest lookup)
curl "http://localhost:3001/signature?query=GetConsumptionGraphData"
curl "http://localhost:3001/signature?file=FitnessReportLogic.cs&line=42"

# Full file structure — all symbols, no code bodies
curl "http://localhost:3001/outline?file=Energy_ReconversionSystem.Business.Logic/SiteLevelReports/FitnessReportLogic.cs"

# Filter outline to specific kinds
curl "http://localhost:3001/outline?file=FitnessReportLogic.cs&kind=method,property"

# All call-sites of a symbol (pre-computed, no snippet fetching needed)
curl "http://localhost:3001/callers?name=GetConsumptionGraphData"
curl "http://localhost:3001/callers?name=GetConsumptionGraphData&file=FitnessReportLogic.cs"

# What changed since last commit + enclosing symbol per hunk
curl "http://localhost:3001/diff-context"
curl "http://localhost:3001/diff-context?base=main"
curl "http://localhost:3001/diff-context?staged=true"
```

### AST and context composition

```powershell
# Extract method/class nodes (tree-sitter)
curl "http://localhost:3001/ast-node?file=FitnessReportLogic.cs&extract=methods"
curl "http://localhost:3001/ast-node?file=FitnessReportLogic.cs&extract=classes"

# Build LLM-ready context bundle
curl -X POST http://localhost:3001/compose-context `
  -H "Content-Type: application/json" `
  -d '{"query":"GetConsumptionGraphData","maxTokens":500}'

# signatures mode — declaration text only, smallest possible bundle
curl -X POST http://localhost:3001/compose-context `
  -H "Content-Type: application/json" `
  -d '{"query":"GetConsumptionGraphData","maxTokens":200,"mode":"signatures"}'

# Refresh symbol index
curl -X POST http://localhost:3001/refresh
```

### `/compose-context` modes

| Mode | What it returns | Typical tokens |
|------|-----------------|----------------|
| `compact` (default) | Symbol info + ±5 line snippet | ~400–800 |
| `signatures` | Declaration line only, no snippet | ~50–150 |
| `full` | Symbol info + ±15 line snippet | ~800–2000 |

## Token cost guide

```
Largest → Smallest
──────────────────────────────────────────────────────────────
Whole file  /snippet (30ln)  /ast-node  /outline  /signature
~15 000 ch    ~600 ch         ~400 ch    ~200 ch    ~80 ch
```

| Question | Best endpoint |
|----------|---------------|
| Where is X defined? | `/symbols?query=X` |
| What does X look like? | `/signature?query=X` ← cheapest |
| What is in file Y? | `/outline?file=Y` ← no bodies |
| Full body of method X | `/ast-node` + `extract=methods` |
| Who calls X? | `/callers?name=X` |
| What changed recently? | `/diff-context` ← most precise |
| LLM context bundle | `POST /compose-context` |

## Folder Structure

```
ai_tools_setup/
  sidecar-api/
    src/
      index.js                     # Express app + route registration
      config/config.js             # Configuration
      mcp/
        mcpServer.js               # MCP stdio server (12 tools → HTTP forwarding)
      utils/
        logger.js                  # Winston logger
        toolExecutor.js            # Spawn rg, ctags, git
        cache.js                   # LRU cache manager
        tokenAnalytics.js          # Token-reduction measurement middleware + store
      services/
        searchService.js           # ripgrep integration
        symbolService.js           # ctags + Roslyn symbols
        snippetService.js          # Code line extraction
        astService.js              # tree-sitter AST parsing
      handlers/
        healthHandler.js           # GET /health
        searchHandler.js           # GET /search
        symbolsHandler.js          # GET /symbols
        snippetHandler.js          # GET /snippet
        signatureHandler.js        # GET /signature
        outlineHandler.js          # GET /outline
        callersHandler.js          # GET /callers
        diffContextHandler.js      # GET /diff-context
        astNodeHandler.js          # GET /ast-node
        analyticsHandler.js        # GET /analytics
        composeContextHandler.js   # POST /compose-context
        refreshHandler.js          # POST /refresh
    package.json
    .env / .env.example
    README.md
    QUICK_REFERENCE.md
    logs/
      error.log
      combined.log
      token-analytics.jsonl        # Per-request token savings (JSONL)
```

## MCP Integration

The sidecar exposes all endpoints as MCP (Model Context Protocol) tools via a stdio server.
Kiro picks it up automatically through `.kiro/settings/mcp.json`.

**Prerequisites:** the HTTP API must already be running (`npm start`) before Kiro launches the MCP server.

```powershell
# Start the HTTP API first
npm start

# Test the MCP server manually (optional)
npm run mcp
```

Kiro MCP config is at `.kiro/settings/mcp.json` — server name `ai-sidecar`. All 12 tools are auto-approved.

MCP tool names:

| Tool | Endpoint |
|------|----------|
| `health` | GET /health |
| `search_code` | GET /search |
| `lookup_symbols` | GET /symbols |
| `get_snippet` | GET /snippet |
| `get_signature` | GET /signature |
| `get_outline` | GET /outline |
| `get_callers` | GET /callers |
| `get_diff_context` | GET /diff-context |
| `get_ast_node` | GET /ast-node |
| `compose_context` | POST /compose-context |
| `refresh_index` | POST /refresh |
| `get_token_analytics` | GET /analytics |

## Token Analytics

Every endpoint response is measured against a whole-file baseline (~3,750 tokens). Stats accumulate in-process and are also written to `logs/token-analytics.jsonl`.

```powershell
# View live stats
Invoke-RestMethod http://localhost:3001/analytics | ConvertTo-Json -Depth 5

# Tail the JSONL log
Get-Content logs/token-analytics.jsonl -Wait
```

Response shape:
```json
{
  "summary": {
    "totalRequests": 42,
    "totalActualTokens": 8400,
    "totalBaselineTokens": 157500,
    "totalTokensSaved": 149100,
    "overallReductionPct": "95%"
  },
  "byEndpoint": {
    "/signature": { "requests": 10, "reductionPct": "99%", "avgActualTokens": 20 },
    "/outline":   { "requests":  8, "reductionPct": "98%", "avgActualTokens": 75 }
  },
  "recent": [ ... last 20 records ... ]
}
```

## Debugging

```powershell
# View logs (Windows)
Get-Content ai_tools_setup/sidecar-api/logs/combined.log -Wait

# View errors only
Get-Content ai_tools_setup/sidecar-api/logs/error.log

# Verbose output
$env:LOG_LEVEL="debug"; npm start

# Test via PowerShell
Invoke-RestMethod http://localhost:3001/health | ConvertTo-Json -Depth 5
```

## Scheduling (Auto-refresh symbols every 6 hours)

```powershell
# Register Windows scheduled task
pwsh ai_tools_setup/register_refresh_task.ps1 -Action register -Hours 6

# Unregister
pwsh ai_tools_setup/register_refresh_task.ps1 -Action unregister
```

The auto-refresh middleware also runs on every request: it checks for C# source changes via `git diff` (30-second debounce) and re-runs the extractor in the background if changes are found. Force an immediate refresh:

```powershell
Invoke-RestMethod -Method Post http://localhost:3001/refresh `
  -ContentType "application/json" -Body '{"force":true}'
```

## Troubleshooting

**API won't start** — check `node -v` (need 16+), review `logs/error.log`

**`/health` shows missing resources** — run `pwsh ai_tools_setup/run_symbol_extractor.ps1` and regenerate ctags

**rg / ctags not found** — run `pwsh ai_tools_setup/verify_and_link_tools.ps1`

**Port 3001 in use** — set `PORT=3002` in `.env`

**Symbols stale** — `POST /refresh` with `{"force":true}` or let auto-refresh detect the change

**Tree-sitter errors** — confirm `npm list tree-sitter-c-sharp` shows a version; file must be UTF-8

**MCP server can't connect** — verify the HTTP API is running first (`npm start`); check `SIDECAR_PORT` in `.env` matches `PORT`

**MCP tools not appearing in Kiro** — reload the MCP server from the Kiro MCP panel, or restart Kiro

## Next Steps

1. **VS Code Extension** — queries `/compose-context` on Copilot invocation, injects context into the prompt
2. **IntelliJ Plugin** — right-click symbol → "Fetch AI Context" → results in tool window
3. **GitHub Action** — auto-update `symbols.json` on push, upload as build artifact
4. **Zoekt Integration** — full-repo indexed search at scale
