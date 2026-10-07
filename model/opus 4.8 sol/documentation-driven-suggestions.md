# Coding Suggestions Grounded Purely on Documentation

How to make the agent produce code suggestions driven **only by
documentation** (no reliance on the model's parametric "memory"). This is the
core of a trustworthy, auditable, always‑up‑to‑date assistant.

## 1. Why documentation‑grounded
- **Freshness:** docs update faster than any model retrain.
- **Auditability:** every claim links to a source.
- **Lower hallucination:** answers are constrained to retrieved text.
- **Safety:** reduces invented APIs and wrong signatures.

## 2. Spectrum of options (least → most engineering)

### Option A — Prompted RAG (fastest)
Retrieve relevant doc chunks → inject into the prompt → instruct the model to
answer **only from provided context** and cite sources; refuse if unsupported.
- Pros: days to build, no training, easy to update.
- Cons: quality bounded by retrieval; prompt‑following not guaranteed.

### Option B — Hybrid retrieval + reranking
Dense embeddings + BM25 keyword + cross‑encoder reranker for precision.
- Pros: big precision gain for API/symbol lookups.
- Cons: extra latency + a reranker model to host.

### Option C — Structured/section‑aware doc indexing
Parse docs into structured units (function signature, params, returns,
examples, version) and retrieve at that granularity.
- Pros: exact API grounding, great for "how do I call X".
- Cons: needs per‑doc‑format parsers.

### Option D — Grammar / constrained decoding
Force outputs to conform to known API schemas (function names, arg types from
the docs) using constrained/guided decoding.
- Pros: cannot emit non‑existent symbols.
- Cons: requires a machine‑readable API spec; more engineering.

### Option E — Tool‑verified suggestions
After generating code, verify it against docs/specs or by running type‑check,
linter, compile, or doc‑derived tests. Reject/repair on failure.
- Pros: highest correctness; self‑healing loop.
- Cons: needs sandbox + tool integration (see
  [load-distribution.md](./load-distribution.md)).

### Option F — Doc‑conditioned fine‑tuning (optional)
Fine‑tune the model to *follow retrieved context faithfully* and to cite,
using synthetic (doc → Q → grounded answer) pairs. Pairs well with A–E.
- Pros: better instruction‑following + citation behavior.
- Cons: training effort; still keep RAG for freshness.

### Option G — Knowledge‑graph grounding
Build an API/knowledge graph (symbols, params, relationships, version
compatibility) and retrieve subgraphs for grounding.
- Pros: precise relationship/compatibility reasoning.
- Cons: significant build + maintenance.

**Recommended path:** A → B → C → E, add D where a machine‑readable spec
exists, and F only once volume justifies it.

## 3. Reference pipeline (doc‑only answer)
1. **Normalize docs:** convert HTML/MD/PDF/docstrings → clean text + metadata
   (source, version, URL, section, symbol).
2. **Chunk:** code‑aware for API refs; semantic/section for prose. Keep
   signatures intact; attach version.
3. **Embed + index:** store vectors + BM25 + metadata; one index per source.
4. **Retrieve:** hybrid search → rerank → top‑k with citations.
5. **Assemble:** pack cited chunks under a strict "answer only from context"
   system prompt with the version pinned.
6. **Generate:** constrained to context; must cite; must refuse if unsupported.
7. **Verify:** check cited symbols exist; optional compile/type‑check; repair.
8. **Return:** code + inline citations + confidence + "not in docs" flag.

## 4. Enforcing "only from docs"
- System prompt: *"Use ONLY the provided documentation. If the answer is not
  present, say so. Cite every claim as [source#section]."*
- **Citation verification:** post‑check that cited spans support the output;
  drop unsupported sentences.
- **Abstention:** explicit "not covered by documentation" response instead of
  guessing.
- **Version pinning:** retrieve and answer for the user's declared versions.

## 5. Handling hard cases
| Case | Handling |
|------|----------|
| Docs missing | Abstain + suggest where to look; never invent APIs |
| Conflicting docs | Prefer newest/most authoritative; surface the conflict |
| Outdated docs | Version‑pin; show "as of version X" |
| Partial coverage | Answer covered part, flag gaps |
| Ambiguous query | Ask a clarifying question |

## 6. Quality metrics for doc‑grounding
- **Citation precision/recall** vs. gold sources.
- **Groundedness / faithfulness** (claims supported by cited text).
- **Abstention correctness** (refuses when it should).
- **Answer correctness** on a doc‑QA eval set.
- See [benchmarks.md](./benchmarks.md) and [success-metrics.md](./success-metrics.md).

## 7. When RAG‑only is the whole strategy
If you choose to rely on retrieval without training, see
[rag-only-strategy.md](./rag-only-strategy.md) for the full plan, limits, and
mitigations.
