# Monitoring and operations strategy

## 1. Goals

Detect service failures, rising cost, stale or unauthorized retrieval, model-quality drift, unsafe tool behavior and resource saturation. Monitoring shows observed behavior; it does not prove correctness without independent evaluation.

Use OpenTelemetry-compatible traces, metrics and structured logs. Keep security audit records distinct from ordinary debug logs.

## 2. Instrument the complete request

Suggested span tree:

```text
agent.request
  authorize_and_scope
  retrieval.lexical
  retrieval.vector
  retrieval.rerank
  context.build
  model.generate
  output.validate
  tool.invoke / sandbox.validate
  patch.preview / approval / apply
  result.publish
```

Capture model/prompt/contract/index versions, task mode, sanitized error codes, durations, token counts, budgets and result status. Correlation IDs join detailed records; do not put request IDs, user IDs, URLs or arbitrary query text into high-cardinality metric labels.

Default logs do not contain prompts, source code, document passages, secrets, credentials or model reasoning. Opt-in content debugging requires redaction, restricted access and short retention.

## 3. Dashboards and ownership

| Dashboard | Signals | Owner |
|---|---|---|
| User experience | First-token/status and final p50/p95/p99, queue time, cancellation, success/abstention/failure | Product/platform |
| Retrieval quality | No-result rate, version mismatch, freshness lag, retrieval latency, sampled Recall@k | Retrieval/data |
| Generation | Input/output tokens, schema failures, unsupported-claim samples, retry/repair count | Model/evaluation |
| Tools | Error/timeout rate, duration, sandbox startup, cancellation lag, denied calls | Tool/platform |
| Infrastructure | CPU/RAM/disk, GPU memory/utilization, KV preemption, OOM, queue depth | Operations |
| Safety | Unauthorized attempts, seeded-secret detection, cross-tenant access, egress blocks | Security |
| Economics | Spend by mode/tenant/model, cost per verified success, wasted retries | Product/finance |
| Product outcomes | Suggestion acceptance/retention, repair effort, regressions and time saved | Product/evaluation |

Quality metrics requiring ground truth are computed from periodic labelled audits/evaluations, not invented from every request. Treat model-judge scores as auxiliary signals.

## 4. SLOs and alert proposals

Use [requirements.md](requirements.md) for pilot latency/availability targets. Alert thresholds below are starting rules to tune after observing volume and noise.

| Condition | Initial trigger | Action |
|---|---|---|
| User-visible failures | >2% over 15 min with >=100 requests, or synthetic probe failing continuously for 5 min at low traffic | Page platform owner; check dependency/version changes |
| Documentation p95 latency | >15 s for 15 min with adequate samples | Inspect queue, provider, context and reranker latency |
| Retrieval freshness | Critical source not refreshed within 24 h of detected update | Notify data owner; mark affected source stale |
| GPU/cache pressure | Repeated OOM or sustained preemption affecting SLO | Lower concurrency/context; route only to approved alternatives |
| Spend | Daily spend projected >120% of approved budget | Warn owner, tighten quotas; hard cap requires visible incomplete status |
| Schema/tool errors | >1% for a new release with >=100 calls | Pause rollout; compare contract/model versions |
| Safety/isolation violation | Any confirmed secret leak, unauthorized write/egress or tenant leak | Immediate incident response and disable affected capability |
| Quality regression | Held-out success drops >2 points or claim support below gate | Block rollout or rollback after adjudication |

An attempt blocked by policy is not the same as a successful attack. Count both distinctly.

For 99.5% monthly availability over 30 days, the nominal unavailable-time budget is about 216 minutes. Define availability from eligible user requests and publish maintenance/exclusion rules; do not hide provider failures.

## 5. Evaluation cadence

- Every relevant commit: schema, path, authorization, cancellation and fixture tests.
- Every prompt/model/index/tool change: paired evaluation against frozen baseline.
- Nightly or scheduled pilot window: compact representative regression suite.
- Weekly: stratified human audit of citations, usefulness, failures and repaired suggestions.
- Monthly: product outcomes, cost/capacity, source rights/freshness, redaction and deletion review.
- Before expanding permissions: full sandbox/policy/adversarial suite.

Sampling must include failures, abstentions, minority frameworks and long-tail tasks. Report sample counts and uncertainty. Do not collect private code merely to fill an audit quota.

## 6. Runbooks

### Slow or unavailable model

Check provider/service health, queue depth, context lengths, active sequences, cache pressure and network. Reduce concurrency or disable optional reranking only if evaluated and visibly disclosed. Retry within the deadline; switch providers only when already authorized. Otherwise report failure.

### Retrieval regression or stale index

Compare manifest, source hashes, parser/chunker, embedding version and ACL changes. Roll back to a known-good compatible snapshot. Mark stale evidence; do not answer authoritatively when mandatory docs are unavailable.

### Unsafe tool or secret event

Disable affected capability, stop scoped worker tasks by tracked IDs, revoke/rotate compromised credentials, restrict access to logs/artifacts and preserve sanitized audit evidence. Determine disclosure scope, notify responsible owners, and verify fixes before re-enabling.

### Broken model/prompt/tool rollout

Roll back the versioned configuration, pin compatible adapters, replay the non-sensitive failing fixture, run targeted regression and then full release gates.

### Cancellation or resource leak

Trace parent/child task ownership and deadlines. Stop affected tracked descendants, quarantine leaked workers, and run repeated cancellation tests before returning them to the pool.

## 7. Release and retention

Use shadow traffic only with consent and compatible data policy. Canary to a small eligible cohort, compare against control, and automatically stop on safety or major failure thresholds.

Proposed retention starting policy: sanitized operational logs 14 days, aggregate metrics 90 days, opt-in debug content at most 7 days, security audit metadata 180 days, ephemeral sandbox artifacts at most 24 hours unless explicitly retained. These are **policy proposals**, subject to legal and organizational approval. Do not retain secrets at any duration. Deletion must propagate according to documented backup expiration.

Sources: [sources.md](sources.md). Success definitions: [success-metrics.md](success-metrics.md).
