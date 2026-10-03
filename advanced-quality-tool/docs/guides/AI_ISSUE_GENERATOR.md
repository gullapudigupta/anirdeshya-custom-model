# AI Issue Generator (Phase 6)

Self-explanatory, intelligent auto-fix system. It classifies an issue, gathers the
minimal code + research context, prompts an AI model for a **line-level** edit,
applies it safely with backup/rollback, then verifies and recovers on failure.

Every collaborator is dependency-injected. Without a transport (`fetchImpl`) the
system runs **network-free**: search adapters return offline hints and executors
report "no transport configured" instead of making network calls.

## Pipeline

```
issue
  → IssueClassifier          (what / why / how, score)          [T001]
  → CodeContextAnalyzer      (minimal symbol-aware snippet)     [T002]
  → search adapters          (docs / GitHub / StackOverflow)    [T003–T005]
  → DependencyDocResolver    (official docs for real deps)      [T016]
  → ContextAggregator        (dedupe / rank / budget)           [T006]
  → PromptBuilder            (line-edit prompt + contract)      [T007]
  → LocalExecutor / CloudExecutor  (Ollama, then cloud)         [T008–T009]
  → LineEditor               (apply line edits + backup)        [T010]
  → ErrorRecovery            (detect build/lint errors, retry)  [T011]
```

The `AIGenerationOrchestrator` (T012) wires these together; `config.js` (T014)
supplies strategy, rate limits, and the daily cost budget.

## CLI

```bash
aqt generate-fixes [files...] [options]
```

| Option | Description |
| --- | --- |
| `--dry-run` | Plan/execute without writing files |
| `--strategy <s>` | `local-first` (default), `local-only`, `cloud-only` |
| `--local-ai-model <m>` | Ollama model (default `codellama:7b`) |
| `--cloud-ai` | Enable cloud fallback |
| `--cloud-provider <p>` | `openai` or `anthropic` |
| `--api-key <key>` | Cloud key (or `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`) |
| `--max-fixes <n>` | Cap issues processed |
| `--no-search` | Disable doc/GitHub/StackOverflow search |
| `--verbose, -v` | Per-issue progress |

Local AI requires Ollama running (`ollama serve`).

## Configuration

Create `.aqt/ai-generator.json` in the project root. See
[`examples/ai-generator-config.json`](../examples/ai-generator-config.json).

```jsonc
{
  "execution": { "strategy": "local-first", "localModel": "codellama:7b", "maxAttempts": 3 },
  "search": { "enabled": true, "sources": ["docs", "github", "stackoverflow"] },
  "limits": { "maxFixesPerRun": 50, "requestsPerMinute": 20, "dailyBudgetUsd": 5.0 }
}
```

### Dependency-aware official docs (T016)

`DependencyDocResolver` reads `package.json` (deps/devDeps/peerDeps) and maps each
dependency to its official documentation via a configurable pattern list
(`search.docPatterns`). Retrieved docs become reference fragments in the aggregated
context, so fixes are grounded in the libraries the project actually uses.

## Cost & rate limiting

- `RateLimiter` — sliding-window requests-per-minute cap.
- `CostTracker` — accumulates spend, enforces `dailyBudgetUsd`, and writes daily
  reports to `.aqt-reports/ai-generator/cost-YYYY-MM-DD.json` (AQ-SF-004).

## Testing

```bash
node tests/ai-generator/generator.test.js   # network-free
node src/ai-generator/smoke-test.js          # foundations smoke test
```

See [`docs/api/AI_GENERATOR_API.md`](./api/AI_GENERATOR_API.md) for the API reference.
