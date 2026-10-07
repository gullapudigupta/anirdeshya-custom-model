# Benchmarks & Evaluation Harness

How to measure the agent objectively. **Build this before heavy investment** —
every model/prompt/retrieval change is judged here.

## 1. Principles
- **Eval‑first:** no change ships without passing the harness.
- **Multi‑layer:** unit‑level code eval → task‑level agent eval → online A/B.
- **Representative:** mirror real user tasks, languages, repos.
- **Contamination‑free:** keep eval data out of training; track provenance.
- **Reproducible:** pinned seeds, versioned datasets, deterministic configs.

## 2. Benchmark layers
### Layer 1 — Code generation (unit)
Public + internal functional benchmarks executed against tests.
- Examples of categories: function synthesis, bug fixing, multi‑file edits,
  test generation, code explanation.
- Public references (for calibration only; beware contamination):
  HumanEval / HumanEval+, MBPP(+), SWE‑bench / SWE‑bench Verified,
  LiveCodeBench, BigCodeBench, CodeXGLUE, RepoBench, CruxEval, Aider polyglot.
- **Primary metric: `pass@k`** (fraction solved with k samples), plus
  compile/type‑check pass rate.

### Layer 2 — Agentic task success
Real end‑to‑end tasks in sandboxed repos (SWE‑bench‑style): the agent must
edit code so the hidden tests pass.
- **Metrics:** task success rate (% resolved), steps, tool calls, tokens, $,
  wall‑clock, regression rate (did it break other tests?).

### Layer 3 — Documentation grounding
Doc‑QA set with gold sources (see
[documentation-driven-suggestions.md](./documentation-driven-suggestions.md)).
- **Metrics:** answer correctness, **groundedness/faithfulness**, citation
  precision/recall, **abstention correctness** (refuses when docs don't cover).

### Layer 4 — Retrieval quality (RAG)
- **Metrics:** recall@k, MRR, nDCG, reranker precision, context relevance.

### Layer 5 — Online / human
- A/B tests, expert review rubric, user feedback (accept/reject, thumbs).
- **Metrics:** acceptance rate, edit distance, task completion, CSAT.

## 3. Core metric definitions
| Metric | Meaning |
|--------|---------|
| pass@k | ≥1 of k samples passes all tests |
| Task success rate | % agent tasks that meet acceptance (tests pass) |
| Groundedness | % claims supported by cited sources |
| Citation precision/recall | correctness/coverage of citations |
| Acceptance rate | % suggestions accepted by users |
| Edit distance | how much users change accepted output |
| Regression rate | % tasks that break previously passing tests |
| Cost/latency per task | efficiency alongside quality |

## 4. Building the internal eval set
1. **Seed** from public benchmarks for calibration.
2. **Mine production traces** ([monitoring-strategy.md](./monitoring-strategy.md))
   — especially failures and hard cases.
3. **Curate** a "golden set" of tasks with verifiable checks (tests, expected
   diffs, gold citations).
4. **Stratify** by language, task type, difficulty, repo size.
5. **Version & freeze** releases; hold out a secret test split.
6. **Decontaminate** against training data.

## 5. Harness design
- Deterministic runner: given (model, adapter, prompt, retrieval config) →
  produces scored report.
- Sandbox executor for running generated code/tests safely.
- Parallelized; emits machine‑readable results + dashboards.
- Stores every run with full config for comparison and regression tracking.
- Integrated in CI: PRs that change prompts/models must pass thresholds.

## 6. LLM‑as‑judge (use carefully)
- For open‑ended quality (explanations, review comments) use a rubric‑guided
  judge model; **calibrate against human labels**; report judge agreement.
- Never rely on it alone for correctness — prefer executable tests.

## 7. Guarding against gaming
- Rotate/hold out hidden test splits.
- Track contamination; re‑decontaminate on each training cycle.
- Weight **online** metrics over offline when they conflict.

## 8. Reporting
- Scorecard per candidate: each layer's metrics vs. baseline + previous best.
- Trend lines over time; regressions flagged automatically.
- Gate promotion (candidate→canary→prod) on the scorecard.

## 9. Relationship to success metrics
Benchmarks measure **capability**; see
[success-metrics.md](./success-metrics.md) for **product/business success**.
