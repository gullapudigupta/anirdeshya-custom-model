# System Design

Status: Draft v1 · Owner: TBD · Last updated: 2026-10-07

Companion to [requirements.md](./requirements.md). This describes the
end‑to‑end architecture of the coding agent.

## 1. Architecture overview

```
┌──────────────────────────────────────────────────────────────────┐
│                        Clients / IDEs                             │
│   VS Code ext · JetBrains · CLI · Web chat · CI bot               │
└───────────────┬──────────────────────────────────────────────────┘
                │  (completion / chat / task API)
┌───────────────▼──────────────────────────────────────────────────┐
│                       Agent Orchestrator                          │
│  • Request router (complete | chat | agentic task)                │
│  • Planner / controller loop (ReAct / plan-execute)               │
│  • Context assembler (prompt + repo + retrieved docs)             │
│  • Tool & MCP dispatcher   • Guardrails   • Memory/session        │
└───┬───────────────┬────────────────┬───────────────┬─────────────┘
    │               │                │               │
┌───▼────┐   ┌──────▼──────┐   ┌─────▼──────┐   ┌────▼───────────┐
│ Model  │   │  Retrieval  │   │   Tools /  │   │  Sub-agents    │
│ serving│   │  (RAG)      │   │   MCP      │   │ (specialized)  │
│ vLLM/  │   │ vector + BM25│  │ test,lint, │   │ planner, test, │
│ TGI/   │   │ reranker    │   │ search,fs, │   │ reviewer, docs │
│ SGLang │   │ doc index   │   │ git, exec  │   │                │
└────────┘   └─────────────┘   └────────────┘   └────────────────┘
    │               │                │               │
┌───▼───────────────▼────────────────▼───────────────▼─────────────┐
│          Data & Platform: object store · vector DB ·              │
│          metadata DB · feature store · eval harness ·             │
│          observability (traces/metrics/logs) · CI/CD              │
└───────────────────────────────────────────────────────────────────┘
```

## 2. Core components

### 2.1 Agent orchestrator
- **Controller loop:** plan → act (tool call) → observe → reflect → repeat
  until done or budget exhausted. Supports ReAct and plan‑and‑execute modes.
- **Context assembler:** merges system prompt, conversation, repo snippets,
  and retrieved documentation into a token budget using priority packing.
- **Budgeter:** caps steps, tokens, wall‑clock, and tool calls per task.
- **Memory:** short‑term (session), task scratchpad, and optional long‑term
  (project memory) stored in the metadata DB.

### 2.2 Model serving
- Open‑weight code LLM behind an OpenAI‑compatible API.
- Serving stack options: **vLLM**, **TGI**, **SGLang**, or **llama.cpp**
  (edge). Paged KV cache, continuous batching, speculative decoding.
- Multiple model sizes: small (completion/low‑latency), large (reasoning/agent).
- Routing: cheap model first, escalate to large model on hard tasks.

### 2.3 Retrieval (RAG)
- Hybrid retrieval: dense (embeddings) + sparse (BM25) + **reranker**.
- Separate indexes for: external docs, internal docs, the user's repo,
  API references, and past solved tasks.
- Chunking tuned per source (code‑aware splitting vs. prose splitting).
- Citations returned with every retrieved span. Details in
  [rag-only-strategy.md](./rag-only-strategy.md) and
  [documentation-driven-suggestions.md](./documentation-driven-suggestions.md).

### 2.4 Tools & MCP
- Deterministic capabilities exposed as tools / MCP servers: file read/write,
  code search, test runner, linter/formatter, build, git, package manager,
  shell exec (sandboxed), web/doc fetch.
- Why: offload work the model shouldn't "reason" about — see
  [load-distribution.md](./load-distribution.md).

### 2.5 Sub‑agents
- Specialized agents: **planner**, **retriever/docs**, **coder**,
  **test‑runner**, **reviewer/critic**. Orchestrator delegates and
  aggregates. Enables parallelism and smaller focused contexts.

### 2.6 Guardrails
- Input: prompt‑injection detection, PII/secret redaction.
- Output: secret scanning, license filtering, unsafe‑pattern checks,
  citation verification for doc‑grounded answers.

## 3. Request flows

### 3.1 Inline completion (latency‑critical)
1. Client sends cursor context (prefix/suffix, open files).
2. Light context assembly (no heavy RAG); optional local repo snippets.
3. Small model, speculative decoding, streamed tokens.
4. Log accept/reject.

### 3.2 Doc‑grounded chat
1. Query → retrieval (hybrid + rerank) over doc indexes.
2. Context assembler packs top‑k cited chunks.
3. Model answers *constrained to cited context*; refuses if unsupported.
4. Response includes citations; guardrails verify claims→sources.

### 3.3 Agentic task
1. Planner decomposes the task.
2. Controller loop runs tools/sub‑agents (edit, run tests, read docs).
3. Reviewer/critic validates diff + tests.
4. Returns patch + rationale + test results; human approves.

## 4. Model lifecycle
- **Registry:** every model + adapter is versioned with metadata.
- **Promotion:** candidate → shadow → canary → production, gated by eval.
- **Rollback:** instant revert to last known‑good version.
- Training paths: see [training-strategy.md](./training-strategy.md).

## 5. Deployment topologies
| Topology | Use case |
|----------|----------|
| Single GPU box | Dev / small team self‑host |
| Multi‑GPU node | Team, larger model + RAG |
| K8s cluster w/ autoscaling | Managed multi‑tenant |
| Edge (quantized) | Offline / air‑gapped, completion‑only |

Hardware details in [hardware-requirements.md](./hardware-requirements.md).

## 6. Data stores
- **Object store:** raw docs, training corpora, artifacts.
- **Vector DB:** embeddings (e.g., pgvector, Qdrant, Milvus, Weaviate).
- **Metadata/relational DB:** sessions, feedback, model registry.
- **Trace/metric store:** observability
  ([monitoring-strategy.md](./monitoring-strategy.md)).

## 7. Security & privacy
See [security-privacy.md](./security-privacy.md): sandboxed execution,
tenant isolation, opt‑in training, audit logging, secret handling.

## 8. Key design decisions (ADR summary)
1. **Open‑weight base** over closed API (self‑host + tune + privacy).
2. **RAG‑first**, fine‑tune later (fast value, cheaper, updatable).
3. **Tool/MCP offload** over "do everything in the model."
4. **Eval harness before scale** (every change is measured).
5. **Model routing** (small↔large) for cost/latency.
