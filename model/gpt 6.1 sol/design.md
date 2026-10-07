# System design

## 1. Architectural principles

1. Policy and authorization are executable code, not model instructions.
2. Docs, repository evidence, generated suggestions, and test receipts have distinct provenance.
3. Every stage is bounded, cancellable, observable, and explicit about failure.
4. One orchestrator owns task state, permissions, deadlines, and final reporting.
5. Model weights, prompts, indexes, tools, and evaluators are independently versioned.

## 2. Logical architecture

```text
IDE / web / CLI
      |
Identity + tenant + request schema + permission policy
      |
Orchestrator: task state, budget, cancellation, approved capabilities
      |
      +-- Documentation retrieval --> lexical + vector --> optional reranker
      |                            --> authorized evidence bundle
      +-- Repository tools --------> compiler/LSP, search, bounded reads
      +-- Model gateway -----------> chosen local or approved hosted generator
      +-- Validation worker -------> isolated build/test/static analysis
      +-- Patch service -----------> diff preview + baseline-hash check + approval
      |
Final result: claims + sources + assumptions + validation receipts + status

Separate ingestion plane:
Approved source registry --> fetch/parse --> rights/ACL/version checks
                        --> section/code chunking --> index snapshot + manifest

Cross-cutting: secret filtering, telemetry, audit records, quotas, deletion
```

Retrieval stores knowledge; the generator synthesizes it; deterministic tools establish repository and execution facts. MCP is an interoperability layer for selected tools, not a substitute for these responsibilities.

## 3. Proposed contracts

Use versioned JSON schemas with runtime validation on both input and output. Example fields below are interface specifications, not implemented APIs.

**AgentRequest**

- `schemaVersion`, `requestId`, `tenantId`, authenticated principal.
- `objective`, `mode`, `language`, `framework`, `targetVersion`.
- Optional approved `workspaceId` and baseline commit/content digest.
- Approved source collections and capability IDs.
- Budget: deadline, maximum model input/output tokens, calls, tool calls, fan-out, cost.
- Cancellation token; user-visible output preference.

**Evidence**

- `evidenceId`, kind: documentation / repository / diagnostic / execution.
- Source URI or workspace-relative path; heading/symbol/line range where available.
- Document version, snapshot digest or repository commit/content digest.
- Exact bounded passage or result, access scope, fetched/observed timestamp.
- Relationship status: verified / inferred / unresolved.
- Retrieval relevance score is **not** truth probability.

**ToolResult**

- `toolId`, `contractVersion`, `requestId`, execution receipt ID.
- Status: completed / partial / denied / failed / cancelled.
- Structured payload and evidence references; truncation/budget reason.
- Duration, exit code if applicable, sanitized error code and correlation ID.
- Scope and exact workspace baseline; no executable strings treated as authority.

**AgentResult**

- Status: completed / needs_clarification / abstained / incomplete / failed / cancelled.
- Answer, optional example or patch, claims linked to evidence IDs.
- Assumptions and unresolved questions.
- Validation state: illustrative / repository_inspected / sandbox_validated / not_run.
- Tests/diagnostics receipts, remaining risk, budget summary.
- Permission requirements and next step; never automatic permission expansion.

## 4. Task state machine

```text
received -> authorized -> scoped -> retrieving -> generating -> checking
                                                             |
docs/read-only ------------------------------------------> completed
patch ---------------------------------------------------> awaiting_approval
awaiting_approval -> approved -> sandbox_validation -> preview_ready
preview_ready -> apply_approval -> baseline_check -> applied -> completed
```

Any stage may move to needs_clarification, abstained, denied/failed, incomplete, or cancelled. Denial is recorded as a policy outcome. Partial work is not relabelled complete. Final application approval refers to the exact validated patch hash and baseline hash.

Sandbox validation may run before live-application approval, but only with a separately authorized execution capability. Reject patches that escape the workspace or alter disallowed files.

## 5. Context construction

- Start with a small task summary, allowed tool schemas, selected version, and evidence.
- Retrieve exact APIs lexically and explanatory concepts semantically; rerank a bounded candidate set.
- Keep code examples with signatures and prerequisite/version sections.
- Preserve evidence IDs during compression; do not summarize away errors or qualifiers.
- Include current diagnostics for patch tasks, not an entire repository dump.
- Use a proposed 8K-16K initial context budget where supported; extend only when evaluation shows benefit. Larger model support does not remove cost or attention trade-offs.
- Treat returned content as data. No evidence passage can change system policy.

## 6. Models and routing

Provide generator, embedding, and optional reranking interfaces separately. Evaluate at least two generator candidates on identical tasks and constraints.

Routing can use deterministic intent rules, sensitivity classification, difficulty signals, and calibrated historical success. Do not infer consent from a confidence score. An unavailable provider produces an explicit error or an already approved alternate route; never silently change privacy boundaries.

Use retrieval caching by tenant, ACL revision, collection/version, index snapshot, and query. Generated-answer caches also include model/prompt/tool versions. Private content is never placed in a global cache.

## 7. Deployment options

| Profile | Components | Trade-off |
|---|---|---|
| Local development | Client, orchestrator, local index, optional local generator | Simple privacy story; limited concurrency |
| Hosted-doc pilot | Service/index plus approved model endpoint | No generator GPU needed; provider dependency |
| Private self-hosted | Separate API, retrieval, GPU serving, sandbox pools | Full data control; operating cost |
| Hybrid | Local sensitive processing; approved public requests routed outward | Strong routing/consent tests needed |

Prefer Linux for production GPU serving and disposable test containers after validating runtime support. Windows clients can use a remote service or compatible local runtime; WSL2 compatibility must be tested rather than assumed. Do not install drivers or containers on shared machines as part of planning.

## 8. Reliability and scaling

- Persist task metadata/checkpoints, not hidden reasoning traces.
- Keep long-running validations asynchronous with progress and resumable status.
- Queue by tenant and task class; reserve interactive capacity.
- Retry transient reads within the original deadline; use bounded backoff.
- Do not blindly retry writes. Use idempotency keys, expected hashes, and receipts.
- Index updates are atomic snapshot switches with a tested rollback.
- Degraded retrieval answers disclose incomplete evidence; mandatory-source failures block authoritative claims.
- Separate offline ingestion/training from interactive inference to avoid contention.
- Scale retrieval CPU and validation workers independently; GPU/model scaling is a different bottleneck.

## 9. Failure handling

| Failure | Required behavior |
|---|---|
| No source/version match | Clarify or abstain with missing inputs |
| Source conflict | Present version-specific conflict, not blended API |
| Provider timeout | Fail or use already authorized alternative within budget |
| Invalid tool output | Reject result and expose contract error |
| Test failure | Report failed validation; bounded repair attempt only if permitted |
| Concurrent repository edit | Stop application; regenerate/reapprove exact patch |
| Cancellation or quota | Stop descendants; incomplete/cancelled output and receipts |
| Secret detected | Redact/block affected transfer; security event without secret payload |

See [requirements.md](requirements.md) for acceptance gates, [tool-delegation.md](tool-delegation.md) for execution boundaries, and [monitoring.md](monitoring.md) for observability.
