# Things to Consider

A checklist of everything to weigh before and during the build. Use this as
a decision and review gate.

## 1. Strategy & scope
- Build vs. buy vs. hybrid (fine‑tune open model vs. closed API).
- Target languages, frameworks, and domains at launch.
- Autonomy level: suggestions only → supervised edits → autonomous PRs.
- Self‑host vs. managed vs. both.
- Time‑to‑value: ship a RAG‑backed assistant first, train later.

## 2. Model choice
- Base model family and license (must allow commercial + fine‑tune).
- Parameter size vs. latency vs. cost trade‑off.
- Context window length needs (repo‑scale context?).
- Code‑specialized vs. general base.
- Tokenizer suitability for code (whitespace, long identifiers).
- One model vs. a family (small for completion, large for agentic).

## 3. Data (see [data-strategy.md](./data-strategy.md))
- Licensing/copyright of code and docs used for training/RAG.
- PII and secret removal; dedup; decontamination vs. eval sets.
- Data freshness and update cadence.
- Quality filtering and language/domain balance.
- Provenance tracking for auditability.

## 4. Retrieval / documentation grounding
- Which docs are authoritative? Versioning of docs.
- Chunking strategy per source; embedding model choice.
- Hybrid search + reranking; citation enforcement.
- Handling conflicting or outdated documentation.
- Refusal behavior when docs don't cover the question.
- Details: [documentation-driven-suggestions.md](./documentation-driven-suggestions.md),
  [rag-only-strategy.md](./rag-only-strategy.md).

## 5. Agent design
- Planning strategy (ReAct, plan‑execute, tree search).
- Step/token/time/cost budgets and loop‑termination safety.
- Tool schema design and error handling.
- Memory: session vs. project vs. long‑term.
- Multi‑agent orchestration vs. single agent (complexity cost).
- Determinism and reproducibility of agent runs.

## 6. Tooling & load distribution
- What to offload to deterministic tools/MCP vs. the model.
- Sandboxing for code execution.
- Parallelism across sub‑agents and tools.
- See [load-distribution.md](./load-distribution.md).

## 7. Evaluation (see [benchmarks.md](./benchmarks.md))
- Build the eval harness *first*.
- Offline benchmarks + internal task suite + online A/B.
- Guard against benchmark contamination.
- Human‑in‑the‑loop review for quality.

## 8. Hardware & infra
- Training vs. inference hardware; GPU memory budgets.
- Quantization, batching, KV‑cache strategy.
- Autoscaling and multi‑tenancy.
- See [hardware-requirements.md](./hardware-requirements.md).

## 9. Monitoring & operations
- Tracing every agent step; token/cost accounting.
- Quality drift and data drift detection.
- Alerting, on‑call, incident response, rollback.
- See [monitoring-strategy.md](./monitoring-strategy.md).

## 10. Security, privacy, safety
- Opt‑in training on user data; data residency.
- Secret/credential handling; prompt injection; supply‑chain.
- Generated‑code license contamination.
- Audit logs and tenant isolation.
- See [security-privacy.md](./security-privacy.md).

## 11. Cost (see [cost-model.md](./cost-model.md))
- Training cost (one‑off) vs. serving cost (ongoing).
- Cost per request / per developer / per month.
- Caching (prompt + semantic) to cut cost.
- Model routing to control spend.

## 12. UX & product
- Latency budgets by surface (inline vs. chat vs. task).
- How suggestions are presented, accepted, edited, undone.
- Citation display; trust and transparency.
- Feedback capture loops feeding evaluation/training.

## 13. Compliance & governance
- Model cards, data sheets, change logs.
- Regulatory constraints (sector/region specific).
- Responsible‑AI review and red‑teaming.

## 14. Team & process
- Skills: ML, data, platform/infra, product, security.
- MLOps/LLMOps pipeline and release process.
- Versioning of prompts, models, indexes, evals.

## 15. Failure modes to plan for
- Hallucinated APIs / non‑existent functions.
- Infinite agent loops / runaway cost.
- Stale documentation producing wrong answers.
- Silent quality regressions after a model swap.
- Over‑reliance on a single external dependency.
