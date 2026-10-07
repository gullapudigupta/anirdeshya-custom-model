# Benchmark strategy and measurement

## 1. Measure the model and the whole agent separately

A strong model can fail with bad retrieval/tools; a weaker model can succeed with excellent evidence and validation. Report component scores and end-to-end outcomes rather than attributing every result to "the model."

| Layer | What to test | Primary evidence |
|---|---|---|
| Retrieval | Relevant/version-correct/authorized passages found and ranked | Human relevance labels and source snapshots |
| Generation | Supported explanations, API correctness, schema compliance | Claim audits, API catalog, constrained task tests |
| Coding | Function/example correctness | Executed hidden tests in a sandbox |
| Repository reasoning | Definitions, references, evidence paths, unresolved boundaries | Compiler-backed fixture graphs |
| Agent | Issue resolution and regression prevention | Patch receipts, hidden tests, review |
| Safety | Permissions, secrets, injection, path/tenant isolation | Deterministic checks and adversarial fixtures |
| Systems | Latency, throughput, memory, cost, cancellation | Instrumented load tests |

## 2. Benchmark portfolio

- **Internal documentation benchmark:** highest priority for this product. Include exact APIs, paraphrases, multipart questions, version migrations, missing answers, conflicting docs and malicious content.
- **Internal TypeScript/Node repository tasks:** controlled small fixes with hidden regression tests. Add Angular fixtures before promising Angular coverage.
- **Public function-level benchmarks:** HumanEval/MBPP or BigCodeBench can provide standardized coding comparisons. BigCodeBench focuses on practical function-level tasks with library use; public-set contamination and language mismatch limit conclusions.
- **Public repository benchmark:** SWE-bench evaluates patches for real-world issues using a reproducible harness. Choose a named subset/version and report it exactly; its results do not substitute for the target TypeScript/Angular benchmark.
- **Custom tools/safety/load suite:** covers behaviors standard coding benchmarks do not measure.

Use public benchmarks only after checking dataset, repository and environment licenses and execution requirements. Do not fetch or run third-party test code with host credentials.

## 3. Proposed first dataset

Separate development/tuning and final held-out sets by source/repository family and time. Example budget:

- Development: 100 documentation questions and 30 small repository tasks.
- Held-out documentation: 200 questions: 120 answerable, 40 missing/conflicting-version, 20 multipart and 20 adversarial/ACL cases.
- Held-out agent: 100 small repository tasks across several disjoint projects; at least 30 per major language/framework slice before making per-slice claims.
- Policy fixtures: at least 50 boundary/injection/secret/cancellation cases with multiple seeded variants.
- Load profile: 100,000 approved chunks, 5 concurrent documentation queries initially; sweep 1/2/5/10 thereafter.

These sample sizes are proposed budgets, not proof of statistical power. At n=100 and success near 50%, a 95% interval is roughly +/-10 percentage points; small claimed improvements need more tasks or matched evidence.

Include answerable coverage metrics so refusal cannot game quality. Count all valid assigned tasks in end-to-end denominators; disclose harness-invalid cases separately using predefined rules.

## 4. Metric definitions

### Retrieval

- `Recall@k = relevant gold passages retrieved in top k / all relevant gold passages`, averaged over answerable queries with relevance labels.
- `MRR = mean(1 / rank_of_first_relevant_result)`, zero when no relevant result is returned.
- nDCG@k can measure graded relevance when labels support it.
- Version correctness: returned passages matching requested version / returned passages with version requirements.
- Unauthorized retrieval: any passage/artifact visible outside approved ACL; release target zero.

### Answer quality

- Supported cited-claim rate: cited factual claims adjudicated supported / all cited factual claims.
- Citation reference validity: references resolving to correct snapshot/section / all emitted references. A resolving link alone does not imply support.
- Citation completeness: externally checkable claims with adequate evidence / all externally checkable claims.
- Correct abstention/clarification: correct missing/conflict outcomes / all gold missing/conflict tasks.
- Answer coverage: answerable tasks receiving a substantive answer / all answerable tasks.
- Verified usefulness: tasks receiving correct, usable, evidence-grounded output / all eligible tasks; not just tasks the model chose to answer.

### Coding and agent

- `pass@1`: fraction solved on the first sampled attempt under a specified fixed budget.
- When generating n independent candidates with c passing candidates, the usual estimator is `pass@k = 1 - C(n-c,k)/C(n,k)` for n >= k. Sequential repairs are not interchangeable with independent samples.
- Verified issue resolution: required tests and baseline regression suite pass, scope review passes, and no safety violation / all eligible assigned issues.
- Report first-attempt and final-with-repair success separately, including repair count and total budget.
- Existing failing baseline tests must be labelled before the run; do not ignore new failures or count unchanged broken tasks as fixed.

### Systems and economics

- First-token/status and final p50/p95/p99; include queue and tool time.
- Successful tasks/minute at stated concurrency; input/output length distribution.
- Peak RAM/VRAM, OOM, cache preemption, timeout, cancellation lag and worker leaks.
- Total serving/tool/infra cost divided by verified successes; include failed and abstained attempts in total cost.

## 5. Reproducible evaluation procedure

1. Freeze task IDs, repository commits, dependency locks, docs/index snapshot and evaluator version.
2. Freeze model/quantization, prompt, tool versions, context/call/cost/deadline caps, temperature and sampling settings.
3. Verify rights and scan fixtures for real secrets; use artificial seeded values for safety tests.
4. Build isolated environments with no network by default, limited filesystem/resources, and no credentials.
5. Run baseline and candidate on the same eligible tasks with equal budgets. Keep hidden tests inaccessible to the agent.
6. Store output/patch digest, sanitized tool receipts, latency/cost, evaluator results and failure classification.
7. Repeat stochastic runs, for example three seeds for expensive agent runs when feasible, and report between-run variability. API/provider updates may prevent bitwise repeatability; record actual model/version identifiers.
8. Audit ambiguous outputs blind to system identity; adjudicate disagreements.
9. Report confidence intervals, paired differences and task slices.
10. Publish pass/fail gates and error analysis before changing the system.

Failure taxonomy: missing corpus, retrieval miss, version mismatch, unsupported claim, reasoning error, patch error, validation/harness failure, policy denial, timeout, model/provider failure, unsafe action.

## 6. Statistical and contamination controls

- Use Wilson intervals for proportions; paired bootstrap over task IDs or a paired test for comparisons.
- Bootstrap by repository/source family when tasks are correlated.
- Predefine sample size or use a documented sequential procedure; avoid repeated peeking until a desired improvement appears.
- Deduplicate tasks and near-duplicates across train/dev/test. Hold out repositories and later time windows where possible.
- Public benchmark scores may reflect pretraining contamination; disclose this limitation instead of claiming guaranteed independence.
- Never feed hidden tests, expected patches or final-test labels into retrieval/training.
- If the final test set is used for tuning, retire it and create a new holdout.

## 7. Required report shape

```text
Run ID / date:
Dataset + task counts + exclusions:
Model / quantization / prompt / tool / index versions:
Hardware + runtime + concurrency:
Budget + sampling settings:
Success and 95% interval by task slice:
Claim support / citation completeness / abstention / coverage:
Safety violations and denial counts:
Latency distribution + errors + peak memory:
Total cost + cost per verified success:
Paired change from baseline + uncertainty:
Known contamination / harness / privacy limitations:
Decision: promote, iterate, or reject:
```

No benchmark has been run by this documentation task. References: [sources.md](sources.md). Release criteria: [requirements.md](requirements.md).
