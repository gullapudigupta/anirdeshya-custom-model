# RAG-only strategy: no generator weight training

## 1. What RAG-only means

Use pretrained generation/embedding models and external knowledge retrieval without fine-tuning the generator. Creating embeddings is indexing, not generator training. RAG-only can include deterministic tools, query refinement, reranking, and sandbox validation; whether those tools are enabled depends on product mode.

RAG changes accessible knowledge and evidence. It does not automatically repair weak reasoning, tool compliance, or prompt-injection susceptibility.

## 2. Options

| Architecture | Best fit | Weakness |
|---|---|---|
| Lexical retrieval + existing model | Exact APIs, small known vocabularies | Paraphrase/concept recall |
| Vector retrieval + existing model | Conceptual docs and synonyms | Exact symbols, version filtering, near-duplicate confusion |
| Hybrid retrieval + metadata filters + reranker | Recommended default | More components to tune |
| Hierarchical/parent-child retrieval | Long guides where sections need context | Chunk expansion consumes tokens |
| Graph-assisted retrieval | Cross-file symbols/dependencies or linked docs | Graph correctness, indexing complexity |
| Bounded agentic retrieval | Unknown terminology and multi-hop requests | Cost, loops, correlated reasoning errors |
| Fully local RAG | Confidential/offline use | Local generator/embedding quality and hardware limits |
| Hosted RAG over approved docs | Public-doc MVP | Vendor/network dependency and provider review |

A documentation link graph is not a verified code call graph. Repository graph edges need compiler/LSP evidence and explicit unresolved dynamic boundaries.

## 3. Ingestion pipeline

1. Register source owner, URI, allowed versions, language/framework, collection, license/rights decision, ACL and refresh policy.
2. Fetch only authorized paths/domains; bound bytes, time, redirects and content types. Block internal-address fetches unless an explicit internal-source capability authorizes them.
3. Parse headings, tables, API signatures, code fences, prerequisites and navigation.
4. Remove navigation noise and duplicates without losing version qualifiers.
5. Chunk by semantic section/API/example; proposed starting range 300-800 tokens with 50-100 overlap when needed. Keep signature and related code together; evaluate rather than fixating on these values.
6. Attach source URI, section anchor, snapshot hash, version, fetch date, language, ACL, parent ID and rights metadata.
7. Redact prohibited data before embeddings, logging, or model transfer.
8. Build lexical/vector indexes and a versioned manifest; validate before atomic publication.
9. Maintain tombstones and deletion propagation to indexes/caches; define backup expiration.

For initial experiments use about 1,000-10,000 approved chunks; capacity tests can scale to the proposed 100,000-chunk profile. Corpus size is not a quality metric.

## 4. Query pipeline

- Authenticate before retrieval; enforce tenant and ACL restrictions before candidate passages become visible to reranker/generator.
- Apply exact framework/version filters. Do not silently substitute latest docs for an older target.
- Search lexical and vector indexes independently; combine ranked candidates, for example reciprocal-rank fusion.
- Starting experiment: 30 lexical + 30 vector candidates, rerank deduplicated set, send 5-10 passages within context budget. These are tunable defaults, not guaranteed optimums.
- Expand nearby parent sections only when prerequisite information is needed.
- Use bounded query rewriting without changing the requested framework/version.
- Create an evidence bundle with source IDs, passages, conflicts and missing information.
- Generate, validate schema/API references, and audit cited claims.
- Permit one or two bounded retrieval refinements if evidence is insufficient; otherwise clarify/abstain.

## 5. Freshness and contradictions

Keep index snapshots immutable. Tag source release/version separately from fetch time. A freshly downloaded obsolete guide is still obsolete.

Detect broken links, changed hashes, removed sections, and conflicting signatures. Index new snapshots only after validation. Answers must indicate the snapshot used. Retire/deauthorize sources explicitly; changing embeddings alone does not remove old cached answers.

## 6. Improve RAG before training

| Observed failure | First intervention |
|---|---|
| Relevant passage absent from corpus | Source coverage and ingestion |
| Passage present but not retrieved | Lexical boosts, embeddings, filters, query reformulation |
| Correct passage ranked low | Reranking and relevance-labelled dev set |
| Wrong framework version | Metadata correctness and strict filter tests |
| Passage truncated | Better boundaries and parent expansion |
| Correct context, wrong answer | Prompt/output design, stronger model, optional behavioral training |
| Correct answer, unsafe action | Authorization/sandbox/tool fix, not retrieval tuning |
| Slow answer | Cache, reduced candidates, cheaper reranker, context reduction |

## 7. Evaluation and limitations

Compare no retrieval, lexical-only, vector-only, hybrid, hybrid+reranker, and bounded multi-hop with equal generator/token budgets. Measure Recall@k, ranking, claim support, abstention, version correctness, latency, and cost.

Keep relevance labels separate from final-answer references. Freeze sources and indexes per run. Include ACL denial and adversarial documents. Do not let tuning access the final test set.

If generator behavior remains weak after correct evidence retrieval, RAG-only options include a stronger pretrained model, constrained templates, narrower tasks, and human review. It is valid to stay RAG-only indefinitely if success/cost/safety targets are met.

Sources and limits: [sources.md](sources.md). Operational plan: [monitoring.md](monitoring.md).
