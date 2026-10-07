# Native Classifiers

A deterministic Node.js/TypeScript implementation of the packet described in [../LLM human language classification agent input format.md](../LLM%20human%20language%20classification%20agent%20input%20format.md).

This project does not use JevAI, an LLM, or an external classification service. The read-only codebase-analysis subsystem provides:

- weighted intent rules
- domain, entity, and constraint extraction
- confidence scoring
- strict Zod schema validation
- an allowlisted tool router
- a clarification/failure fallback handler
- bounded repository inventory and ignore policy
- lexical and TypeScript symbol search
- provenance-bearing call/data-flow evidence graphs
- Angular and Node.js relationship resolvers
- deterministic completion, grounded reports, and secret redaction

## Run

Requires Node.js 20 or newer.

```powershell
npm install
npm run typecheck
npm test
npm run evaluation
```

Supported analysis modes are `architecture`, `feature_flow`, `symbol_usage`, `data_flow`, `dependency`, and `error_path`. Analysis defaults to `read_only`, rejects paths outside the workspace, excludes dependency/build/coverage/version-control output, and enforces file, line, query, graph, iteration, and duration limits.

The public API is exported from [src/index.ts](src/index.ts). Use `AnalysisOrchestrator` for end-to-end analysis, `createAnalysisHandlers` for validated read-only tools, and `buildAnalysisReport` for evidence-grounded output. Dynamic dispatch and unavailable external adapters remain explicitly unresolved.

Extend `intentRules`, `domains`, `entityTerms`, and `constraintRules` in [src/classifier.ts](src/classifier.ts) to support product-specific language. Replace the example registry in [src/index.ts](src/index.ts) with real application or MCP tool handlers.

For the steps needed to move from the current rule baseline toward broad English coverage, see the [broad-English classification roadmap](../agent_tasks_ts_rag/knowledge%20store/Broad%20English%20Classification%20Roadmap.md).
