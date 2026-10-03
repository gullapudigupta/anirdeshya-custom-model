AI SIDECAR API — QUICK REFERENCE CARD

════════════════════════════════════════════════════════════════════════════════

INSTALL & RUN

1. Prerequisites
   ✓ Tools verified:    pwsh ai_tools_setup/verify_and_link_tools.ps1
   ✓ Symbols extracted: pwsh ai_tools_setup/run_symbol_extractor.ps1
   ✓ Ctags generated:   ctags -R --languages=C# --output-format=json -f ai_tools_setup/artifacts/tags .

2. Start API
   cd ai_tools_setup/sidecar-api
   npm install
   npm start
   → Listens on http://localhost:3001

3. Verify
   Invoke-RestMethod http://localhost:3001/health
   → Returns JSON with status, resources, environment

════════════════════════════════════════════════════════════════════════════════

ALL ENDPOINTS

GET /health
   Returns: API status, resource availability
   Example: Invoke-RestMethod http://localhost:3001/health

GET /search?q=<query>&limit=<n>
   Returns: Files/lines matching query (ripgrep)
   Example: curl "http://localhost:3001/search?q=GetConsumptionGraphData&limit=5"

GET /symbols?query=<name>  OR  ?file=<path>  OR  ?all=true
   Returns: Symbols from Roslyn + ctags (Kind, Name, Location, Line)
   Example: curl "http://localhost:3001/symbols?query=FitnessReportLogic"

GET /snippet?file=<path>&line=<n>
   Returns: Code lines around a line number (±5 by default)
   Example: curl "http://localhost:3001/snippet?file=FitnessReportLogic.cs&line=42"

GET /signature?query=<name>
GET /signature?file=<path>&line=<n>
   Returns: Declaration line(s) only — no body, cheapest lookup (~60-120 chars)
   Example: curl "http://localhost:3001/signature?query=GetConsumptionGraphData"

GET /outline?file=<path>
GET /outline?file=<path>&kind=method,property
GET /outline?file=<path>&flat=true
   Returns: All symbols in a file grouped by class — no code bodies (~200-400 chars)
   Example: curl "http://localhost:3001/outline?file=FitnessReportLogic.cs"

GET /callers?name=<methodName>
GET /callers?name=<methodName>&file=<path>&limit=<n>
   Returns: All call-sites with enclosing symbol — no snippets needed
   Example: curl "http://localhost:3001/callers?name=GetConsumptionGraphData"

GET /diff-context
GET /diff-context?base=<branch-or-commit>
GET /diff-context?staged=true
   Returns: Changed lines since HEAD + enclosing symbol per hunk
   Example: curl "http://localhost:3001/diff-context"
   Example: curl "http://localhost:3001/diff-context?base=main"

GET /analytics
   Returns: Per-endpoint + overall token-reduction stats since process start
   Example: Invoke-RestMethod http://localhost:3001/analytics

GET /ast-node?file=<path>&extract=methods|classes
GET /ast-node?file=<path>&type=<nodeType>
   Returns: Syntax-aware AST nodes with full text + line ranges (tree-sitter C#)
   Example: curl "http://localhost:3001/ast-node?file=FitnessReportLogic.cs&extract=methods"

POST /compose-context
   Body: {"query":"...","maxTokens":500,"mode":"compact|signatures|full"}
   Returns: Minimal, LLM-ready context bundle (ripgrep + symbols + snippets)
   Example:
   Invoke-RestMethod -Method Post http://localhost:3001/compose-context `
     -ContentType "application/json" `
     -Body '{"query":"GetConsumptionGraphData","maxTokens":500}'

POST /refresh
   Body: {"force":true}  (optional — omit for auto-detected changes only)
   Returns: Status of symbol extraction + ctags regeneration
   Example: Invoke-RestMethod -Method Post http://localhost:3001/refresh

════════════════════════════════════════════════════════════════════════════════

TOKEN COST — QUICK GUIDE

Largest → Smallest
────────────────────────────────────────────────────────────────────────────────
Whole file      /snippet (30ln)  /ast-node   /outline   /signature
~15 000 chars      ~600 chars     ~400 chars  ~200 chars   ~80 chars

Question                                   Best endpoint
────────────────────────────────────────────────────────────────────────────────
"Where is X defined?"                      /symbols?query=X
"What does X look like (signature only)?"  /signature?query=X      ← cheapest
"What is in file Y?"                       /outline?file=Y         ← no bodies
"Full body of method X"                    /ast-node + extract=methods
"Who calls X?"                             /callers?name=X
"What changed since last commit?"          /diff-context           ← most precise
"LLM context bundle"                       POST /compose-context
"Find a text pattern"                      /search?q=pattern
"Lines around line N"                      /snippet?file=..&line=N

/compose-context modes
   compact    (default) symbol + ±5 line snippet     ~400–800 tokens
   signatures           declaration only, no snippet ~50–150 tokens
   full                 symbol + ±15 line snippet     ~800–2000 tokens

════════════════════════════════════════════════════════════════════════════════

COMMON TASKS

Search for a function
  curl "http://localhost:3001/search?q=GetCalculatedData&limit=10"

Get all symbols in a file
  curl "http://localhost:3001/symbols?file=FitnessReportLogic.cs"

Get declaration (signature) of a method  ← start here
  curl "http://localhost:3001/signature?query=GetCalculatedData"

See full structure of a file  ← no code bodies
  curl "http://localhost:3001/outline?file=FitnessReportLogic.cs"

Find who calls a method
  curl "http://localhost:3001/callers?name=GetCalculatedData"

See what changed since last commit
  curl "http://localhost:3001/diff-context"

Get full method body (AST)
  curl "http://localhost:3001/ast-node?file=FitnessReportLogic.cs&extract=methods"

Get lines around line 42
  curl "http://localhost:3001/snippet?file=FitnessReportLogic.cs&line=42"

Build LLM context bundle (signatures mode — smallest)
  Invoke-RestMethod -Method Post http://localhost:3001/compose-context `
    -ContentType "application/json" `
    -Body '{"query":"your question here","maxTokens":200,"mode":"signatures"}'

Force refresh after code changes
  Invoke-RestMethod -Method Post http://localhost:3001/refresh `
    -ContentType "application/json" -Body '{"force":true}'

════════════════════════════════════════════════════════════════════════════════

MCP INTEGRATION

The sidecar exposes all endpoints as MCP tools via src/mcp/mcpServer.js.
Kiro is configured via .kiro/settings/mcp.json (server name: ai-sidecar).
The HTTP API must be running before the MCP server connects.

MCP tool → HTTP endpoint mapping:
  health              GET /health
  search_code         GET /search
  lookup_symbols      GET /symbols
  get_snippet         GET /snippet
  get_signature       GET /signature       ← cheapest
  get_outline         GET /outline         ← no bodies
  get_callers         GET /callers
  get_diff_context    GET /diff-context
  get_ast_node        GET /ast-node
  compose_context     POST /compose-context
  refresh_index       POST /refresh
  get_token_analytics GET /analytics

Test MCP manually:
  npm run mcp     (from sidecar-api directory, then type JSON-RPC messages)

MCP troubleshooting:
  → HTTP API must be running first (npm start)
  → Check SIDECAR_PORT in .env matches PORT
  → Reload from Kiro MCP panel if tools don't appear

════════════════════════════════════════════════════════════════════════════════

TOKEN ANALYTICS

Every endpoint call is measured vs a whole-file baseline (~3 750 tokens).
Stats accumulate in-process and are written to logs/token-analytics.jsonl.

View live stats:
  Invoke-RestMethod http://localhost:3001/analytics | ConvertTo-Json -Depth 5

Tail the JSONL log (Windows):
  Get-Content logs/token-analytics.jsonl -Wait

Example output:
  overallReductionPct: "95%"
  /signature  → reductionPct: "99%"   avgActualTokens: 20
  /outline    → reductionPct: "98%"   avgActualTokens: 75
  /callers    → reductionPct: "97%"   avgActualTokens: 100
  /diff-context → reductionPct: "96%" (baseline: 15 000 tokens for changed files)

════════════════════════════════════════════════════════════════════════════════

RECOMMENDED WORKFLOW

1. Start with /signature or /outline — almost always enough to orient
2. Need a method body? Use /ast-node for that method only
3. Need to understand usage? Use /callers
4. Reviewing a change? Always start with /diff-context
5. Need a bundled multi-symbol context? Use /compose-context with mode=signatures
6. Never send whole files — use snippets only when required, keep context small
7. Check /analytics to see cumulative token savings

════════════════════════════════════════════════════════════════════════════════

CONFIGURATION

Environment Variables (.env in sidecar-api/)
  REPO_ROOT    Repository root path (required)
  PORT         API port (default: 3001)
  HOST         API host (default: localhost)
  LOG_LEVEL    Winston log level (default: info)
  NODE_ENV     Environment (default: development)

Example .env
  REPO_ROOT=C:\sarah laptop\erv-heart\MyFirstProject-v2\src
  PORT=3001
  LOG_LEVEL=info

════════════════════════════════════════════════════════════════════════════════

AUTO-REFRESH

Every request (except /health and /refresh) runs a background check:
  1. git diff --name-only HEAD -- "*.cs"   for C# source changes
  2. SHA-256 hash fallback on symbols.json if git unavailable
  30-second debounce prevents rapid re-runs.

Force an immediate re-run:
  Invoke-RestMethod -Method Post http://localhost:3001/refresh `
    -ContentType "application/json" -Body '{"force":true}'

Scheduled refresh (Windows Task Scheduler):
  pwsh ai_tools_setup/register_refresh_task.ps1 -Action register -Hours 6
  pwsh ai_tools_setup/register_refresh_task.ps1 -Action unregister

════════════════════════════════════════════════════════════════════════════════

DEBUGGING

View logs (Windows, real-time)
  Get-Content ai_tools_setup/sidecar-api/logs/combined.log -Wait

View errors
  Get-Content ai_tools_setup/sidecar-api/logs/error.log

Verbose output
  $env:LOG_LEVEL="debug"; npm start

Check resources
  Invoke-RestMethod http://localhost:3001/health | ConvertTo-Json -Depth 5

════════════════════════════════════════════════════════════════════════════════

TROUBLESHOOTING QUICK FIXES

API won't start
  → node --version  (need 16+)
  → Check .env: REPO_ROOT set correctly?
  → Check logs: Get-Content logs/error.log

/health shows missing resources
  → pwsh ai_tools_setup/run_symbol_extractor.ps1
  → ctags -R --languages=C# --output-format=json -f ai_tools_setup/artifacts/tags .

Tools not found
  → pwsh ai_tools_setup/verify_and_link_tools.ps1
  → choco install ripgrep  (or winget install BurntSushi.ripgrep.MSVC)

Port 3001 in use
  → Set PORT=3002 in sidecar-api/.env

Symbols stale after code change
  → POST /refresh {"force":true}  or let auto-refresh detect it

Tree-sitter parse errors
  → npm list tree-sitter-c-sharp  (verify installed)
  → File must be UTF-8 encoded

════════════════════════════════════════════════════════════════════════════════

FILES & FOLDERS

ai_tools_setup/
  00_MASTER_SETUP.ps1              → Install tools, restore NuGet, optional task
  RUN_ME_FIRST.ps1                 → One-shot: setup + start API
  run_sidecar_api.ps1              → Start sidecar (Node.js)
  run_symbol_extractor.ps1         → Build + run Roslyn extractor
  register_refresh_task.ps1        → Schedule / unschedule auto-refresh
  diagnose_setup.ps1               → Verify tools, ports, smoke tests
  verify_and_link_tools.ps1        → Locate tools on PATH, regen wrappers
  update_tools.ps1                 → Upgrade installed tools
  test_extractor.ps1               → Smoke-test Roslyn extractor binary
  RoslynSymbolExtractor/           → C# symbol extractor project
  symbols/symbols.json             → Roslyn symbols (generated, 27 544 entries)
  artifacts/tags                   → ctags index (generated, ~12 MB)
  sidecar-api/
    src/index.js                   → Express server + all routes
    src/handlers/                  → One handler per endpoint (11 total)
    src/services/                  → searchService, symbolService, snippetService, astService
    src/utils/                     → logger, toolExecutor, cache
    package.json                   → Dependencies (express, tree-sitter, winston, …)
    .env / .env.example            → Configuration
    README.md                      → Full API documentation
    SETUP.md                       → Step-by-step setup & all endpoints
    QUICK_REFERENCE.md             → This file
    logs/                          → error.log, combined.log

════════════════════════════════════════════════════════════════════════════════

SEE ALSO

  README.md      — Complete API documentation and architecture
  SETUP.md       — Step-by-step setup and all endpoint examples
  ../README.md   — Top-level ai_tools_setup overview

════════════════════════════════════════════════════════════════════════════════
