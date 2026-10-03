AI Sidecar API

Production-ready REST API that orchestrates rg (ripgrep), ctags, tree-sitter, and Roslyn symbol extraction to deliver minimal, token-efficient code context for LLMs (Kiro, GitHub Copilot, Android Studio CodeGen).

Features
- Full-text search via ripgrep
- Symbol lookup via Roslyn (27 544 symbols) + ctags (12 MB index)
- Declaration-only and structural outline endpoints — sub-100-char lookups
- Caller graph: find all call-sites of a method without reading files
- Git diff-context: changed lines annotated with their enclosing symbol
- Syntax-aware AST queries via tree-sitter (C# grammar)
- Intelligent context composition for LLM prompts with three verbosity modes
- LRU in-memory cache (1-hour TTL)
- Auto-refresh middleware: detects C# source changes via git diff on every request
- Winston structured logging

Architecture
- Express.js REST API on localhost:3001 (configurable via .env)
- 11 route handlers, each a focused module in src/handlers/
- 4 services: searchService (rg), symbolService (Roslyn+ctags), snippetService, astService (tree-sitter)
- Spawns external tools via toolExecutor.js (git, rg, ctags)
- Loads Roslyn symbols from ai_tools_setup/symbols/symbols.json
- Reads ctags index from ai_tools_setup/artifacts/tags

────────────────────────────────────────────────────────────────────────────────

API ENDPOINTS

GET /health
  Returns API status, resource availability, environment info.

GET /search?q=<query>&limit=<n>
  Full-text search using ripgrep.
  Parameters:
    q      (required) search term or regex
    limit  (optional, default 10) max results
  Response: { query, count, results: [{ file, line, column, text, matches }] }

GET /symbols?query=<name>
GET /symbols?file=<rel/path.cs>
GET /symbols?all=true
  Symbol lookup from Roslyn + ctags index.
  Response: { count, symbols: [{ Kind, Name, Location, Line, Column, signature }] }

GET /snippet?file=<rel/path.cs>&line=<n>
  Code lines around a given line number (±5 context lines by default).
  Response: { file, startLine, endLine, lines: [{ number, text, isHighlight }] }

GET /signature?query=<name>
GET /signature?file=<rel/path.cs>&line=<n>
  Declaration line(s) only — no code body.
  ~60–120 chars per symbol. Use instead of /snippet when you only need to know
  what a symbol looks like.
  Response: { count, signatures: [{ name, kind, signature, file, line, declarationText }] }

GET /outline?file=<rel/path.cs>
GET /outline?file=<rel/path.cs>&kind=method,property
GET /outline?file=<rel/path.cs>&flat=true
  Full structural outline of a file: every symbol with kind and line, grouped by
  class. No code bodies. ~200–400 chars for a typical 500-line file.
  Response (structured): { file, symbolCount, classes: [{ name, line, kind, methods, properties, fields }], topLevel }
  Response (flat=true):  { file, symbolCount, symbols: [{ name, kind, line, signature, scope }] }

GET /callers?name=<methodName>
GET /callers?name=<methodName>&file=<rel/path.cs>&limit=<n>
  All call-sites of a symbol across the codebase, annotated with their enclosing
  method. Replaces /search + multiple /snippet calls (~10–15x token saving).
  Response: { name, definedAt, count, callers: [{ file, line, callText, enclosingSymbol }] }

GET /diff-context
GET /diff-context?base=<branch-or-commit>
GET /diff-context?staged=true
  Unstaged changes vs HEAD (default), or vs a branch/commit, or staged-only.
  Returns only changed C# lines grouped by file and hunk, each annotated with its
  enclosing symbol. Often 20–50x smaller than sending changed files in full.
  Response: { base, staged, changedFiles: [{ file, status, hunks: [{ startLine, endLine, enclosingSymbol, lines }] }], summary }

GET /ast-node?file=<rel/path.cs>&extract=methods|classes
GET /ast-node?file=<rel/path.cs>&type=<nodeType>
  Tree-sitter AST nodes for a single file. Returns full method/class bodies with
  exact line ranges — the only endpoint that gives you a clean method body without
  surrounding blank lines or comments.
  Response: { file, type, count, data: [{ type, text, startLine, endLine, startPosition, endPosition }] }

POST /compose-context
  Body: { "query": "...", "maxTokens": 2000, "mode": "compact|signatures|full" }
  Orchestrates ripgrep + symbol lookup + snippets into one LLM-ready bundle.
  Modes:
    compact    (default)  symbol info + ±5 line snippet    ~400–800 tokens
    signatures            declaration text only, no snippet ~50–150 tokens
    full                  symbol info + ±15 line snippet   ~800–2000 tokens
  Response: { query, mode, maxTokens, estimatedTokens, parts, summary }

POST /refresh
  Body: { "force": true }  (optional)
  Re-runs Roslyn extractor and regenerates ctags. Without force, only runs if
  source changes are detected.

────────────────────────────────────────────────────────────────────────────────

TOKEN REDUCTION GUIDE

Largest → Smallest
  Whole file      /snippet (30ln)  /ast-node   /outline   /signature
  ~15 000 ch         ~600 ch        ~400 ch     ~200 ch      ~80 ch

Decision guide:
  "Where is X defined?"                  /symbols?query=X
  "What does X look like?"               /signature?query=X   ← cheapest
  "What is in file Y?"                   /outline?file=Y      ← no bodies
  "Full body of method X?"               /ast-node + extract=methods
  "Who calls X?"                         /callers?name=X
  "What changed?"                        /diff-context
  "LLM context bundle"                   POST /compose-context
  "Search for a pattern"                 /search?q=pattern

Recommended workflow:
  1. Start with /signature or /outline — usually enough to orient
  2. Full method body needed? /ast-node for that method only
  3. Usage analysis? /callers
  4. Reviewing a change? /diff-context first
  5. Multi-symbol LLM prompt? /compose-context mode=signatures

────────────────────────────────────────────────────────────────────────────────

INSTALLATION & SETUP

1. Prerequisites
   - Node.js >= 16
   - Tools verified: pwsh ai_tools_setup/verify_and_link_tools.ps1
   - Symbols extracted: pwsh ai_tools_setup/run_symbol_extractor.ps1
   - Ctags generated: ctags -R --languages=C# --output-format=json -f ai_tools_setup/artifacts/tags .

2. Install dependencies
   cd ai_tools_setup/sidecar-api
   npm install

3. Configure
   copy .env.example .env
   # Set REPO_ROOT to the absolute repo path
   # PORT default 3001, LOG_LEVEL default info

4. Start
   npm start           # production
   npm run dev         # with nodemon auto-reload

5. Verify
   Invoke-RestMethod http://localhost:3001/health

────────────────────────────────────────────────────────────────────────────────

AUTO-REFRESH

Every incoming request (except /health and /refresh) runs a lightweight check:
  1. git diff --name-only HEAD -- "*.cs"  — detects uncommitted changes
  2. SHA-256 hash of symbols.json        — detects external updates
  30-second debounce prevents rapid re-runs.

Force immediate re-run:
  Invoke-RestMethod -Method Post http://localhost:3001/refresh `
    -ContentType "application/json" -Body '{"force":true}'

────────────────────────────────────────────────────────────────────────────────

SCHEDULING

Scheduled Windows task (every 6 hours):
  pwsh ai_tools_setup/register_refresh_task.ps1 -Action register -Hours 6
  pwsh ai_tools_setup/register_refresh_task.ps1 -Action unregister

GitHub Actions (optional):
  Add a step to run pwsh ai_tools_setup/run_symbol_extractor.ps1 on push and
  upload symbols.json as a build artifact for team-wide use.

────────────────────────────────────────────────────────────────────────────────

LOGGING

Logs written to ai_tools_setup/sidecar-api/logs/
  combined.log  — all levels
  error.log     — errors only

Adjust verbosity:
  $env:LOG_LEVEL="debug"; npm start

────────────────────────────────────────────────────────────────────────────────

TROUBLESHOOTING

API won't start
  - node --version  (need 16+)
  - Check REPO_ROOT in .env
  - Get-Content logs/error.log

/health shows resources not found
  - pwsh ai_tools_setup/run_symbol_extractor.ps1
  - ctags -R --languages=C# --output-format=json -f ai_tools_setup/artifacts/tags .

rg / ctags not found
  - pwsh ai_tools_setup/verify_and_link_tools.ps1

Port in use
  - Set PORT=3002 in .env

Symbols stale
  - POST /refresh {"force":true}  or trigger auto-refresh by editing a .cs file

Tree-sitter errors
  - npm list tree-sitter-c-sharp
  - File must be UTF-8

────────────────────────────────────────────────────────────────────────────────

FUTURE ENHANCEMENTS

- VS Code extension: query /compose-context on Copilot invocation
- IntelliJ plugin: right-click symbol → "Fetch AI Context"
- SQLite backend for persistent cache across restarts
- Additional language grammars via tree-sitter (Go, Python, Java)
- Zoekt integration for full-repo indexed search at scale
