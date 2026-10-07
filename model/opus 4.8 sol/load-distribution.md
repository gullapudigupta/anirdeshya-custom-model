# Load Distribution — Offloading Work from the Model

How to split work **off the core model** onto deterministic tools, MCP
servers, retrieval, and specialized sub‑agents. Goal: the model should
**reason and decide**; everything mechanical, exact, or expensive should run
elsewhere. This cuts cost, latency, and hallucination while improving
reliability.

## 1. Principle: right tool for the job
| Do in the model | Offload off the model |
|-----------------|-----------------------|
| Planning, decisions, synthesis | Exact computation, search, I/O |
| Natural‑language reasoning | Running tests, compiling, linting |
| Choosing which tool to call | File edits, git, package ops |
| Interpreting results | Fetching/looking up facts (RAG) |

Anything deterministic, verifiable, or stateful → a tool. The model
orchestrates; tools execute.

## 2. Offload target #1 — Deterministic tools
Expose capabilities the model should never "simulate":
- **Code search / symbol lookup** (don't make the model grep from memory).
- **Test runner, compiler, type‑checker, linter, formatter.**
- **File system** (read/write/patch), **git**, **package manager**, **build**.
- **Calculator / data queries / API calls.**
- **Sandboxed shell execution.**

Benefits: exactness, verifiability, smaller prompts, fewer hallucinations.

## 3. Offload target #2 — MCP servers
**Model Context Protocol** standardizes tool/resource/prompt exposure so
capabilities are modular, independently scaled, and reusable.
- One MCP server per capability domain (e.g., `git-mcp`, `test-mcp`,
  `docs-mcp`, `fs-mcp`, `db-mcp`, `search-mcp`).
- Scale each server independently; heavy ones (test exec, indexing) get their
  own resources.
- Swap/upgrade capabilities without touching the model.
- Enforce auth, rate limits, and sandboxing per server.

**Load‑splitting via MCP:** run MCP servers as separate services/pods behind
the orchestrator; autoscale the hot ones; isolate untrusted exec in its own
sandboxed server.

## 4. Offload target #3 — Retrieval (RAG)
Knowledge lookup is offloaded to the retrieval subsystem rather than baked
into weights — see [rag-only-strategy.md](./rag-only-strategy.md). The vector
DB, embedding service, and reranker are independently scalable services.

## 5. Offload target #4 — Specialized sub‑agents
Split a big task across focused agents, each with a smaller context and its
own model size:
- **Planner** (large model, low volume) — decompose the task.
- **Retriever/docs agent** — gather grounded context.
- **Coder agent(s)** — implement (can run in parallel on subtasks).
- **Test/▶run agent** — execute + report.
- **Reviewer/critic agent** — validate diffs, catch regressions.

Benefits: parallelism, smaller/cheaper contexts, specialization, independent
scaling. Cost: orchestration complexity — add agents only when a single agent
is the bottleneck.

## 6. Model‑tier routing (split by difficulty)
- **Small/fast model** handles completion + easy chat (most traffic).
- **Large model** handles hard reasoning/agentic tasks (few, expensive).
- A router (heuristics or a tiny classifier) sends each request to the right
  tier. Big cost/latency win.

## 7. Caching layers (offload repeat work)
- **Prompt/prefix cache** (KV reuse) for shared system prompts.
- **Semantic cache** for similar queries → skip the model entirely.
- **Retrieval cache** for hot doc lookups.
- **Tool‑result cache** for deterministic calls.

## 8. Horizontal scaling map
```
                 ┌── small-model pool (autoscaled) ── completion/easy
Orchestrator ──► router
   │             └── large-model pool (autoscaled) ── hard/agentic
   │
   ├─► MCP: git · test · fs · search · db · docs  (each autoscaled)
   ├─► Retrieval: embeddings · vector DB (sharded) · reranker
   └─► Sub-agents: planner · coder×N · tester · reviewer (parallel)
```

## 9. Reliability when distributing
- **Timeouts + retries + circuit breakers** per tool/MCP/sub‑agent.
- **Idempotency** for side‑effecting tools (edits, git).
- **Budgets** (steps/tokens/$/time) at orchestrator to stop runaway fan‑out.
- **Sandbox + least privilege** for exec and file tools
  ([security-privacy.md](./security-privacy.md)).
- **Trace every hop** ([monitoring-strategy.md](./monitoring-strategy.md)).

## 10. Decision guide
1. Deterministic/verifiable? → **tool/MCP**.
2. Knowledge/facts? → **retrieval**.
3. Repeated? → **cache**.
4. Separable sub‑problem or parallelizable? → **sub‑agent**.
5. Easy vs. hard? → **model‑tier routing**.
6. Only what's left (planning, synthesis, decisions) stays in the core model.
