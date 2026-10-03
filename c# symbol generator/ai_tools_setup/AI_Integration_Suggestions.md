Goal
Integrate repository symbol extraction and code-graph tooling into developer AI assistants (GitHub Copilot, Kiro, Android Studio CodeGen or other LLM-enabled tools) so the workspace becomes "AI-ready".

1) Scheduled symbol refresh
- Use `ai_tools_setup/register_refresh_task.ps1` to create a scheduled task that runs `ai_tools_setup/run_symbol_extractor.ps1` every X hours.
- This keeps `ai_tools_setup/symbols/symbols.json` up to date for fast LLM context and offline indexing.

2) Local indexes and compact artifacts to reduce tokens
- Generate and store these artifacts:
 - `symbols.json` (Roslyn extractor) — compact semantic symbols for C# (types, methods, signatures, file locations)
 - `ctags` tags file — quick symbol lookup
 - Zoekt index (optional heavy) — full-text and symbol range indexing
 - Tree-sitter parsed nodes (small AST snippets for functions/classes)
- Keep artifacts under `ai_tools_setup/artifacts/` and add to .gitignore if large.

3) Tooling integration strategy
- Pre-filter pipeline for LLM prompts:
1. Use `rg` to search files for query keywords.
2. Use `ctags` to get symbol candidates in matching files.
3. Use Roslyn extractor to fetch semantic info and minimal code slices for those symbols.
4. Send only the compact symbol + code slice to LLM to reduce tokens.

4) Integrating with GitHub Copilot (or Copilot for Business)
- Create a VS Code extension or local sidecar service that exposes a REST API serving:
 - symbol search endpoint (query => symbol ids)
 - code slice endpoint (symbol id => minimal code + metadata)
- Configure Copilot custom data (if enterprise feature available) or use the sidecar to pre-compose prompts.
- For local Copilot usage, implement a small VS Code extension that queries local `symbols.json` and shows results as inline context snippets before sending to Copilot.

5) Integrating with Kiro (or other assistants)
- If Kiro exposes a plugin system or local sidecar, connect to the same REST API used by Copilot extension.
- Provide a small CLI that Kiro can call to get symbol/context JSON; Kiro can embed those into prompts.

6) Android Studio / IntelliJ CodeGen integration
- Use an IntelliJ plugin that queries the local symbol service and inserts minimal context when invoking LLM features.
- Provide a Gradle task or external tool configuration that runs the symbol extractor and updates artifacts.

7) Security and privacy
- Keep symbol artifacts local and avoid uploading full source to external LLMs. Upload only minimal slices or anonymized data.
- If using remote LLMs, implement consent and telemetry controls.

8) Continuous Integration
- Add a GitHub Action that runs `run_symbol_extractor.ps1` on main merges and uploads `symbols.json` as build artifact.
- Optionally, run CodeQL analysis nightly and push findings to a dashboard.

9) Developer workflows
- Local: run `pwsh .\ai_tools_setup\run_symbol_extractor.ps1` and use the local sidecar/VSCode plugin to assist with context.
- CI: add step to produce `symbols.json` and artifacts for team-wide consumption.

10) Storage and query API (simple)
- Implement a small Node or .NET tiny API that serves `symbols.json` queries (by name, file, or fuzzy match) and returns minimal code slices.
- Cache results and support filtering by project in large mono-repos.

Conclusion
- The key is generating compact semantic artifacts (Roslyn symbols, ctags) and exposing a fast query API used by the assistant/plugin. This reduces token usage and improves result relevance.
- I can implement the sidecar API and a simple VSCode extension or provide scripts to integrate with Copilot/Kiro/Android Studio. Tell me which integration you prefer to proceed with (VSCode extension, sidecar API, GitHub Action, or IntelliJ plugin).
