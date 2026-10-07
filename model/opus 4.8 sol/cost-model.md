# Cost Model & Build‑vs‑Buy

Plan spend across one‑off (training) and ongoing (serving) costs. Fill the
tables with your provider's live prices before committing budget.

## 1. Cost buckets
| Bucket | Type | Driver |
|--------|------|--------|
| Base model | one‑off or $0 | open‑weight = $0; training = large |
| Fine‑tuning | periodic | GPU‑hours × runs |
| Inference/serving | ongoing (largest) | GPU‑hours, tokens, QPS |
| RAG infra | ongoing | vector DB, embeddings, rerank |
| Data pipeline | periodic | cleaning, labeling, storage |
| Storage/egress | ongoing | corpora, checkpoints, logs |
| Observability | ongoing | traces/metrics/logs retention |
| People | ongoing | ML, data, platform, product |

## 2. The dominant cost is usually **serving**, not training
A fine‑tune is a few GPU‑hours; serving runs 24/7 under load. Optimize
serving first.

## 3. Serving cost levers (biggest ROI)
- **Quantization** (INT8/INT4/FP8) → more throughput per GPU.
- **Model routing** small↔large → most traffic on the cheap model
  ([load-distribution.md](./load-distribution.md) §6).
- **Caching** (prompt + semantic + retrieval) → skip model calls.
- **Continuous batching + speculative decoding** → higher utilization.
- **Right‑size context** → fewer tokens per request.
- **Autoscale to load**; use spot/preemptible for batch work.

## 4. Training cost levers
- Prefer **LoRA/QLoRA** over full SFT; full SFT over pre‑training.
- Rent clusters only for bursts; use spot instances.
- Smaller, cleaner datasets beat bigger dirty ones.

## 5. Unit economics to track
- Cost per 1M tokens (in/out) served.
- Cost per accepted suggestion / per task / per active developer / month.
- Training $ per eval‑point improvement (is the rung worth it?).
Tie these to [success-metrics.md](./success-metrics.md).

## 6. Build vs. buy vs. hybrid
| Option | Pros | Cons |
|--------|------|------|
| Closed API | fastest, no infra, top quality | per‑token cost, data leaves, no tuning, lock‑in |
| Open‑weight self‑host | privacy, tunable, fixed cost at scale | infra + ops burden |
| Hybrid | route by sensitivity/difficulty | two stacks to run |

**Recommendation:** open‑weight self‑host for privacy + control + tunability,
with optional closed‑API fallback for the hardest tasks. Revisit as prices and
model quality shift.

## 7. Worked estimate template (fill in)
```
Serving:  N GPUs × $/GPU‑hr × 730 hr/mo            = $____/mo
RAG:      vector DB + embeddings + rerank          = $____/mo
Storage:  corpora + checkpoints + logs             = $____/mo
Observ.:  traces/metrics/logs                       = $____/mo
People:   headcount × loaded cost                  = $____/mo
One‑off:  fine‑tune GPU‑hrs × $/hr × runs          = $____
```

## 8. Budget guardrails
- Per‑tenant + global **cost caps** with throttling.
- Alert on $/hour over budget ([monitoring-strategy.md](./monitoring-strategy.md)).
- Monthly cost review beside the quality scorecard.
