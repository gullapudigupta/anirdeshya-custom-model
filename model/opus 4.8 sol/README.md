# Brand‑New Coding Agent — Strategy Hub

> Strategy workspace for designing, training, serving, and operating a
> brand‑new coding agent from scratch. This folder is the single source of
> truth for the architecture, requirements, training, evaluation, hardware,
> and operations plan.

Open **`index.html`** in a browser for a clickable index of every document.

## Document map

| # | Document | What it answers |
|---|----------|-----------------|
| 1 | [requirements.md](./requirements.md) | Functional + non‑functional requirements, scope, personas |
| 2 | [design.md](./design.md) | End‑to‑end system architecture and component design |
| 3 | [considerations.md](./considerations.md) | Everything to consider before/while building |
| 4 | [documentation-driven-suggestions.md](./documentation-driven-suggestions.md) | Options for coding suggestions grounded *purely on documentation* |
| 5 | [hardware-requirements.md](./hardware-requirements.md) | Hardware for training, fine‑tuning, inference, RAG |
| 6 | [monitoring-strategy.md](./monitoring-strategy.md) | Observability, logging, tracing, alerting, drift |
| 7 | [benchmarks.md](./benchmarks.md) | How to measure benchmarks + eval harness |
| 8 | [success-metrics.md](./success-metrics.md) | How to measure the success of the model/product |
| 9 | [training-strategy.md](./training-strategy.md) | Minimum ways → maximum ways to train |
| 10 | [rag-only-strategy.md](./rag-only-strategy.md) | What to do if we rely on RAG only |
| 11 | [load-distribution.md](./load-distribution.md) | Splitting load across MCP servers, tools, sub‑agents |
| 12 | [data-strategy.md](./data-strategy.md) | Data sourcing, licensing, cleaning, dedup, governance |
| 13 | [security-privacy.md](./security-privacy.md) | Security, privacy, safety, compliance |
| 14 | [cost-model.md](./cost-model.md) | Cost of training + serving, TCO, build‑vs‑buy |
| 15 | [roadmap.md](./roadmap.md) | Phased delivery plan and milestones |
| 16 | [risks-and-open-questions.md](./risks-and-open-questions.md) | Risk register + decisions to be made |
| 17 | [glossary.md](./glossary.md) | Shared terminology |

## TL;DR strategy

1. **Don't start by training a base model.** Start by assembling an
   *agent harness* around a strong existing open‑weight model, plus a
   high‑quality **RAG layer over documentation**. This gives value in weeks.
2. **Layer capability in stages:** Prompted base → RAG → tool/agent use →
   light fine‑tuning (LoRA/SFT) → preference tuning (DPO/RLAIF) → (only if
   justified) continued pre‑training or from‑scratch training.
3. **Measure relentlessly.** Stand up the evaluation harness
   ([benchmarks.md](./benchmarks.md)) *before* heavy investment so every
   change is judged on pass@k, task success, latency, and cost.
4. **Scale horizontally.** Push work off the core model onto
   deterministic tools, MCP servers, retrieval, and specialized sub‑agents
   ([load-distribution.md](./load-distribution.md)).

See [roadmap.md](./roadmap.md) for the sequenced plan.
