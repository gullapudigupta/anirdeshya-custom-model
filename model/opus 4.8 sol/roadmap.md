# Roadmap — Phased Delivery

Sequenced plan to go from nothing to a trustworthy coding agent while
investing incrementally. Each phase ends with a measurable gate.

## Guiding principle
Ship value early with **RAG + a strong open model**, prove it with the **eval
harness**, then climb the training ladder only where metrics justify.

---

## Phase 0 — Foundations (weeks)
**Goal:** scaffolding + baseline.
- Choose open‑weight base model(s) + serving stack
  ([hardware-requirements.md](./hardware-requirements.md)).
- Stand up **evaluation harness** first ([benchmarks.md](./benchmarks.md)).
- Basic observability/tracing ([monitoring-strategy.md](./monitoring-strategy.md)).
- **Gate:** baseline scores recorded; traces visible.

## Phase 1 — RAG assistant (weeks)
**Goal:** doc‑grounded chat + completion.
- Doc ingestion + hybrid retrieval + reranker
  ([rag-only-strategy.md](./rag-only-strategy.md)).
- Citations + abstention
  ([documentation-driven-suggestions.md](./documentation-driven-suggestions.md)).
- Inline completion surface.
- **Gate:** groundedness + retrieval + latency targets met on eval.

## Phase 2 — Agent + tools (weeks–months)
**Goal:** agentic task execution.
- Orchestrator loop, tool/MCP layer, sandboxed exec
  ([load-distribution.md](./load-distribution.md),
  [security-privacy.md](./security-privacy.md)).
- Test‑runner, lint, git, file‑edit tools; reviewer sub‑agent.
- **Gate:** task success rate on agentic eval beats baseline.

## Phase 3 — Light tuning (months)
**Goal:** fix behavior cheaply.
- LoRA/QLoRA for faithful grounding, citation format, tool use
  ([training-strategy.md](./training-strategy.md) Rung 3).
- Feedback loop → data pipeline ([data-strategy.md](./data-strategy.md)).
- **Gate:** eval improvement vs. Phase 2; no regressions.

## Phase 4 — Scale & harden (months)
**Goal:** production readiness.
- Model‑tier routing, caching, autoscaling, cost controls
  ([cost-model.md](./cost-model.md)).
- Drift detection, alerting, canary + rollback.
- Security review + red‑teaming.
- **Gate:** NFRs (latency, availability, cost, safety) met.

## Phase 5 — Advanced training (optional, evidence‑gated)
**Goal:** close gaps RAG+LoRA can't.
- Full SFT / preference tuning (DPO/RLAIF), execution‑feedback RL
  ([training-strategy.md](./training-strategy.md) Rungs 4–5).
- Continued pre‑training only for a real domain gap (Rung 6).
- **Gate:** each rung justified by eval ROI vs. cost.

---

## Milestone metrics (track per phase)
| Phase | Primary gate metric |
|-------|---------------------|
| 0 | baseline recorded, traces live |
| 1 | groundedness ≥ target, retrieval recall@k |
| 2 | agentic task success > baseline |
| 3 | eval delta from LoRA, no regressions |
| 4 | NFRs met (latency/availability/cost/safety) |
| 5 | eval ROI per training rung |

## Team ramp
Start: platform + ML‑lite + product. Add data engineering by Phase 3 and
dedicated ML/training by Phase 5. Security involved from Phase 2.

## Review
Reassess scope at each gate; a phase may be the right **final** state (e.g.,
stopping at Phase 1/2 for a pure doc assistant).
