# Delivery roadmap and decision gates

This is a proposed plan. Time ranges assume a focused 2-4-person team and a narrow pilot. Source approvals, infrastructure, hiring and scope can extend them. A date estimate is not an acceptance gate.

## 1. Roles and dependencies

Required responsibilities:

- Product owner: task scope, UX, pilot consent and budget.
- Platform/tool owner: orchestration, model gateway, permissions, sandbox and deployment.
- Retrieval/data owner: rights, ingestion, indexing, freshness and deletion.
- Evaluation owner: independent tasks, hidden tests, audits and success measurement.
- Security reviewer/operator: threat model, release checks and incident readiness.

One person can hold several roles; avoid having the system author be the only judge of quality.

Dependency path:

```text
0 Decisions + evaluation baseline
       |
1 Docs-only RAG MVP
       |
2 Authorized repository awareness
       |
3 Preview + sandbox validation + approved application
       |
4 Capacity/cost optimization + optional specialists

Optional training branch:
Baseline + recurring behavior gap + rights-cleared data
       -> adapter experiment -> independent evaluation -> rollout or reject
```

Foundation training is a separate research program, not a prerequisite for any product phase.

## 2. Phase plan

| Phase | Estimated duration | Deliverables | Exit gate |
|---|---|---|---|
| 0. Product/permission baseline | 1-2 weeks | Decisions, task taxonomy, source registry, benchmark split, model shortlist, approved budget | Scope/data/model transfer rights approved; baseline harness works |
| 1. Documentation-only | 2-4 weeks | Versioned ingestion, hybrid search, evidence outputs, UI, explicit abstention, telemetry | Documentation quality/safety/latency gates pass |
| 2. Repository read-only | 2-3 weeks | Manifest/LSP/search adapters, provenance, unresolved boundaries | Analysis fixtures and access/cancellation/redaction gates pass |
| 3. Controlled coding | 3-5 weeks | Patch previews, isolated validations, approval/hash checks, receipts | Agent resolution, no-regression and mutation/egress gates pass |
| 4. Optimization | 2-4 weeks, then ongoing | Caching/routing/load tests; specialist experiments if warranted | Cost/capacity gain at maintained quality and safety |
| Optional adapter experiment | 1-3 weeks after data readiness | Licensed dataset, trained adapter, comparison report, rollback | Significant useful behavior gain with no safety/general regression |

A documentation pilot can start before the full coding agent exists. Phases 0-1 suggest roughly 3-6 weeks under these assumptions; a controlled agent may take substantially longer.

## 3. Decisions needed before code

| Decision | Proposed starting answer | Required approver/evidence |
|---|---|---|
| Languages/frameworks | TypeScript/Node first; Angular second | Product owner and task samples |
| Product mode | Docs-only first | Permission/UX agreement |
| Documentation collections | Official supported-version docs + owned guides | Data steward and rights |
| Private-data boundary | Local/private by default unless transfer approved | Organization/security policy |
| Model candidates | At least two viable pretrained models | Availability, licensing and benchmark |
| Deployment | Hosted public-doc or local private pilot | Privacy/latency/cost comparison |
| Budget | Set monthly serving, experiment and hardware caps | Owner approval; not assumed here |
| Execution/egress | None in MVP; allowlisted isolated validation later | Security review and capabilities |
| Success criteria | Requirements gates plus productivity pilot | Baseline and sample/power plan |

These are recommendations, not silently settled business decisions.

## 4. First implementation backlog

1. Versioned request/result/evidence schemas and mode policy.
2. Source registry with version, rights and ACL fields.
3. Ingestion parser/chunker and immutable snapshot manifest.
4. Lexical retrieval baseline and labelled relevance set.
5. Embeddings/hybrid fusion and strict metadata filtering.
6. Generator adapter and source-linked output validation.
7. Clarification/abstention and structured failure behavior.
8. Token/time/cost/cancellation budgets end-to-end.
9. Telemetry with content-minimizing defaults.
10. CLI/IDE or web UI showing evidence, validation state and feedback.
11. Held-out evaluation and CI release gates.
12. Consented documentation-only pilot and outcome measurement.

Implement functional vertical slices rather than unrelated isolated services. Do not install a distributed agent fleet before the single-agent/tool baseline works.

## 5. Existing repository integration

The current documentation describes a native TypeScript classifier and read-only code analysis. The supplied task snapshot records completed work and pending hardening/framework/CI work. It is a planning artifact, not an executable verification report.

Options:

- **Fresh implementation:** reuse only concepts, leaving the classifier untouched. Cleanest independence.
- **Adapter reuse:** connect existing public read-only APIs behind new contracts after focused validation.
- **Selective extraction:** move proven common utilities later, with compatibility tests; not part of this documentation task.

Before reuse, verify source reality, exports, supported patterns, malformed inputs, secret handling, limits/cancellation and deterministic fixtures. Preserve existing behavior and public APIs. Do not implement pending attachment tasks merely because they exist.

## 6. Release, rollback, and ongoing maintenance

- CI pins model/prompt/tool/index configurations and evaluates each material change.
- Ship staged cohorts with clear feature/mode flags.
- Retain compatible known-good configurations and index snapshots.
- Roll back on confirmed safety violations or unacceptable regression.
- Review new framework versions, model updates, source rights and capacity regularly.
- Expand languages, autonomy or multi-agent fan-out only after new task/safety gates exist.

## 7. Risks and stop conditions

| Risk | Early signal | Response |
|---|---|---|
| Retrieval coverage weak | Many legitimate queries have no source | Narrow supported docs; fix ingestion before training |
| Local model too weak/slow | Quality or p95 misses at pilot profile | Better model/runtime/hardware or clearly narrower tier |
| Permissions unsafe | Any escaped access/write | Block rollout and fix policy/isolation |
| Agent cost explodes | Repairs/fan-out dominate cost | Reduce loops; deterministic tools; narrower tasks |
| Training fails to help | No held-out gain or regression | Reject adapter and preserve RAG baseline |
| Documentation-only overclaims | Claims of repo/test success | Enforce output modes and receipts |
| Scope exceeds team | Many languages/production actions requested | Stage features; do not weaken gates |

Companion specification: [requirements.md](requirements.md). Strategy: [strategy.md](strategy.md).
