# Training Strategy — Minimum to Maximum

A ladder of training approaches from **zero training** to **full from‑scratch
pre‑training**. Climb only as far as the evidence (from
[benchmarks.md](./benchmarks.md)) justifies. Each rung adds capability, cost,
and risk.

## The ladder at a glance
| Rung | Approach | Training cost | When |
|------|----------|---------------|------|
| 0 | Prompting only | none | Always start here |
| 1 | RAG (no weight change) | none | Freshness, grounding |
| 2 | Few‑shot / prompt opt | ~none | Cheap quality lift |
| 3 | PEFT: LoRA/QLoRA (SFT) | low | Style/format/task fit |
| 4 | Full SFT | medium | Strong behavior change |
| 5 | Preference tuning (DPO/ORPO/RLAIF/RLHF) | medium‑high | Align to preferences |
| 6 | Continued pre‑training (domain) | high | Deep domain/lang gaps |
| 7 | From‑scratch pre‑training | very high | Rarely justified |

---

## MINIMUM ways to train (little/no training)

### Rung 0 — Prompting only
System prompts, instructions, tool schemas, output formats. No training.
*Best first move; establishes a baseline.*

### Rung 1 — Retrieval (RAG)
Inject knowledge at inference time; update by re‑indexing, not retraining.
Covers most "knowledge" needs. See [rag-only-strategy.md](./rag-only-strategy.md).

### Rung 2 — In‑context / few‑shot + prompt optimization
Curated exemplars, automatic prompt search (e.g., DSPy‑style), self‑consistency.
Near‑zero training cost, measurable gains.

### Rung 3 — PEFT (LoRA / QLoRA) — the "minimum real training"
Train small adapters on a few hundred–thousand curated examples.
- Teaches **style, formatting, tool‑use patterns, citation behavior**.
- Runs on modest hardware (QLoRA on a single GPU — see
  [hardware-requirements.md](./hardware-requirements.md)).
- Fast iteration; keep multiple swappable adapters.
**This is the recommended entry point into weight training.**

---

## MIDDLE ways to train

### Rung 4 — Full supervised fine‑tuning (SFT)
Update all weights on a larger high‑quality instruction/code dataset.
- Stronger, more consistent behavior than LoRA.
- Needs multi‑GPU + solid data pipeline ([data-strategy.md](./data-strategy.md)).

### Rung 5 — Preference / alignment tuning
Align outputs to human/AI preferences:
- **DPO / ORPO / KTO** — simpler, no reward model, from preference pairs.
- **RLHF / RLAIF (PPO/GRPO)** — reward model + RL; most powerful, most complex.
- **RLEF / execution‑feedback** — reward from tests passing/compiling (great
  for code: "did the code run and pass?").
Use accepted‑vs‑rejected suggestions from production as preference data.

---

## MAXIMUM ways to train (heavy, rarely needed)

### Rung 6 — Continued (domain‑adaptive) pre‑training
Continue pre‑training the base on large in‑domain corpora (your languages,
internal code/docs) before SFT. Hundreds of GPU‑hours–days.
*Justified only when the base genuinely lacks the domain/language.*

### Rung 7 — From‑scratch pre‑training
Train a new base model from raw tokens: own data mixture, tokenizer,
architecture, curriculum. Requires large clusters, months, six–eight‑figure
budgets, and a specialized team.
*Almost never the right first (or second) move for a product team.*
Advanced levers at this tier: custom tokenizer, long‑context training,
fill‑in‑the‑middle (FIM) objective for code, MoE architectures, curriculum &
data‑mixture tuning, distillation to smaller serving models.

---

## Supporting techniques (apply at several rungs)
- **Distillation:** train a small fast model from a large one (cuts serving cost).
- **Quantization‑aware / post‑training quantization:** shrink for serving.
- **Synthetic data:** generate + filter (execution‑verified) training examples.
- **Self‑improvement:** rejection sampling / best‑of‑n → fine‑tune on winners.
- **FIM objective:** essential for strong inline code completion.
- **Curriculum learning:** easy→hard task ordering.

## Recommended climb
0 → 1 → 2 → **3 (LoRA)** → measure → 4/5 if the eval justifies → 6 only for a
real domain gap → 7 essentially never, unless building a base model is the
actual product. Re‑evaluate at every rung with the harness before climbing.

## Data & governance
All training depends on clean, licensed, decontaminated data — see
[data-strategy.md](./data-strategy.md). Version every dataset, model, and
adapter in the registry ([design.md](./design.md) §4).
