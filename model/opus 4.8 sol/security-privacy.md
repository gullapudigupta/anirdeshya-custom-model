# Security, Privacy & Safety

A coding agent reads source, executes code, and touches credentials — treat
it as a high‑privilege system.

## 1. Threat model
- **Prompt injection** via repo files, docs, web content, tool output.
- **Secret leakage** (model reads or emits credentials).
- **Unsafe code execution** (agent runs destructive/malicious commands).
- **Data exfiltration** across tenants or to third parties.
- **Supply‑chain** (malicious packages suggested/installed).
- **License contamination** in generated code.
- **Model/weight theft**; **training‑data poisoning**.

## 2. Execution sandboxing (non‑negotiable)
- Run all code/tests/shell in isolated, ephemeral sandboxes (containers/microVMs).
- Least privilege: no prod creds, scoped FS, egress controls.
- Resource + time limits; kill runaway processes.
- No network by default for untrusted exec; allowlist when needed.

## 3. Secret handling
- Scan inputs **and** outputs for secrets; redact before storage/logs.
- Never send secrets to external model APIs.
- Vault‑managed credentials for tools; short‑lived scoped tokens.
- Block commits/outputs containing detected secrets (guardrail).

## 4. Prompt‑injection defenses
- Treat retrieved docs, repo text, and tool output as **untrusted**.
- Separate instructions from data; mark provenance in context.
- Constrain tool permissions; require confirmation for destructive actions.
- Detect injection patterns; sanitize/escape where possible.
- Human approval gate for high‑impact actions (deploys, deletes, pushes).

## 5. Privacy & data residency
- **Opt‑in** before using user code/data for training (NFR6).
- Tenant isolation for data, indexes, and caches.
- Configurable data residency / on‑prem for sensitive customers.
- Retention limits; honor deletion/export requests.
- PII minimization + redaction in logs and traces.

## 6. Output safety & licensing
- License filter on generated code; flag near‑duplicates of restricted
  sources ([data-strategy.md](./data-strategy.md)).
- Vulnerability/anti‑pattern checks (static analysis) on generated code.
- Package/dependency allowlists; warn on risky/unmaintained packages.

## 7. AuthN/Z & audit
- SSO + RBAC; per‑tool and per‑MCP authorization.
- Immutable **audit log** of agent actions (edits, commands, approvals).
- Rate limiting + budgets to bound abuse and runaway cost.

## 8. Model/infra security
- Protect weights/adapters (access control, encryption at rest).
- Secure the model registry + CI/CD (signed artifacts).
- Isolate training data; guard against poisoning (provenance + filtering).

## 9. Responsible AI
- Red‑teaming + safety eval before release.
- Model cards + known limitations published.
- Clear escalation + incident response; postmortems feed
  [risks-and-open-questions.md](./risks-and-open-questions.md).

## 10. Compliance
- Map to applicable frameworks (SOC 2, ISO 27001, GDPR, sector rules).
- Document data flows; DPAs with any third‑party providers.
