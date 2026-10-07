# Training options: minimum to maximum

## 1. The real minimum is zero training

For a useful new agent, begin with an existing model, prompt/schema design, RAG, and tools. Do not call documentation indexing, prompt editing, few-shot examples, or model routing "training the model."

The minimum actual weight-training experiment is usually supervised adapter training on a small, rights-cleared, high-quality dataset. It is not foundation training and it does not make a weak base model universally strong.

## 2. Investment ladder

All dataset sizes below are illustrative starting experiments, not universal thresholds. Count tokens, task diversity, languages, rights, and quality as well as examples.

| Level | Method | Example initial data | Expected purpose | Main risk |
|---|---|---|---|---|
| 0 | No training: prompts, RAG, tools | 100-300 labelled dev tasks plus held-out tests | Product baseline and knowledge grounding | Weak base behavior remains |
| 1 | Train/rerank small retrieval or intent model | Hundreds to thousands of relevance/intent labels | Better retrieval/routing | Overfit labels, worse long-tail coverage |
| 2 | LoRA/QLoRA supervised fine-tuning | Roughly 500-5,000 reviewed demonstrations | Output format, tool use, style, abstention | Small-data overfitting and regression |
| 3 | Larger multi-task SFT/adapters | Roughly 10,000-100,000 varied verified examples | Wider workflows and task consistency | Bad trajectories teach bad habits |
| 4 | Preference optimization, e.g. DPO | Thousands to tens of thousands of reviewed preference pairs | Select better/safe responses | Biased preferences and reward gaming |
| 5 | Execution-feedback/RL optimization | Verified task environments and many bounded rollouts | Tool policies and repair strategy | Sparse/brittle reward, unsafe exploration |
| 6 | Continued pretraining + SFT | Large licensed domain corpus, evaluated by token budget | Domain/language adaptation | Forgetting, rights, expensive experiments |
| 7 | Full-parameter fine-tuning | Strong curated task corpus with mixed general data | Broad behavior changes | Memory/compute and regressions |
| 8 | Foundation training from scratch | Licensed large-scale text/code data and new tokenizer/model | New weights and research control | Vast data/compute/quality risk |

LoRA freezes base weights and trains low-rank updates. QLoRA commonly combines a quantized frozen base with trainable adapters. Compatibility, memory, adapter merging, and quality must be validated for the selected model/runtime. Quantization by itself is compression, not task learning.

There is no finite universal "maximum" training scale. Level 8 represents the highest-control approach, not a guarantee of frontier performance.

## 3. Minimum credible adapter experiment

1. Select an open-weight base with appropriate use and training rights.
2. Freeze a RAG-only baseline and a test set before creating training examples.
3. Identify one behavior to improve: valid tool schema, source-aware answer style, reliable abstention, or a specific language task.
4. Collect diverse, reviewed examples. Include negatives, failed tool results, missing evidence, version conflicts and safe denials.
5. Split by repository/source family and time; related issues/near-duplicates cannot cross train and test.
6. Train a small adapter with a recorded seed/config and checkpoints.
7. Evaluate task success, syntax/schema compliance, claim support, safety, latency and cost against the same baseline.
8. Deploy only if improvement survives held-out evaluation with no safety/compatibility regression; preserve rollback to the base model.

A successful tiny training run proves the pipeline works, not that the model is production ready.

## 4. Dataset records

Store:

- Task ID, language/framework/version, source provenance and rights.
- Permitted context, inputs, expected output/tool actions, reviewed evidence.
- Patch and execution receipts where appropriate.
- Outcome labels and adjudication history; no fabricated "tests passed."
- Dataset split, deduplication family and contamination checks.
- Consent/retention tags; secret-scan and personal-data decisions.

Use observable actions, short rationales, tool receipts and results. Do not require or archive private internal reasoning traces. Synthetic data must be labelled, rights-reviewed, deduplicated, tested, and human-audited. More synthetic examples can amplify correlated mistakes.

## 5. Rewards and preference quality

Execution success is useful but insufficient. A patch that passes weak tests can still remove functionality, exploit the test harness, or violate scope. Include:

- Hidden regression and task-specific tests.
- Diff scope and maintainability review.
- Permission, egress, secrets and resource-budget checks.
- Penalties/denials for unsupported claims and unapproved tools.
- Independent evaluator logic, not solely a model grading itself.

Keep training sandboxes isolated with no production credentials. Test answers and hidden evaluator files must not be visible to the agent.

## 6. Maximum route: training from scratch

Separate this into a research program:

1. Define target model size, context length, architecture, languages, license and deployment constraints.
2. Acquire rights-cleared corpus; deduplicate, quality-filter, separate evaluation repositories, and document lineage.
3. Train tokenizer and data mixtures; run small scaling pilots before cluster commitments.
4. Measure stable throughput, loss, downstream coding quality and estimated learning curves.
5. Plan distributed pretraining, checkpoint/restart, networking, storage, fault tolerance and optimizer state.
6. Continue with instruction/tool SFT, preference/safety alignment and execution-based evaluations.
7. Distill/quantize if needed and validate deployment parity.
8. Fund serving, refreshes, incident response, and retraining after initial training.

For dense-model rough planning, training compute is often approximated as `FLOPs ~= 6 * parameters * training_tokens`. Architecture, attention/context cost, repeated tokens, optimizer, and implementation efficiency can materially change it.

Illustration, not a recommendation: 7 billion parameters and 1 trillion tokens give about `4.2e22 FLOPs`. At an assumed **measured sustained** 100 TFLOP/s per GPU, that is about 117,000 GPU-hours before operational overhead. At 256 such GPUs, idealized time is about 19 days; communication, failures, low utilization, experiments and post-training add time and cost. Peak vendor TFLOP/s must not be substituted for sustained training throughput.

A 7B model trained on this illustrative token budget is not guaranteed to compete with frontier systems.

## 7. Go/no-go rules

Training is justified only when:

- Correct evidence/tools are already available.
- A repeatable behavior gap appears in real tasks.
- A licensed, representative dataset and independent tests exist.
- Compute and maintenance fit budget.
- Measured improvement exceeds simpler changes at acceptable cost.

Do not train frequently changing API facts into weights as the primary freshness mechanism. Keep those facts in RAG. Prefer retrieval fixes for retrieval failures and policy fixes for permission failures.

Compute sizing: [hardware.md](hardware.md). Governance: [security-data.md](security-data.md). Evaluation: [benchmarks.md](benchmarks.md).
