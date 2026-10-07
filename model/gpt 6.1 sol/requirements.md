# Requirements and acceptance criteria

Status: proposed specification. MUST indicates a release requirement, not an already implemented feature. SHOULD indicates a recommended default. Targets assume the pilot profile in [README.md](README.md); review them after baseline measurement.

## 1. Roles, modes, and permissions

- Developer: asks questions, inspects suggestions, approves scoped changes.
- Administrator/data steward: approves document sources, retention, models, and tools.
- Operator/evaluator: monitors health and runs evaluations without blanket access to private content.

| Mode | Context allowed | Mutation/execution |
|---|---|---|
| Documentation-only | Approved documentation and user request | None; code is an illustrative suggestion |
| Repository-read | Above plus explicitly authorized repository reads | None |
| Patch-preview | Repository-read plus generated patch artifact | Isolated artifact only; no live repository writes |
| Approved-execution | Approved patch and allowlisted validation commands | Scoped isolated workspace; apply to live workspace requires separate approval |

Mode changes MUST require an explicit capability decision. Retrieved text and model output cannot authorize them.

## 2. Functional requirements

| ID | Priority | Requirement | Acceptance evidence |
|---|---|---|---|
| FR-01 | MVP MUST | Normalize language, framework/version, objective, mode, and budgets | Schema rejects malformed requests; ambiguous version is clarified or marked unspecified |
| FR-02 | MVP MUST | Ingest approved versioned docs with rights and access metadata | Reject unapproved source; persist source ID, version, digest, fetch date, ACL and license decision |
| FR-03 | MVP MUST | Hybrid retrieval with filters and evidence provenance | Retrieval suite meets Recall@10 target; every returned passage is authorized and version-compatible |
| FR-04 | MVP MUST | Ground documentation claims and API suggestions | Sources resolve; audit checks claim support and correct API version |
| FR-05 | MVP MUST | Abstain on insufficient evidence and expose conflicting versions | Missing/contradictory-source fixtures yield actionable uncertainty, not invented certainty |
| FR-06 | MVP MUST | Distinguish illustrative, inspected, validated, and incomplete outputs | No docs-only output says repository tests passed; validation includes actual tool receipts |
| FR-07 | MVP MUST | Cancellation and bounded work | All async stages honor deadline/abort; isolated worker descendants terminate within proposed 2-second cancellation target in fixture environment |
| FR-08 | MVP MUST | Structured errors and human-readable status | Retrieval outage, schema error, denial, timeout and budget exhaustion have distinct codes |
| FR-09 | MVP MUST | Capture opt-in outcome feedback | Store accepted/rejected/repaired outcome without default capture of private code |
| FR-10 | Phase 2 MUST | Authorized symbol/reference search and diagnostics | Definitions and relationships carry path, region, commit and provider evidence; unresolved links stay unresolved |
| FR-11 | Phase 3 MUST | Preview patches against exact baseline | Unified diff includes baseline hash; stale or escaping paths fail before application |
| FR-12 | Phase 3 MUST | Run approved validations in isolated workers | Tool receipt records environment, command, exit code and artifact; limits and egress enforced |
| FR-13 | Phase 3 MUST | Approval-gated live application | Denied approval means zero live writes; concurrent edits require new preview/approval |
| FR-14 | SHOULD | Deterministic caching and model routing | Tenant/version partition tests; route selected before request dispatch; no private escalation without permission |
| FR-15 | Later SHOULD | Independent specialist workers/agents | Same-budget comparison shows gain; cancellation and permission tests pass |

## 3. Nonfunctional and safety requirements

| ID | Requirement | Proposed release criterion |
|---|---|---|
| NFR-01 | Tenant isolation | Zero cross-tenant retrieval, cache, log, artifact or credential leaks in release suite |
| NFR-02 | No unauthorized mutation/egress | Zero violations in adversarial suite; any production incident triggers containment |
| NFR-03 | Redaction | Zero seeded secret values in generated outputs or telemetry fixtures |
| NFR-04 | Reproducibility | Eval manifest pins dataset, code commit, docs/index, model, prompt, tools and environment |
| NFR-05 | Availability | Pilot docs-answer API target 99.5% monthly, excluding agreed maintenance; report provider failures separately, not removed from user-visible availability |
| NFR-06 | Latency | At 5 concurrent docs requests, warm service: p95 first visible token/status <=3 s; p95 final docs answer <=15 s for <=1,000 output tokens |
| NFR-07 | Retrieval latency | p95 <=500 ms warm retrieval on proposed 100,000-chunk index at 5 concurrent queries; report reranking separately and combined |
| NFR-08 | Patch latency | p95 <=120 s for small-task profile, <=3 files and validation <=60 s; longer jobs expose async progress and a deadline |
| NFR-09 | Freshness | Critical supported-doc updates indexed within 24 h of detection; other approved updates within 7 days; failed refresh is visible |
| NFR-10 | Budget control | Enforce per-request token, time, tool, fan-out, and monetary caps; exhaustion is incomplete, never success |
| NFR-11 | Accessibility | Keyboard-operable UI, labelled status/actions, readable contrast, no color-only state |
| NFR-12 | Compatibility | Contract-version tests and provider adapter tests; unsupported versions fail explicitly |
| NFR-13 | Deletion | Approved deletion policy covers source, index, cache, telemetry and backups with documented purge schedule |

Latency/capacity targets are hypotheses, not hardware guarantees. Local configurations that miss them must lower concurrency, improve infrastructure, or define a visibly different service tier.

## 4. Initial quality gates

Definitions and denominators are in [benchmarks.md](benchmarks.md) and [success-metrics.md](success-metrics.md).

- Authorized, answerable documentation set: Recall@10 >=90%.
- Documentation answer set: supported cited-claim rate >=95%; citation reference validity >=99%.
- Missing/version-conflict set: correct abstention/clarification >=95%.
- All eligible documentation tasks: end-to-end verified usefulness >=80%; abstentions on answerable tasks count against usefulness.
- Agent pilot small-issue set: >=60% verified resolution, zero safety violations, and no regression greater than 2 percentage points against the selected baseline.
- Positive trial claims require uncertainty intervals, matched budgets, and minimum sample counts; a point estimate alone is insufficient.

No requirement can be certified from these documents. Each needs executable tests, human audits where necessary, and recorded results.

## 5. Traceability

| Requirement group | Design/plan | Validation |
|---|---|---|
| FR-01, 05, 06, 08 | [design.md](design.md), [documentation-only.md](documentation-only.md) | Output-schema, uncertainty, error and citation tests |
| FR-02, 03, 04; NFR-07, 09 | [rag-only.md](rag-only.md), [security-data.md](security-data.md) | Retrieval/freshness/ACL/version fixtures |
| FR-07, 10-13; NFR-01-03, 10 | [tool-delegation.md](tool-delegation.md), [security-data.md](security-data.md) | Policy, sandbox, cancellation and mutation tests |
| FR-09, 14, 15; NFR-04-06 | [monitoring.md](monitoring.md), [benchmarks.md](benchmarks.md) | Pilot telemetry and matched ablations |
| NFR-08, 11-13 | [design.md](design.md), [roadmap.md](roadmap.md) | Latency, UI, compatibility and deletion tests |

## 6. Out of scope for first release

Inline autocomplete, arbitrary terminal access, production deployment, autonomous credentials, unrestricted web crawling, private-data training, self-directed agent recursion, and from-scratch foundation training.
