# TypeScript and JavaScript Code RAG Requirements

## 1. Purpose

Build a reusable retrieval-augmented generation (RAG) system that indexes software repositories and returns relevant, source-grounded code context to AI agents and developer tools. The initial language ecosystem is JavaScript and TypeScript, including Node.js, Angular, and React projects.

The system retrieves and cites existing code. It does not generate code, execute indexed code, or replace the consuming model.

## 2. Users

- **Developer:** connects a local repository, configures an index, and queries it.
- **Agent/tool integrator:** uses a TypeScript SDK or HTTP API to retrieve context.
- **Operator:** configures storage and embedding providers, monitors indexing, and removes indexes.

## 3. Scope

### In scope

- Index local JavaScript and TypeScript repositories, including `.js`, `.jsx`, `.mjs`, `.cjs`, `.ts`, `.tsx`, and declaration files.
- Extract useful code structure such as modules, exports, classes, functions, methods, imports, and source locations.
- Include React JSX/TSX and Angular component/template context when their framework metadata is available.
- Respect repository ignore rules and configurable exclusions.
- Create, update, and delete indexed content, including incremental synchronization after file changes.
- Support configurable embedding and vector-store providers through stable interfaces.
- Retrieve code using semantic and lexical signals, with optional metadata filters and reranking.
- Return concise context snippets with repository-relative file paths, line ranges, and stable source identifiers.
- Provide a Node.js/TypeScript API and an HTTP API suitable for agent integrations.

### Out of scope for the first release

- Executing, compiling, or testing indexed source code.
- General-purpose document RAG beyond code and closely related project metadata.
- Automatic code changes, commits, or model completion.
- Guaranteed language support outside the JavaScript/TypeScript ecosystem.
- A hosted multi-tenant service or web user interface.

## 4. Functional requirements

### FR-1: Repository registration

- A user can create an index for a local repository and identify it with a stable index ID.
- The system records the repository root and index configuration without requiring a copy of the repository.
- The system rejects missing, unreadable, or invalid repository roots with an actionable error.

### FR-2: Safe file discovery

- Discovery respects `.gitignore` and a project-specific `.ragignore` file, plus configured include/exclude patterns.
- Dependency, build, generated, binary, and common secret/configuration files are excluded by default.
- File traversal must not escape the configured repository root through symlinks or path traversal.
- Exclusions and detected unsupported files are observable in index summaries.

### FR-3: Source parsing and framework context

- The indexer supports JavaScript and TypeScript modules and extracts symbols, imports, exports, and source ranges.
- JSX/TSX structures are parsed as part of their source files.
- Angular component metadata can associate a component class with inline or external templates and styles; supported template references include component selectors, bindings, and source locations where available.
- Parse failures in one file do not abort the repository index. They are reported with file and diagnostic details.

### FR-4: Code chunking and metadata

- Chunks preserve meaningful code boundaries where possible and remain within configured token limits.
- Oversized symbols are split deterministically while preserving their source ranges.
- Each chunk includes index ID, normalized relative path, language, chunk kind, line range, content hash, and available symbol/framework metadata.
- Related chunks can identify their parent symbol and neighboring source context.

### FR-5: Indexing and synchronization

- The system creates embeddings and persists chunks through configured provider interfaces.
- Repeated synchronization avoids re-embedding unchanged content.
- Changed files replace their stale chunks; removed or excluded files are removed from the index.
- Indexing reports progress and final counts for discovered, indexed, unchanged, skipped, and failed files.
- A failed provider operation is surfaced as a failure; it must not be reported as a successful complete index.

### FR-6: Retrieval

- A query can combine semantic retrieval with lexical matching and rank the combined candidates.
- Callers can limit result count and apply supported metadata filters such as path, language, and symbol kind.
- Results include relevance information and source citations with path and line range.
- Optional reranking can be configured without making it mandatory for the base retrieval path.
- Empty results and partial provider failures are represented explicitly.

### FR-7: Context assembly

- Callers can request a bounded context payload for downstream model use.
- Context includes source excerpts and citations; it does not silently omit provenance.
- The assembler avoids duplicate chunks and supports configurable ordering and token budgets.
- Truncation is explicit and preserves the citation for each included excerpt.

### FR-8: Integration interfaces

- The TypeScript SDK exposes typed operations for index creation, synchronization, deletion, and querying.
- The HTTP API exposes equivalent operations and returns structured errors.
- The core retrieval and indexing logic is usable without coupling callers to a particular web framework.
- API and SDK behavior are documented with runnable examples.

### FR-9: Index lifecycle and observability

- Users can inspect index configuration, state, timestamps, and item counts.
- Users can delete an index and its associated stored vectors and metadata.
- Logs and operation summaries include request/index correlation IDs but do not log full source contents or secrets by default.

## 5. Non-functional requirements

- **Correctness:** all returned citations resolve to the indexed repository revision and valid line ranges.
- **Incrementality:** unchanged files are not re-embedded during a no-change synchronization.
- **Performance target:** for an index of up to 50,000 chunks, local candidate retrieval and ranking should complete within 1.5 seconds at p95, excluding embedding-provider and optional reranker latency, on the documented reference environment.
- **Resilience:** transient provider errors can be retried using bounded retries and backoff; permanent errors remain visible to callers.
- **Security:** source text is sent only to explicitly configured embedding/reranking providers. Credentials are read from runtime configuration and never stored with indexed source metadata.
- **Privacy:** repository contents and query text are not written to logs by default.
- **Maintainability:** provider integrations and framework-specific parsing are isolated behind typed interfaces.
- **Compatibility:** provide a documented Node.js runtime baseline and package-version support policy before release.

## 6. Acceptance criteria

1. A sample Node.js JavaScript repository and a TypeScript repository can both be indexed, queried, and cited by relative path and line range.
2. A React TSX component and an Angular component with an external template are discoverable with their component/template relationship represented in metadata or returned context.
3. A second synchronization with no source changes performs no new embeddings; modifying and deleting a file updates/removes its chunks.
4. `.gitignore`, `.ragignore`, and configured exclusions prevent excluded files from being indexed.
5. A query combines semantic and lexical candidates and returns bounded, deduplicated context with citations.
6. Tests verify that invalid paths cannot cause reads outside the configured repository root.
7. Embedding and storage failures are returned as explicit errors and are reflected in index status and summaries.
8. A consumer can perform the core workflow using both the typed SDK and HTTP API.
9. Automated tests cover supported extensions, parser failures, incremental updates, retrieval filters, citations, and provider error handling.

## 7. Assumptions and open decisions

- The initial deliverable is a library/service that can be run locally, not a hosted SaaS product.
- Consumers provide/configure embedding and vector-store implementations; provider selection is not fixed by this specification.
- Query generation and final answer generation remain the responsibility of the consuming agent/model.
- Confirm the Node.js baseline, default vector store, supported embedding providers, expected repository size, and whether a CLI is required before implementation is finalized.
