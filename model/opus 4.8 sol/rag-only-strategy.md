# RAG‑Only Strategy

What to do if we choose to rely on **retrieval‑augmented generation only** —
no (or minimal) model training. A strong, legitimate strategy: fastest to
value, cheapest to run, easiest to keep current.

## 1. Why RAG‑only can be the whole plan
- **No training cost / team** — ship with a good open model + retrieval.
- **Always current** — update by re‑indexing docs, not retraining.
- **Auditable & grounded** — answers cite sources (see
  [documentation-driven-suggestions.md](./documentation-driven-suggestions.md)).
- **Lower risk** — no training‑data licensing/contamination exposure.
- **Swappable base** — upgrade the base model independently.

## 2. Reference RAG‑only architecture
```
Query → Query understanding (rewrite/expand/route)
      → Hybrid retrieval (dense + BM25) over per‑source indexes
      → Rerank (cross‑encoder)
      → Context assembly (token‑budgeted, cited, version‑pinned)
      → Generation (constrained to context, must cite / may abstain)
      → Verify (citations exist; optional compile/type‑check)
      → Answer + citations (+ "not in docs" flag)
```

## 3. Make RAG‑only actually good (the hard part is retrieval)
- **Hybrid search:** dense embeddings **+** keyword BM25 (keyword matters for
  exact symbol/API names).
- **Reranking:** cross‑encoder reranker on top‑N → precision jump.
- **Query transformation:** rewrite, expand, decompose multi‑part questions;
  **HyDE** (hypothetical doc embedding) for vague queries.
- **Source‑aware chunking:** code‑aware splits (keep signatures/functions
  whole) vs. section splits for prose; attach rich metadata (version, symbol,
  URL).
- **Multiple indexes + routing:** external docs, internal docs, repo code,
  API specs, past solved tasks — route the query to the right one(s).
- **Agentic / iterative retrieval:** let the agent issue follow‑up searches
  when the first retrieval is insufficient (retrieve → read → retrieve again).
- **Metadata filtering:** version, language, product area to cut noise.
- **Caching:** prompt + semantic cache for repeated queries.

## 4. Advanced RAG patterns
| Pattern | Benefit |
|---------|---------|
| GraphRAG / knowledge graph | relationship & compatibility reasoning |
| Contextual retrieval (prepend doc context to chunks) | fewer lost‑context misses |
| Parent‑document / small‑to‑big | retrieve precise, expand for context |
| Self‑RAG / corrective RAG (self‑check, re‑retrieve) | fewer unsupported answers |
| Multi‑vector / ColBERT‑style late interaction | stronger precision |
| Tool‑verified RAG (run tests/type‑check) | correctness guarantee |

## 5. Limits of RAG‑only (be honest)
- **Reasoning/behavior** not fixed by retrieval (planning, tool use, style,
  instruction‑following depend on the base model).
- **Latency** of retrieval + rerank + larger prompts.
- **Context‑window** pressure and "lost in the middle" with big contexts.
- **Retrieval failures** cap the ceiling — if retrieval misses, the answer is
  wrong regardless of the model.
- **Doc quality dependency** — garbage docs → garbage answers.
- **Format/citation discipline** harder to enforce without a little tuning.

## 6. Mitigations (still RAG‑only)
- Invest in **retrieval eval** (recall@k, nDCG, reranker precision — see
  [benchmarks.md](./benchmarks.md)); retrieval quality is the ceiling.
- Strong **abstention** + **citation verification** to stay grounded.
- **Agentic retrieval** and self‑correction loops.
- **Prompt optimization** (few‑shot exemplars) for format/citation discipline.
- Curate and continuously improve the **doc corpus**
  ([data-strategy.md](./data-strategy.md)).

## 7. When to add a *little* training (hybrid, recommended)
Keep RAG for knowledge, add **one LoRA adapter** (Rung 3 in
[training-strategy.md](./training-strategy.md)) only to fix *behavior*:
faithful context‑following, citation format, tool‑use patterns, refusal
discipline. This "RAG + thin adapter" combo usually beats either alone while
staying cheap. Knowledge stays in the index; behavior lives in the adapter.

## 8. Operational notes
- **Re‑index pipeline** triggered on doc changes; track doc versions.
- **Monitor** retrieval metrics + groundedness + abstention rate
  ([monitoring-strategy.md](./monitoring-strategy.md)).
- **Hardware** is modest: serving GPU + vector DB + small reranker
  ([hardware-requirements.md](./hardware-requirements.md)).

## 9. Verdict
RAG‑only is the right **starting** strategy and may be the right **permanent**
strategy for documentation‑grounded assistance. Add training only where the
eval harness shows retrieval can't close the gap.
