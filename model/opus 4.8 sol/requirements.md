# Requirements

Status: Draft v1 · Owner: TBD · Last updated: 2026-10-07

## 1. Purpose & vision

Build a **brand‑new coding agent** that can read a codebase, understand
project documentation, and produce correct, reviewable code changes,
explanations, and suggestions — with first‑class support for grounding its
answers in **documentation** (internal + external).

### Goals
- Produce high‑quality code completions, edits, refactors, and explanations.
- Ground suggestions in authoritative documentation and the user's own repo.
- Operate as an **agent**: plan, call tools, run code/tests, and iterate.
- Be measurable, observable, and safe.

### Non‑goals (initial release)
- Beating frontier closed models on every public leaderboard.
- Full autonomy without human review on production changes.
- Training a trillion‑parameter base model from scratch on day one.

## 2. Personas
| Persona | Needs |
|---------|-------|
| Individual developer | Fast inline suggestions, repo‑aware chat, doc lookups |
| Team lead / reviewer | Consistent style, traceable sources, policy enforcement |
| Platform/DevOps | Self‑hostable, observable, cost‑controlled |
| Compliance/security | Data residency, license safety, audit logs |

## 3. Functional requirements (FR)
- **FR1 Completion:** Inline and block code completion with context.
- **FR2 Chat/agent:** Multi‑turn chat that can plan and execute tasks.
- **FR3 Repo awareness:** Index and retrieve from the user's codebase.
- **FR4 Documentation grounding:** Answer using cited documentation; refuse
  or hedge when docs don't support an answer. (See
  [documentation-driven-suggestions.md](./documentation-driven-suggestions.md).)
- **FR5 Tool use:** Run tests, linters, formatters, search, file edits via
  tools/MCP. (See [load-distribution.md](./load-distribution.md).)
- **FR6 Edit application:** Produce diffs/patches that apply cleanly.
- **FR7 Multi‑language:** Start with 3–5 languages, expand later.
- **FR8 Citations:** Every doc‑grounded answer links to its sources.
- **FR9 Guardrails:** Secret detection, license filtering, unsafe‑code checks.
- **FR10 Feedback:** Capture accept/reject, thumbs, and edit‑distance signals.

## 4. Non‑functional requirements (NFR)
| ID | Requirement | Target (initial) |
|----|-------------|------------------|
| NFR1 | Inline completion latency (p50) | < 300 ms |
| NFR2 | Chat first‑token latency (p50) | < 1.5 s |
| NFR3 | Task success rate (internal eval) | ≥ baseline open model +15% |
| NFR4 | Availability | 99.5% (self‑host), 99.9% (managed) |
| NFR5 | Cost per 1M tokens served | Tracked; budget in [cost-model.md](./cost-model.md) |
| NFR6 | Data privacy | No training on user code without opt‑in |
| NFR7 | Observability | Full tracing of every agent step |
| NFR8 | Hallucination rate (doc‑grounded) | < 5% unsupported claims |
| NFR9 | Reproducibility | Deterministic eval runs, versioned models |

## 5. Constraints & assumptions
- Prefer **open‑weight** base models to allow self‑hosting + fine‑tuning.
- Must run in both **cloud GPU** and **on‑prem** configurations.
- Documentation sources vary in license; must respect licensing.
- Team starts small; strategy must allow **incremental** investment.

## 6. Acceptance criteria (MVP)
1. Repo + docs can be indexed and queried with cited answers.
2. Agent can complete a scoped coding task end‑to‑end on the eval set.
3. Evaluation harness reports pass@k, task success, latency, cost.
4. Monitoring dashboard shows live traces and quality metrics.
5. Guardrails block secrets and disallowed licenses in output.

## 7. Open questions
Tracked in [risks-and-open-questions.md](./risks-and-open-questions.md).
