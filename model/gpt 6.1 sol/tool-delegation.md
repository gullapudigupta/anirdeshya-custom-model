# Splitting load across MCP, tools, workers, and agents

## 1. Four different forms of distribution

1. **Deterministic tool offload:** search, compiler queries, tests, formatting and diff checks happen outside the model. This often saves tokens and improves factual reliability.
2. **Service/worker scaling:** replicate retrieval, ingestion, and sandbox workers. This improves throughput without adding reasoning agents.
3. **Model distribution:** tensor/pipeline parallelism or replicated inference servers handle model memory/throughput. MCP does not shard model weights.
4. **Multi-agent delegation:** additional model-driven workers reason about bounded tasks. This may improve independent work, but adds calls, latency, orchestration and safety risk.

MCP standardizes communication with external tools/resources. It does **not** automatically make a generator cheaper, distribute its neural computation, enforce a sandbox, or ensure tool correctness.

## 2. Offload matrix

| Work | Prefer | Reason |
|---|---|---|
| Intent/scope/schema validation | Deterministic rules + schema, optional small classifier | Cheap, repeatable, fail closed |
| Exact identifiers and file search | Lexical search, compiler/LSP | Better source-of-truth precision |
| Conceptual documentation search | Hybrid retrieval + optional reranker | Efficient evidence selection |
| Dependency/version inventory | Manifest/lockfile parser | No guessing |
| Call/reference relationships | Compiler/LSP, explicit graph adapter | Verifiable relationships |
| Builds/tests/static checks | Isolated workers | Execution establishes facts |
| Formatting/import organization | Language ecosystem tools | Deterministic transformations |
| Patch baseline/path validation | Diff/policy service | Prevent stale/escaping writes |
| Original synthesis and planning | Generator | Flexible reasoning is actually needed |
| Independent narrow review | Optional specialist agent + external checks | Only after measured benefit |
| Telemetry aggregation | Metrics/log pipeline | No model required |

Never offload permission decisions to a model or untrusted MCP server.

## 3. Suggested service/MCP boundaries

| Server/service | Allowed capabilities | Default trust boundary |
|---|---|---|
| Documentation | Search/read approved collections, version metadata | No repository access or arbitrary URL fetch |
| Repository analysis | Bounded reads, symbols, references, diagnostics | Read-only approved root |
| Validation | Run approved build/test recipes in disposable workspace | No production credentials; controlled egress |
| Patch preview/apply | Generate/check diff; approved apply with hashes | Live application requires explicit separate capability |
| Issue tracker | Read issue context; optional approved status update | Scoped project and authenticated account |
| Package metadata | Approved registry metadata/license/version queries | No arbitrary package install |
| Artifact store | Bounded receipt/log/diff retrieval | Tenant-scoped access and retention |

These boundaries may be native in-process tools initially. Add MCP for interoperability, remote ownership or third-party integration, not for every helper function.

## 4. Tool contracts and execution policy

- Version input/output schemas; reject unknown critical fields and malformed outputs.
- Restrict workspace paths including symlinks/junctions and output directories.
- Bind each invocation to tenant, task, principal, capability, deadline and cancellation token.
- Use read-only classification from trusted registry/policy, not merely tool-description annotations.
- Local stdio tools and remote HTTP services require different process/authentication arrangements; implement the selected transport deliberately.
- Remote tools require authenticated connections, destination validation, least privilege, and scoped tokens. Do not pass upstream tokens to unintended recipients.
- Shell-like capabilities accept an approved command recipe and validated arguments, not arbitrary generated command strings.
- Isolate tests/install hooks, network, filesystem, CPU/RAM/process limits and credentials.
- Retries for reads are bounded; mutations require idempotency and receipt checks.
- Results must disclose truncation, exit code, unresolved relations and partial status.
- Server-initiated sampling or elicitation is separately controlled; no hidden recursive model calls or permission escalation.

## 5. Multi-agent patterns

| Pattern | Example | When useful | Failure mode |
|---|---|---|---|
| Single agent + tools | One controller uses docs/LSP/tests | Default MVP | Controller reasoning limit |
| Router + specialists | Docs explainer vs repository fixer | Clearly distinct task classes | Wrong route/duplicated context |
| Planner + executor | Bounded plan becomes typed tasks | Longer controlled workflows | Overplanning/stale plan |
| Parallel independent workers | Separate modules or independent test fixtures | No shared mutable state; explicit merge contract | Conflicting edits, redundant work |
| Author + reviewer | Review a proposed patch | Independent checks add measured value | Shared-model correlated errors |
| Hierarchical agents | Coordinators distribute many tasks | Proven large workload demand | Exploding cost and hard cancellation |

Use asynchronous workers for compute-heavy deterministic tasks before adding more model agents.

## 6. Initial orchestration limits

Proposed experiment defaults:

- One owning orchestrator.
- At most two delegated model workers, and only for independent tasks.
- No delegated worker may spawn additional agents.
- Per-task cap: 20 tool calls and three generation/repair calls initially; tune against benchmarks.
- Docs tasks: proposed 30-second hard deadline; small issue tasks: proposed 180-second hard deadline, with longer jobs explicitly queued.
- Inherit tenant, source access, mode, remaining budget, and cancellation.
- Assign disjoint writable artifacts/branches; workers do not edit the same live files.
- Require typed results with evidence/receipts, not free-form claims of success.
- Controller verifies merge, baseline, tests and user approval.

Maximum fan-out is a budget/policy decision, not something the model can increase.

## 7. Parallelization and consistency

Parallelize independent lexical/vector queries, read-only evidence gathering, separate validations and disjoint task branches. Sequence dependency chains, shared-file edits and approval transitions.

Maintain a dependency DAG. A dependent worker starts only when prerequisite outputs are validated. Task receipts identify the source snapshot and patch baseline. Cancel all descendants if the parent cancels. Bound queue depth and use per-tenant fair scheduling.

## 8. How to determine whether offloading works

Compare:

1. Model-only answer.
2. One agent with deterministic tools.
3. One agent with scaled worker services.
4. The same system with specialists.

Hold task set, generator family, maximum spend, deadline and tool permissions constant. Measure verified task success, total model tokens/calls, tool time, critical-path latency, duplicate work, conflict rate and cost per success.

Adopt multiple agents only if they produce a meaningful held-out gain without safety regression or unacceptable cost. Two agents agreeing is not independent verification.

Protocol references: [sources.md](sources.md). Architecture: [design.md](design.md).
