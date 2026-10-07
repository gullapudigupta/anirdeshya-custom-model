# TypeScript and JavaScript Code RAG Design

## 1. Objective

Provide framework-neutral indexing and retrieval for JavaScript/TypeScript repositories. The system parses code into source-aware chunks, indexes those chunks through configured embedding and storage providers, and returns ranked excerpts with reliable citations to downstream agents.

## 2. Design principles

- Keep repository access, parsing, chunking, embedding, storage, retrieval, and transport as separate layers.
- Preserve provenance from file discovery through the final context response.
- Make provider boundaries explicit; do not silently select remote services.
- Treat indexing as incremental and repeatable.
- Keep framework-specific behavior in adapters rather than the retrieval core.
- Surface partial failures and make index state truthful.

## 3. Proposed package architecture

- **`core`:** typed domain models, configuration, errors, provider contracts, query and index use cases.
- **`source-indexer`:** repository discovery, ignore processing, parsing, framework metadata extraction, chunking, and content hashing.
- **`providers`:** embedding, vector-store, lexical-search, and optional reranker adapters.
- **`server`:** HTTP routes and request validation; transport only delegates to core use cases.
- **`sdk`:** typed Node.js client for the HTTP API, with stable response and error types.
- **`cli` (optional for MVP):** local index, sync, query, status, and delete commands built on the same core interfaces.

Packages should be organized in a TypeScript workspace. The exact package manager and framework are implementation choices; avoid making the core depend on Angular, React, or a specific HTTP framework.

## 4. Data flow

### 4.1 Indexing

1. Validate the requested repository root and index configuration.
2. Walk files beneath the root, applying default exclusions, `.gitignore`, `.ragignore`, and caller patterns.
3. Compute normalized relative paths and content hashes.
4. Parse changed supported files and extract symbol/source metadata.
5. Associate Angular component metadata with inline or external templates when available. Keep JSX/TSX syntax in the owning source module.
6. Split extracted content into deterministic, bounded chunks with line ranges and symbol relationships.
7. Compare chunk hashes with stored index state; embed and upsert only changed chunks.
8. Remove stale chunks for changed, deleted, or newly excluded files.
9. Persist final status and return counts plus per-file diagnostics.

### 4.2 Query and context assembly

1. Validate the query, index ID, result count, filters, and context budget.
2. Generate a query embedding through the configured embedding provider.
3. Retrieve semantic candidates from the vector store and lexical candidates from the lexical provider.
4. Merge/deduplicate candidates using a documented ranking strategy; optionally rerank when configured.
5. Apply metadata filters, select source excerpts within the budget, and retain path/line provenance.
6. Return ranked results and an optional assembled context payload, including truncation and partial-failure metadata.

## 5. Parsing and chunk model

- Use the TypeScript compiler API for JavaScript/TypeScript syntax trees, including JSX/TSX.
- Use an Angular template parser adapter for Angular template files and component metadata. External template resolution must remain within the repository root.
- Extract modules, imports/exports, declarations, and meaningful symbol boundaries; preserve raw source text for retrieval.
- Represent a chunk with a stable ID, index ID, relative path, content hash, language, chunk kind, text, start/end lines, and optional symbol, parent, framework, and neighbor metadata.
- Derive stable chunk IDs from index ID, normalized path, content hash, and chunk boundary identity so synchronization can replace stale data safely.
- Fall back to bounded line-based chunks when parsing fails, if configured; mark these chunks as fallback and retain the parse diagnostic. If fallback is disabled, skip the file and report the failure.

## 6. Provider contracts

Define typed interfaces for:

- **Embedding provider:** embed document batches and query text; expose model/dimension metadata.
- **Vector store:** upsert, delete, search, and inspect index records; enforce index scoping.
- **Lexical search:** index and search chunk text and metadata.
- **Reranker (optional):** reorder a bounded candidate set and report provider failures.

Provider configuration is injected at runtime. Validate embedding dimensions and provider compatibility with an existing index before writes. Retry only classified transient errors, with bounded exponential backoff. Do not convert provider errors into empty successful responses.

## 7. Persistence model

Persist an index record containing its stable ID, repository identity, configuration fingerprint, provider/model identifiers, lifecycle status, and timestamps.

Persist chunk records with index ID, chunk ID, relative file path, file and chunk hashes, source range, language, chunk kind, searchable text/embedding, and metadata. Use index ID as a mandatory partition/filter for all reads and deletes. Store credentials outside these records.

## 8. API surface

Initial HTTP operations:

- `POST /v1/indexes` — create/register an index.
- `GET /v1/indexes/{indexId}` — inspect index state.
- `POST /v1/indexes/{indexId}/sync` — synchronize a repository.
- `DELETE /v1/indexes/{indexId}` — remove index data.
- `POST /v1/indexes/{indexId}/query` — retrieve ranked results and optional bounded context.

Use schema-validated JSON requests and responses. Return consistent errors with a machine-readable code, safe message, and optional diagnostic details. Long-running sync may initially be synchronous with progress callbacks; an asynchronous job model can be added if real repository sizes require it.

## 9. Security and privacy

- Canonicalize and validate repository paths; reject traversal and symlink escapes.
- Apply ignore rules before file reads where feasible, and never execute repository content.
- Exclude common secret files and dependency/build outputs by default; allow explicit opt-in only.
- Keep provider credentials in environment variables or a secret-management integration.
- Require an explicit provider configuration before source text or queries leave the local process.
- Scope every vector-store operation and API query to one index.
- Avoid logging raw source, embeddings, credentials, or full queries by default.
- If the HTTP server is reachable beyond loopback, require an authentication mechanism and document deployment protections.

## 10. Failure handling and observability

- Separate fatal index-level errors from file-level parse/read errors.
- Preserve completed per-file work but mark an index sync as partial when files or provider operations fail.
- Report counts for discovered, indexed, updated, unchanged, skipped, removed, and failed files.
- Include operation and index IDs in structured logs; redact source and credentials.
- Expose health and index status without exposing source content.

## 11. Testing strategy

- Unit-test ignore resolution, path safety, parser adapters, chunk boundaries, IDs, ranking merge, filters, and context budgets.
- Use fixture repositories covering plain JS, TypeScript, JSX/TSX, Angular inline/external templates, malformed files, and ignored files.
- Use fake providers for deterministic indexing, retries, partial failures, and dimension mismatch tests.
- Add provider contract tests and API/SDK integration tests.
- Benchmark retrieval separately from network provider latency; publish environment and data-set details for performance claims.

## 12. Risks and decisions to validate

- Angular template parsing may require framework-version alignment; keep it isolated and version-tested.
- Large workspaces can exceed synchronous sync limits; measure before introducing job queues.
- Embedding model changes may make existing vectors incompatible; index configuration must pin model identity and dimension.
- Confirm runtime baseline, default providers/storage, index persistence expectations, CLI requirements, and target repository scale with stakeholders.
