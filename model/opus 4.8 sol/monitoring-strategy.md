# Monitoring Strategy

Observability for a coding agent spans classic service metrics **and**
ML/agent‑specific quality signals. "If you can't trace it, you can't trust it."

## 1. Pillars
1. **Service health** — latency, errors, saturation, availability.
2. **Model/inference** — tokens/s, GPU utilization, KV‑cache, queue depth.
3. **Agent behavior** — steps, tool calls, loops, cost per task.
4. **Quality** — groundedness, success rate, accept/reject, drift.
5. **Business** — adoption, retention, value delivered.

## 2. Tracing (most important)
Every request gets a **trace** capturing the full agent run:
- Prompt + assembled context (with retrieval sources).
- Each planner step, tool/MCP call, inputs/outputs, latencies.
- Model calls: model+adapter version, tokens in/out, cost.
- Final output, citations, guardrail verdicts, user feedback.

Use OpenTelemetry + an LLM‑trace tool (e.g., Langfuse, Phoenix, Traceloop,
or equivalent). Traces are the backbone of debugging **and** eval dataset
creation.

## 3. Metrics to collect
### Service
- Request rate, error rate (by type), p50/p95/p99 latency per surface
  (inline / chat / task).
- First‑token latency and streaming tokens/s.
- Availability / uptime.

### Inference / GPU
- GPU/CPU/mem utilization, temperature, power.
- Throughput (req/s, tokens/s), batch size, KV‑cache hit/occupancy.
- Queue depth, time‑in‑queue, OOM/evictions, model load time.

### Retrieval / RAG
- Retrieval latency, top‑k relevance, reranker scores.
- Cache hit rate (prompt + semantic).
- % answers with valid citations; "not in docs" abstention rate.

### Agent
- Steps per task, tool‑call count + failure rate, loop/timeout rate.
- Tokens + $ per task; budget‑exceeded events.
- Sub‑agent fan‑out and latency.

### Quality (online)
- Suggestion accept/reject rate; edit distance after accept.
- Thumbs up/down; regenerate rate.
- Task success (tests pass / user confirms).
- Groundedness/faithfulness sampling.
- Hallucination reports.

## 4. Logging
- Structured JSON logs with trace/span IDs.
- **Redaction** of secrets/PII before storage.
- Separate audit log (immutable) for security/compliance events.
- Retention policy per data class; honor privacy settings.

## 5. Drift detection
- **Data drift:** input distribution shifts (languages, prompt types, repo
  sizes).
- **Quality/performance drift:** rolling success/accept rate vs. baseline.
- **Doc drift:** source docs changed → re‑index + re‑eval.
- **Model drift:** after any model/adapter/prompt change, run the eval suite
  and compare.
Alert on statistically significant regressions.

## 6. Alerting & on‑call
| Signal | Example threshold | Action |
|--------|-------------------|--------|
| Error rate | > 2% 5‑min | page on‑call |
| p95 latency | > 2× budget | investigate/scale |
| GPU OOM | any | auto‑restart + alert |
| Cost/hour | > budget | throttle/route down |
| Quality drop | success −10% vs. baseline | freeze rollout, rollback |
| Guardrail breach | secret/license leak | block + incident |

Dashboards: one per audience (SRE, ML, product). Golden‑signal overview +
drill‑down traces.

## 7. Feedback → improvement loop
Captured feedback and traces feed:
- The **eval set** ([benchmarks.md](./benchmarks.md)) — hard/failed cases.
- **Training data** ([training-strategy.md](./training-strategy.md)) — curated
  accepted edits, preference pairs.
- **Retrieval tuning** — queries that retrieved poorly.

## 8. Experimentation
- A/B and shadow testing for model/prompt/retrieval changes.
- Canary rollout gated on live quality metrics with auto‑rollback.
- Offline eval must pass before any online experiment.

## 9. Governance & reporting
- Model cards + run reports per release.
- Weekly quality + cost report; monthly drift review.
- Incident postmortems feed the risk register
  ([risks-and-open-questions.md](./risks-and-open-questions.md)).

## 10. Tooling summary
- **Metrics:** Prometheus + Grafana.
- **Tracing:** OpenTelemetry + LLM‑trace platform.
- **Logs:** ELK/Loki or managed equivalent.
- **GPU:** DCGM exporter / nvidia‑smi scraping.
- **Eval:** in‑house harness + scheduled runs (see benchmarks).
