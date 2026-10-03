Goal
Enable this C#/.NET codebase to be "AI-ready" by installing free, mainly open-source tools that generate code graphs and symbol indexes, enable fast semantic search, and produce compact symbol outputs (reduces token usage when feeding code to LLMs).

Recommended tools (free / open-source / well supported)

1) Universal Ctags
- Purpose: fast, language-agnostic symbol extraction (functions, classes, methods, enums).
- Why: outputs compact tag files (symbols only) that greatly reduce tokens needed for search/context.
- Install (Windows w/ Chocolatey): `choco install universal-ctags -y`
- Update command (script): `choco upgrade universal-ctags -y`

2) ripgrep (`rg`)
- Purpose: very fast text search across repo (useful as pre-filter to limit scope before heavy parsing).
- Install: `choco install ripgrep -y`
- Update: `choco upgrade ripgrep -y`

3) Tree-sitter (CLI)
- Purpose: produce parse trees and syntax-aware queries; can be used to produce structured symbol info and smaller AST-based snippets.
- Why: more precise than regex; can extract only relevant node text (reduces tokens).
- Install (requires Node/npm): `npm install -g tree-sitter-cli`
- Update: `npm update -g tree-sitter-cli`

4) Zoekt (by Sourcegraph) or Sourcegraph server (Docker)
- Purpose: powerful code search and indexing (structural + substring search), supports repository indexing and web UI.
- Options:
 - Zoekt (lightweight search indexer) — good for local indexed fast search.
 - Install (requires Go): `go install github.com/sourcegraph/zoekt@latest`
 - Build index: `zoekt-git-index -repo=./ -name=myrepo && zoekt-webserver` (see docs)
 - Sourcegraph (full server, Docker) — best UX and code graph integrations if you want a running server.
 - Install: `docker run --detach --publish7080:7080 --name=sourcegraph sourcegraph/server:latest`
- Update: `go install ...@latest` or `docker pull sourcegraph/server:latest`

5) CodeQL CLI (GitHub CodeQL)
- Purpose: semantic code analysis and code property graph queries; supports C# and many languages.
- Why: generates semantic DBs and lets you query for patterns; produces structured outputs for LLM prompts.
- Install: download CodeQL CLI bundle from GitHub CodeQL releases and unzip into PATH, or install via GitHub Actions runner tools cache.
- Update: re-download latest release on update script (see PS1 script).

6) OmniSharp / Roslyn-based symbol extraction (C# specific)
- Purpose: generate Roslyn semantic model / symbol JSON for C# projects. Produces highest-fidelity symbol + type info for C# that reduces token needs.
- Options:
 - Use OmniSharp release (binary) or implement a small Roslyn tool that loads the solution and emits symbol graph (recommended long-term).
 - Quick install (OmniSharp): download `omnisharp-roslyn` release and add to PATH.
- Update: re-download latest release regularly.

Other useful tools
- csharpier / dotnet-format: formatting before analysis
- Comby: structural search and rewrite for pattern-based search
- graphviz: visualize small symbol graphs (optional)

Which reduces token usage and provides easy code-graph search?
- Best for token efficiency (ranked):
1. Roslyn-based symbol extractor (semantic symbols + references) — outputs very compact JSON with symbol IDs, signatures, and references. Best for C#.
2. Universal Ctags — compact symbol list. Fast and low token overhead.
3. Tree-sitter extracted AST snippets — produce minimal code nodes (function bodies, signatures) instead of entire files.
4. CodeQL DB exports (selective query outputs) — can export minimal relevant code slices.
5. Zoekt/Sourcegraph — excellent search and narrowing; returns file ranges to feed LLMs.

Combination strategy
- Use `rg` to quickly narrow files by text.
- Use `ctags` to get symbol candidates inside those files.
- Use Tree-sitter / Roslyn to produce minimal AST/symbol JSON for the candidate symbols.
- Index outputs in Zoekt/Sourcegraph or in a small local store for fast retrieval.
- Use CodeQL for deeper semantic queries on-demand.

Auto-update every10 minutes
- Approach: create a small PowerShell script that attempts safe updates for each installed tool, then register a Windows scheduled task (`schtasks`) that runs every10 minutes.
- Considerations: updating that frequently may be excessive; prefer30-60 min in production. For testing,10 minutes is possible.
- Script provided in this repo: `ai_tools_setup/update_tools.ps1` (idempotent, tolerant of missing tools).

Files created in workspace
- `ai_tools_setup/AI_Tools_Analysis.md` (this document)
- `ai_tools_setup/update_tools.ps1` (update script + sample schtasks registration command)

Next steps / how to run
1. Install prerequisites: Git, Chocolatey (Windows), Node/npm, Go, Docker, dotnet SDK (if not present).
2. Run the install commands (examples below) from an elevated PowerShell (Admin):
 - `choco install git -y`
 - `choco install universal-ctags -y`
 - `choco install ripgrep -y`
 - `npm install -g tree-sitter-cli`
 - `choco install golang -y` (then `go install github.com/sourcegraph/zoekt@latest`)
 - `docker run --detach --publish7080:7080 --name=sourcegraph sourcegraph/server:latest`
 - Download CodeQL CLI from GitHub and place `codeql` on PATH (see CodeQL docs)
 - Download OmniSharp-roslyn zip and extract to folder on PATH (or implement Roslyn symbol exporter)

3. To enable the update schedule (run as Administrator):
 - Open elevated PowerShell and run: `schtasks /Create /SC MINUTE /MO10 /TN "AI_Tools_Update" /TR "powershell -ExecutionPolicy Bypass -File \"%cd%\\ai_tools_setup\\update_tools.ps1\"" /F`
 - To delete: `schtasks /Delete /TN "AI_Tools_Update" /F`

Notes and caveats
- Some installs require Admin privileges. Use an admin PowerShell.
- Sourcegraph Docker uses significant resources; use Zoekt for lightweight local search if resources are limited.
- Frequent updates (every10 minutes) can increase network and CPU use; consider changing cadence if undesired.
- For best LLM token efficiency, create and store a cached symbol database (Roslyn JSON + ctags) and query that instead of raw files.

References
- Universal Ctags: https://ctags.io/
- ripgrep: https://github.com/BurntSushi/ripgrep
- tree-sitter: https://tree-sitter.github.io/tree-sitter/
- Zoekt: https://github.com/sourcegraph/zoekt
- Sourcegraph: https://sourcegraph.com/
- CodeQL: https://github.com/github/codeql
- OmniSharp: https://github.com/OmniSharp/omnisharp-roslyn

