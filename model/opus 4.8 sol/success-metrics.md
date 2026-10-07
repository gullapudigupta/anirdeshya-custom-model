# Measuring Success of the Model

Benchmarks ([benchmarks.md](./benchmarks.md)) measure *capability*. This
document defines whether the agent is **successful** as a product and
investment. Success = capable **and** adopted **and** valuable **and** safe.

## 1. Success framework (4 lenses)
1. **Capability** — can it do the work well?
2. **Adoption** — do people use it and keep using it?
3. **Value** — does it save time / improve quality / reduce cost?
4. **Trust & safety** — is it reliable, grounded, and safe?

## 2. North‑star metric
Pick one primary metric that captures delivered value, e.g.
**"accepted, retained AI code contributions per active developer per week"**
(suggestions accepted *and* still present after N days). It balances quantity
(acceptance) with quality (retention).

## 3. KPIs by lens
### Capability
- Task success rate, pass@k, doc‑groundedness (from the eval harness).
- Regression rate (doesn't break working code).

### Adoption
- Daily/weekly/monthly active users; stickiness (DAU/MAU).
- Suggestions shown vs. accepted (acceptance rate).
- Feature usage mix (completion vs. chat vs. agentic task).
- Retention / churn over time.

### Value / productivity
- Time‑to‑completion for tasks (with vs. without the agent).
- % of merged code assisted by the agent; **code retention rate**
  (AI code still present after N days/commits).
- PR cycle time, review time, defect/escaped‑bug rate.
- Developer‑reported productivity & satisfaction (survey/DevEx).
- Support/doc‑lookup deflection (fewer "how do I use X" questions).

### Trust & safety
- Groundedness / hallucination rate on doc‑grounded answers.
- Guardrail catch rate (secrets, licenses) and false‑positive rate.
- Incident count/severity; rollback frequency.

### Efficiency (guardrail metrics — keep healthy while growing north‑star)
- Cost per accepted suggestion / per task / per active developer.
- Latency (p50/p95) per surface.
- GPU utilization / tokens served per dollar.

## 4. Baselines & targets
- Establish a **baseline** (no agent, or a strong off‑the‑shelf open model)
  before launch.
- Define targets as deltas vs. baseline (e.g., +15% task success, −20% task
  time) — see NFRs in [requirements.md](./requirements.md).
- Re‑baseline after major model changes.

## 5. How to measure credibly
- **Controlled studies / A‑B:** agent vs. control cohort on real tasks.
- **Online experiments:** canary + holdout to attribute impact.
- **Retention analysis:** track AI code survival across commits.
- **Surveys:** periodic DevEx/CSAT with consistent questions.
- **Qualitative review:** expert rubric scoring on sampled outputs.
- Beware vanity metrics (raw suggestion count) — weight *accepted + retained*.

## 6. Leading vs. lagging indicators
| Leading (fast) | Lagging (slow, trustworthy) |
|----------------|-----------------------------|
| Acceptance rate, latency, groundedness | Retention, productivity, defect rate |
| Eval scorecard | Business ROI, churn, CSAT trend |

Use leading indicators to iterate fast; judge real success on lagging ones.

## 7. Review cadence
- **Daily:** health + guardrail dashboards.
- **Weekly:** quality + adoption + cost scorecard.
- **Monthly:** north‑star, retention, productivity, drift review.
- **Per release:** full eval scorecard + model card.

## 8. Definition of success (MVP)
The MVP is successful when: eval thresholds are met, a pilot cohort shows
higher task success and lower task time than baseline, acceptance + retention
are healthy, groundedness is within target, and no unresolved
security/guardrail incidents.
