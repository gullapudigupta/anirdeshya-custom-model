# Risks & Open Questions

Living register. Review at every roadmap gate
([roadmap.md](./roadmap.md)).

## 1. Risk register
| # | Risk | Impact | Likelihood | Mitigation |
|---|------|--------|------------|------------|
| R1 | Hallucinated APIs / wrong code | High | Med | Doc‑grounding, citation verify, tool‑verify, tests |
| R2 | Retrieval misses cap quality | High | Med | Hybrid search + rerank, retrieval eval, agentic retrieval |
| R3 | Runaway agent loops / cost | Med | Med | Budgets, step caps, cost alerts, routing |
| R4 | Silent quality regression after model swap | High | Med | Eval gate, canary, auto‑rollback |
| R5 | Secret leakage | High | Low | Input/output scanning, redaction, no secrets to APIs |
| R6 | Prompt injection via docs/repo | High | Med | Treat content as untrusted, perms, approval gates |
| R7 | License contamination in output | Med | Low | License filter, dedup, provenance tracking |
| R8 | Unsafe code execution | High | Low | Sandboxing, least privilege, egress control |
| R9 | Stale/conflicting docs → wrong answers | Med | Med | Versioning, re‑index, conflict surfacing |
| R10 | Cost overruns at scale | Med | Med | Quantize, route, cache, budgets |
| R11 | Over‑reliance on one base model/vendor | Med | Med | Open weights, swappable base, abstraction layer |
| R12 | Benchmark contamination inflates scores | Med | Med | Decontamination, hidden test split |
| R13 | Low adoption despite capability | High | Med | UX focus, latency, trust/citations, feedback loop |
| R14 | Data/privacy compliance breach | High | Low | Opt‑in, residency, audit, RBAC |
| R15 | Scope creep into from‑scratch training | Med | Med | Evidence‑gated training ladder |

## 2. Open questions (decide before committing)
1. Which base model family + license?
2. Self‑host, managed, or hybrid for launch?
3. Target languages/frameworks for MVP?
4. Autonomy level at launch (suggest vs. supervised vs. autonomous)?
5. RAG‑only vs. RAG + LoRA from the start?
6. Which doc sources are authoritative; who owns corpus curation?
7. Cloud vs. on‑prem for serving and for training bursts?
8. Managed vector DB vs. self‑hosted?
9. Opt‑in policy + data residency commitments to customers?
10. Budget envelope (serving $/mo, training one‑off)?
11. Build vs. buy for closed‑API fallback on hard tasks?
12. Primary north‑star metric + launch targets?

## 3. Decision log (fill as decided)
| Date | Decision | Rationale | Owner |
|------|----------|-----------|-------|
| | | | |

## 4. Assumptions to validate
- Open‑weight model + RAG meets quality bar for MVP.
- Retrieval quality is the main lever (not model size).
- Serving, not training, dominates cost.
- Incremental ladder beats big up‑front training.
