# Coding suggestions purely from documentation

## 1. Define "purely"

Two meanings must be separated:

- **Documentation-grounded:** an existing pretrained model generates suggestions from retrieved docs. Its weights still contain prior learned knowledge; unsupported claims must be rejected or marked uncertain.
- **Strict documentation-derived:** outputs are limited to approved examples/templates and supported transformations. This offers a tighter source boundary but much less generality.

A prompt alone cannot prove that every generated token originates only from documentation. If that is a contractual requirement, use a constrained extractive/template system, an allowed API vocabulary, and deterministic validators rather than unrestricted generation.

Documentation-only mode has no repository reads, terminal execution, or live edits. It cannot claim integration correctness. User-provided dependency/version information can be used as declared context, but does not become inspected repository evidence.

## 2. Implementation options

| Option | Mechanism | Pros | Cons |
|---|---|---|---|
| A. Search and extract | Exact/lexical search returns approved doc examples | Cheapest, faithful, no generator | Poor novel composition |
| B. Versioned recipes | Curated templates with validated parameters | Predictable, fast, easier testing | Coverage and maintenance burden |
| C. Single-pass RAG | Retrieve docs and generate one cited answer | Simple, flexible MVP | Retrieval miss can cause unsupported synthesis |
| D. Hybrid RAG + checking | Lexical/vector retrieval, reranking, API/version checks | Recommended general-purpose balance | More engineering and some latency |
| E. Multi-step docs agent | Bounded query refinement and cross-doc lookup | Handles multipart questions | More tokens, latency and injection exposure |
| F. Long-context docs | Put a small complete manual into context | Simple for tiny stable corpora | Cost, attention limits, stale content; not scalable retrieval replacement |

Start with B for high-volume recipes and D for general questions. Enable E only when it outperforms D on a fixed hard set. F is a baseline/limited specialization, not the default for all documentation.

## 3. Recommended answer flow

1. Determine language, framework, desired version, and objective.
2. If version is missing and materially affects the answer, clarify. If giving a generic example, label the chosen version and assumptions.
3. Retrieve official version-matching API reference, relevant guide, example prerequisites, and migration notes if needed.
4. Check whether evidence supports every proposed API and constraint.
5. Produce a minimal example plus installation assumptions, sources, and limitations.
6. Validate output format and API names against a versioned approved catalog where available.
7. On insufficient evidence, say what information/source is missing.

Semantic checkers can assist claim audits but are not authoritative truth or permission engines.

## 4. Example response contract

```json
{
  "mode": "documentation-only",
  "status": "completed",
  "target": {"language": "TypeScript", "framework": "approved-framework", "version": "specified-version"},
  "answer": "Explanation with evidence-linked claims.",
  "example": "Illustrative snippet.",
  "evidenceIds": ["doc-api-17", "doc-guide-09"],
  "assumptions": ["Dependencies and project settings have not been inspected."],
  "validation": {"state": "illustrative", "executed": false},
  "limitations": ["Repository compatibility and test success are not established."]
}
```

The placeholders are schema illustrations, not real framework facts. Actual source records must resolve to the correct document snapshot and section.

## 5. Permitted and impermissible claims

| Permitted with supporting docs | Not justified by docs alone |
|---|---|
| "This version documents this API and its argument." | "Your project already imports this API." |
| "This example follows the documented lifecycle." | "This compiles in your repository." |
| "This migration guide removes this older method." | "All callers in your app have been migrated." |
| "Try this illustrative implementation." | "The issue is fixed and tests passed." |

If isolated example validation is later offered, make it a separately approved mode. Record exact package versions/environment and say it was validated **only in that sandbox**, not in the user's repository.

## 6. Quality and uncertainty

- Track source coverage and version-specific API accuracy separately from citation validity.
- Test hallucinated APIs, older-version docs, ambiguous frameworks, conflicting sources, and no-answer questions.
- Do not abstain on everything to inflate supported-claim metrics: include answer coverage and verified usefulness.
- Use exact passage/section references; an official homepage link is not adequate support for a specific API.
- Avoid reproducing large third-party passages; prefer authorized concise references and original explanations.
- If docs do not describe security, concurrency, failure handling, or compatibility, do not invent assurances.

RAG design: [rag-only.md](rag-only.md). Measurements: [benchmarks.md](benchmarks.md). Source rights: [security-data.md](security-data.md).
