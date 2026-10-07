# Security, privacy, and data governance

This is a design threat model and policy proposal, not an audit or certification of the current repository.

## 1. Threat model

Assets: private source, user requests, documents, embeddings, credentials, indexes, patches, validation workers, telemetry, training data and model checkpoints.

Attack surfaces: malicious docs/code comments/issues, tool responses/descriptions, redirected URLs, package scripts, generated patches, workspace paths, cached results, shared logs, MCP connections and model-provider requests.

Core assumption: an adversarial document can influence a model despite grounding or fine-tuning. Reduce impact through external authorization, isolation, validation and minimal access; do not promise complete prompt-injection prevention.

## 2. Required controls

| Risk | Control | Test |
|---|---|---|
| Prompt injection in docs/code/tools | Treat content as untrusted data; policy outside model; constrained capabilities | Docs that request secrets/commands cannot change permissions |
| Cross-tenant data leakage | Identity/ACL filters before retrieval, partitioned caches/artifacts, scoped credentials | Tenant A cannot retrieve Tenant B fixtures or cache entries |
| Exfiltration | Approved destinations, scoped tokens, denied-by-default egress and transfer review | Malicious URLs and tool output cannot trigger outbound private-data transfer |
| Secret exposure | Pre-transfer and telemetry redaction/blocking; no secrets in model context | Seeded secret corpus never appears in outputs/logs |
| Path escape | Canonical root validation including symlinks/junctions and archive extraction | Parent paths, links and crafted archives rejected |
| Unsafe execution | Disposable unprivileged workers, resource limits, no host credentials | Tests/package hooks cannot access host or production resources |
| Unauthorized edits | Mode policy, exact patch/baseline approval, path allowlist | Denial/stale baseline yields zero live writes |
| Dependency compromise | Pinned provenance, license review, vulnerability process | Unknown tool/package rejected until approved |
| Tool spoofing | Trusted registry, contract validation, authenticated remote endpoints | Description text cannot self-declare trusted permissions |
| Model/provider misuse | Reviewed endpoint, residency/retention settings and explicit transfer consent | Sensitive requests never routed to unapproved endpoint |
| Log/artifact leakage | Redaction, access control, limited retention, audit trails | Fixture secrets absent from operational artifacts |

Secret detectors are imperfect. Reduce data exposure and rights independently; never treat a regex scanner as a complete safety guarantee.

## 3. Data classification and outbound policy

| Class | Examples | Default handling |
|---|---|---|
| Approved public | Licensed public docs, public examples | Approved external models allowed after provider review |
| Internal non-sensitive | Owned engineering guides | Local/private processing unless transfer approved |
| Confidential | Proprietary code, internal issues, customer details | Explicit private boundary; no automatic external escalation |
| Restricted/secrets | Keys, tokens, personal/regulated records | Exclude/redact from generation and training; dedicated authorized handling only |

User consent does not override organization policy, license restrictions or applicable law. Keep credentials in a secure broker, not model prompts. A model may request an action; the broker determines whether a scoped capability exists.

## 4. Source and training rights

For each source, record collection permission, storage/indexing permission, quoting/redistribution permission, training permission, attribution requirements, owner and deletion process.

Public accessibility does not imply permission to train or redistribute. API documentation and source-code licenses may differ. Respect contractual terms and approved crawling policy; do not bypass access controls.

Default policy:

- No user-code training without explicit rights, informed consent and organizational approval.
- No arbitrary scraped code corpus.
- Synthetic examples retain lineage and rights constraints of their source inputs.
- Preserve attribution and avoid large verbatim reproductions of third-party material.
- Review generated code licensing/provenance risk where material; citations are not legal clearance.

## 5. Dataset governance

Maintain a dataset registry/card:

- Version/digest, owner, purpose, sources and licenses.
- Languages/frameworks, task distribution and known gaps.
- Deduplication, secret/PII checks, split logic and holdout lineage.
- Human/synthetic labels, verification receipts and reviewer agreement.
- Consent, retention, access, residency and deletion constraints.
- Known benchmark contamination risk and limitations.

Unlearning/removing memorized training information is not as simple as deleting a source row. Avoid unnecessary sensitive training, preserve lineage, and document whether deletion requires dataset rebuild, retraining or checkpoint retirement.

Embeddings and summaries may still reveal sensitive information. Apply the same access/deletion principles to derived artifacts.

## 6. Evaluation and release gates

Test direct and indirect injection, crafted tool results, malicious code comments, conflicting authority, poisoned docs, untrusted links, denied operations, stale approvals, tenant boundaries and cancellation.

Release criteria: zero observed violations in the defined suite, not a claim of universal immunity. Record suite coverage, seeds, limitations, false positives and false negatives. A confirmed production incident blocks the affected capability until containment and remediation.

## 7. Incident and deletion plan

Assign an owner for triage, containment, credential rotation, notification, evidence preservation and recovery. Use sanitized audit metadata; do not spread leaked values across tickets.

Deletion must cover document stores, vector/lexical indexes, answer caches, artifacts, debug content, training datasets and backups according to approved schedules. Keep only required minimal tombstone/audit metadata. Record deletion receipts and verification.

See [monitoring.md](monitoring.md) for runbooks and [sources.md](sources.md) for OWASP/MCP references.
