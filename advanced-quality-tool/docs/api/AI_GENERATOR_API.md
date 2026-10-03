# AI Issue Generator — API Reference

All classes are exported from `src/ai-generator/index.js`:

```js
const {
  IssueClassifier, CodeContextAnalyzer, ContextAggregator, PromptBuilder, LineEditor,
  SearchCache, BaseSearcher, DocSearcher, GitHubSearcher, StackOverflowSearcher,
  DependencyDocResolver, LocalExecutor, CloudExecutor, ErrorRecovery,
  AIGenerationOrchestrator, loadConfig, RateLimiter, CostTracker, prepareFix
} = require('./src/ai-generator');
```

## Common conventions

- Options are passed to constructors and merged over `DEFAULT_OPTIONS`.
- `fetchImpl(url, { method, headers, body, timeoutMs })` is the injectable
  transport, returning `{ ok, status, json(), text() }`. Omit it for network-free mode.
- A **fragment** is `{ source, title, text, url?, score? }`.
- An **edit plan** is `{ edits: [{ startLine, endLine, replacement }], explanation }`.

## Search adapters (T003–T005, T016)

### `DocSearcher(options)`
- `search(issue|classification)` → `{ source, query, fragments, fromCache, error? }`.
- `detectSource(input)` → one of `eslint|typescript|angular|react` or `null`.
- Offline: returns a single reference fragment for the detected source.

### `GitHubSearcher(options)`
- `options.repos: string[]`, `options.token`. Uses GitHub search API.
- Query optimizer strips file paths and `:line:col`; solution extractor prefers code fences.

### `StackOverflowSearcher(options)`
- `options.site` (default `stackoverflow`), `options.acceptedOnly`.
- Decodes HTML entities and extracts `<pre><code>` snippets.

### `SearchCache(options)`
- `get(source, query)` / `set(source, query, value)` / `clear()`; TTL via `options.ttlMs`.

### `DependencyDocResolver(options)`
- `detectDependencies()` → dependency names from `package.json` + `extraReferences`.
- `resolveDocSources(deps?)` → `[{ name, dependency, docsUrl, topics }]`.
- `buildDocContext(issue?)` → `{ fragments, sources }` (fragments carry `dependency` + `reference`).
- `options.patterns` overrides the dependency→docs map.

## Executors (T008–T009)

### `LocalExecutor(options)` — Ollama
- `options.host`, `options.model`, `options.endpoint` (`/api/chat` or `/api/generate`).
- `execute(prompt)` → `{ ok, text, attempts, error?, provider, model }`. Retries transient failures.
- `available` — true when a transport is configured.

### `CloudExecutor(options)`
- `options.provider` (`openai|anthropic`), `options.model`, `options.apiKey`, `options.pricing`.
- `execute(prompt)` → `{ ok, text, usage, cost, attempts, provider, model, error? }`.
- `getCostReport()` → `{ provider, model, totalCost, totalTokens }`.
- `available` — true when transport **and** `apiKey` are set.

## Error recovery (T011)

### `ErrorRecovery(options)`
- `options.buildValidator` / `options.lintValidator`: `async (files) => { ok, errors }`.
- `detect(files)` → `{ ok, errors, kinds }`.
- `buildEnhancedContext(error)` → context with `searchQuery`, `enclosingSymbol`, `relatedSymbols`.
- `retry({ attempt })` → `{ success, attempts, history, lastErrors }` (max `options.maxAttempts`).

## Orchestrator (T012)

### `AIGenerationOrchestrator(options)`
Injectable: `searchers`, `dependencyResolver`, `localExecutor`, `cloudExecutor`,
`errorRecovery`, `rateLimiter`, `costTracker`, `queryEngine`, `strategy`, `dryRun`, `onProgress`.
- `run(issues)` → `{ results, metrics }` where `metrics = { processed, fixed, failed, skipped, recovered, totalCostUsd }`.
- `processIssue(issue)` → per-issue result `{ issueId, file, stage, success, error, ... }`.

## Config & cost (T014)

### `loadConfig(options)` → merged config (`DEFAULT_CONFIG` ← file ← `options.overrides`).
### `RateLimiter({ requestsPerMinute })` → `check()` → `{ allowed, retryAfterMs }`.
### `CostTracker({ dailyBudgetUsd, reportsDir, rootDir })`
- `record(cost, meta)`, `canSpend(cost)`, `getReport()`, `withinBudget`, `remaining`.
