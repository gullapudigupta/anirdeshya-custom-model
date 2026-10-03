# ⚠️ Sidecar API Has Been Moved

The sidecar API code has been **relocated** to:

```
tools/code-analyzer/ai_tools_setup/
```

## What Was Moved

- `sidecar-api/src/` → `tools/code-analyzer/ai_tools_setup/src/`
- `sidecar-api/package.json` → `tools/code-analyzer/ai_tools_setup/package.json`
- `RoslynSymbolExtractor/` → `tools/code-analyzer/ai_tools_setup/RoslynSymbolExtractor/`
- `symbols/symbols.json` → `tools/code-analyzer/ai_tools_setup/symbols/symbols.json`
- `artifacts/tags` → `tools/code-analyzer/ai_tools_setup/artifacts/tags`
- Setup scripts → `tools/code-analyzer/ai_tools_setup/`

## New MCP Servers

| Server | Command | Status |
|--------|---------|--------|
| **Combined (default)** | `node tools/code-analyzer/mcp-server-unified.js` | Active |
| **Analyzer only** | `node tools/code-analyzer/mcp-server-analyzer.js` | Available (disabled) |
| **Sidecar only** | `node tools/code-analyzer/ai_tools_setup/mcp-server.js` | Available (disabled) |

## Remaining in ai_tools_setup/

Only the RoslynSymbolExtractor binaries and legacy scripts remain here as references.
The source of truth is now `tools/code-analyzer/ai_tools_setup/`.

## Safe to Delete

This directory (`ai_tools_setup/`) can be safely deleted once you confirm the new
location is working correctly. Run `node tools/code-analyzer/mcp-server-unified.js`
to verify.
