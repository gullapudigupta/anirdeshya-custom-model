# Codebase Analysis Pipeline After Classification

## Purpose

The native classifier can identify that a user wants to search or analyze code. It does not itself understand repository structure, resolve symbols, trace calls, rank files, or explain how a feature works.

For requests such as:

> Analyze this codebase.

or:

> Find how save functionality works in this project.

classification is the first stage of a read-only analysis pipeline. The next stages must convert the classified request into typed search actions, gather repository evidence, trace relevant control and data flow, resolve missing links, and produce an explanation grounded in real files and symbols.

## End-to-end flow

```text
User request
  -> native classification
  -> analysis-request specification
  -> repository inventory
  -> search-query generation
  -> lexical and symbol search
  -> relevance ranking
  -> focused file reading
  -> call/data-flow tracing
  -> evidence graph
  -> gap detection and iterative search
  -> grounded explanation
```

Analysis should remain read-only unless the user separately requests a modification.

## 1. How the current classifier handles these requests

### Example A: Analyze the codebase

The word `analyze` matches the current `analyze` rule. The classifier produces a packet similar to:

```json
{
  "intent": "analyze",
  "entities": [],
  "confidence": 0.9,
  "requiredTools": ["search_code", "read_file", "respond"],
  "nextAction": "search_code"
}
```

### Example B: Find how save functionality works

The word `find` matches `search_code`. If the request says `explain how save works` or `how does save work`, it may instead match `explain`.

A likely packet is:

```json
{
  "intent": "search_code",
  "entities": [],
  "confidence": 0.86,
  "requiredTools": ["search_code", "read_file"],
  "nextAction": "search_code"
}
```

## Current limitations

The existing classifier does not yet:

- extract `save` as a feature or symbol entity
- distinguish broad architecture analysis from feature-flow analysis
- generate repository-specific search queries
- inspect project structure
- find definitions and references
- rank search results
- trace calls across frontend, API, service, and persistence layers
- retain an evidence graph
- iterate when the first search is incomplete
- generate a final explanation with file and symbol references

These capabilities belong in a codebase-analysis subsystem after classification.

## 2. Create an analysis request specification

Convert the classification packet into a more precise, validated request.

```typescript
type AnalysisMode =
  | "architecture"
  | "feature_flow"
  | "symbol_usage"
  | "data_flow"
  | "dependency"
  | "error_path";

type AnalysisRequest = {
  requestId: string;
  mode: AnalysisMode;
  question: string;
  targetTerms: string[];
  targetSymbols: string[];
  scope: {
    repository: string;
    directories: string[];
    excludePatterns: string[];
  };
  constraints: string[];
  output: {
    includeFileReferences: boolean;
    includeCallFlow: boolean;
    includeUncertainty: boolean;
  };
};
```

For the save example:

```json
{
  "requestId": "generated-uuid",
  "mode": "feature_flow",
  "question": "How does save functionality work in this project?",
  "targetTerms": ["save", "submit", "persist", "update", "create"],
  "targetSymbols": [],
  "scope": {
    "repository": "current",
    "directories": [],
    "excludePatterns": ["node_modules", "dist", "coverage", ".git"]
  },
  "constraints": ["read_only"],
  "output": {
    "includeFileReferences": true,
    "includeCallFlow": true,
    "includeUncertainty": true
  }
}
```

The specification should ask for clarification when the repository, feature, or scope is ambiguous and cannot be inferred safely.

## 3. Improve entity extraction for analysis

Feature-analysis requests need typed entities rather than only a small fixed keyword list.

```typescript
type AnalysisEntity = {
  type:
    | "feature"
    | "symbol"
    | "file"
    | "directory"
    | "framework"
    | "endpoint"
    | "event"
    | "database_entity";
  value: string;
  normalizedValue: string;
  confidence: number;
};
```

For:

> Find how save functionality works.

extract:

```json
[
  {
    "type": "feature",
    "value": "save functionality",
    "normalizedValue": "save",
    "confidence": 0.9
  }
]
```

Use phrase patterns such as:

- `how <feature> works`
- `where <feature> is implemented`
- `trace <feature>`
- `show the flow for <feature>`
- `what happens when <event>`
- `who calls <symbol>`

Preserve exact quoted symbols and code-formatted text with higher confidence.

## 4. Inventory the repository

Before feature-specific searching, identify the project shape.

Collect:

- top-level directories
- package and workspace manifests
- languages and frameworks
- source roots
- frontend and backend boundaries
- generated and ignored directories
- test locations
- database or persistence technologies
- API definitions
- build configuration
- path aliases

Example output:

```typescript
type RepositoryInventory = {
  root: string;
  languages: string[];
  frameworks: Array<{ name: string; version?: string }>;
  sourceRoots: string[];
  testRoots: string[];
  ignoredPaths: string[];
  layers: Array<{
    name: "frontend" | "api" | "service" | "persistence" | "shared";
    directories: string[];
  }>;
};
```

This inventory guides searches and prevents scanning dependency or build-output folders unnecessarily.

## 5. Generate search queries

Create several query families from the target feature. Searching only for the exact word `save` is insufficient.

### Direct terms

```text
save
saveChanges
onSave
handleSave
saveItem
saveTodo
```

### Related actions

```text
submit
persist
create
update
upsert
commit
write
store
```

### User-interface triggers

```text
(click)="save"
submit event
Save button
form submit
onSubmit
```

### API and backend patterns

```text
POST
PUT
PATCH
/create
/update
/save
controller
handler
repository.save
```

### Persistence patterns

```text
localStorage.setItem
writeFile
INSERT
UPDATE
database transaction
ORM save
```

Query generation should consider detected frameworks. Angular searches may include template events and services; Node.js searches may include route handlers, controllers, services, repositories, and database clients.

## 6. Use multiple search strategies

A useful analysis system combines several search methods.

### Text search

Use exact and regular-expression search for:

- feature terms
- UI labels
- route paths
- event names
- API verbs
- persistence calls

### File search

Search names such as:

```text
*save*
*editor*
*form*
*service*
*repository*
*controller*
```

### Symbol search

Use language-server or AST indexes to find:

- symbol definitions
- references
- implementations
- overrides
- imports and exports
- call sites

### Semantic search

When available, use semantic retrieval for concepts expressed without matching keywords. Semantic results must still be verified by reading actual code.

### Configuration search

Inspect routes, dependency injection, module registration, ORM configuration, and path aliases that connect implementations indirectly.

## 7. Define tool-specific search contracts

```typescript
type SearchCodeInput = {
  queries: string[];
  includePatterns: string[];
  excludePatterns: string[];
  maxResults: number;
};

type FindSymbolInput = {
  symbol: string;
  kinds?: Array<"function" | "method" | "class" | "variable" | "property">;
};

type FindReferencesInput = {
  filePath: string;
  symbol: string;
  includeDefinition: boolean;
};

type ReadFileInput = {
  filePath: string;
  startLine: number;
  endLine: number;
};
```

Validate paths, result limits, file types, and workspace boundaries before execution.

## 8. Rank search results

Search results require deterministic relevance scoring before files are read.

```typescript
type SearchCandidate = {
  filePath: string;
  symbol?: string;
  line?: number;
  snippet: string;
  score: number;
  reasons: string[];
};
```

Suggested scoring signals:

- exact symbol match
- exact phrase match
- definition rather than incidental reference
- executable source rather than documentation or generated output
- proximity to a UI trigger or route
- framework-conventional file location
- import or call connection to another strong candidate
- recent diagnostic or open-file context
- file type appropriate to the feature

Suggested penalties:

- generated code
- dependencies
- fixtures unrelated to the requested flow
- comments containing the term without executable usage
- duplicate re-exports

Do not select files only because their names contain `save`.

## 9. Read focused code regions

Read the highest-ranked definition and enough nearby context to understand:

- containing class or module
- inputs and outputs
- dependencies
- called functions
- error handling
- state mutations
- side effects
- asynchronous behavior

Avoid reading entire large files when the relevant symbol and its dependencies can be read in focused regions.

Each read should answer a specific question. For example:

- What invokes `onSave`?
- What data does it construct?
- Which service method receives the data?
- Which endpoint does that service call?
- Which backend handler receives the endpoint?
- Where is the final persistence operation?

## 10. Build an evidence graph

Store discovered code relationships explicitly.

```typescript
type EvidenceNode = {
  id: string;
  kind: "file" | "symbol" | "route" | "event" | "database" | "external_api";
  label: string;
  filePath?: string;
  line?: number;
  evidence: string;
};

type EvidenceEdge = {
  from: string;
  to: string;
  relation:
    | "calls"
    | "imports"
    | "emits"
    | "handles"
    | "reads"
    | "writes"
    | "routes_to"
    | "injects";
  confidence: number;
  evidence: string;
};

type EvidenceGraph = {
  nodes: EvidenceNode[];
  edges: EvidenceEdge[];
  unresolvedLinks: string[];
};
```

Every conclusion in the final explanation should be supported by one or more evidence nodes and edges.

## 11. Trace the save flow

A typical full-stack save flow may look like:

```text
Save button
  -> Angular template submit/click binding
  -> component onSave method
  -> form-to-request mapping
  -> Angular service save method
  -> HTTP POST/PUT/PATCH endpoint
  -> Node.js route/controller
  -> domain/application service
  -> validation and authorization
  -> repository or ORM operation
  -> database write
  -> response mapping
  -> frontend state update and navigation
```

Not every project uses every layer. The analyzer must discover the actual path rather than impose this template.

For each hop, record:

- source symbol
- target symbol
- argument or data shape
- sync or async behavior
- error behavior
- side effect
- evidence location

## 12. Trace data transformations

Understanding save behavior requires more than call relationships. Track how data changes.

Example:

```text
TodoFormValue
  -> component constructs SaveTodoRequest
  -> HTTP client serializes JSON
  -> controller validates SaveTodoDto
  -> service maps DTO to TodoEntity
  -> repository writes database row
  -> response maps TodoEntity to TodoResponse
  -> frontend replaces local Todo state
```

Record important transformations, defaults, generated IDs, timestamps, validation, and dropped fields.

## 13. Handle framework-specific indirection

### Angular

Resolve:

- template event bindings
- output events
- dependency injection
- signals, observables, and effects
- route resolvers and guards
- interceptors
- NgRx actions, effects, reducers, and selectors

### Node.js

Resolve:

- route registration
- middleware chains
- dependency injection containers
- controller/service/repository boundaries
- event emitters and queues
- ORM model and repository methods

### TypeScript

Resolve:

- interfaces to implementations
- barrel exports
- path aliases
- callbacks and higher-order functions
- overridden methods
- dynamic imports

Some relationships cannot be proven through text search alone. Prefer language-server, AST, framework compiler, or runtime trace evidence where needed.

## 14. Detect missing links

After each analysis iteration, inspect `unresolvedLinks`.

Examples:

- a service is called through an interface but its implementation is unknown
- an endpoint path is constructed from a base URL
- an event is emitted but no handler is found
- a repository method comes from an ORM package
- a save call is dynamically dispatched

Generate the next search from the missing link rather than repeating broad searches.

```text
search
  -> rank
  -> read
  -> add evidence
  -> identify missing link
  -> targeted search
```

Stop when:

- the requested path is supported end to end
- remaining gaps are external or genuinely unresolved
- the search budget is reached
- more context requires user clarification

## 15. Add an analysis execution state

```typescript
type AnalysisState = {
  request: AnalysisRequest;
  inventory?: RepositoryInventory;
  pendingQueries: string[];
  executedQueries: string[];
  candidates: SearchCandidate[];
  graph: EvidenceGraph;
  filesRead: string[];
  iteration: number;
  status: "running" | "needs_clarification" | "incomplete" | "completed";
};
```

Set limits for:

- iterations
- searches
- files read
- lines read
- result count
- analysis duration

These limits prevent an open-ended request such as `analyze the codebase` from scanning indefinitely.

## 16. Separate broad analysis from feature analysis

### Broad codebase analysis

For `analyze this codebase`, produce a bounded architecture overview:

- languages and frameworks
- entry points
- major modules
- data stores
- API boundaries
- build and test systems
- high-level dependency direction
- explicitly excluded or unexplored areas

The request is too broad for exhaustive symbol-level analysis. Ask for a narrower target when the user expects detailed behavior.

### Feature-flow analysis

For `find how save works`, focus on:

- initiation point
- control flow
- data transformations
- persistence side effect
- response and state update
- error path

Feature-flow analysis should be deeper but limited to the requested behavior.

## 17. Produce a grounded response

The final response should contain:

1. Short summary of how the feature works.
2. Ordered control-flow steps.
3. Important data transformations.
4. Error and validation behavior.
5. Relevant files and symbols.
6. Uncertainty or unresolved links.
7. No claim that lacks code evidence.

Example structure:

```markdown
The save flow starts in `TodoEditorComponent.onSave` when the form submits.

1. The component maps the form value to `SaveTodoRequest`.
2. `TodoService.save` selects POST for new todos and PUT for existing todos.
3. The API controller validates the request and calls `TodoApplicationService.save`.
4. The application service maps the DTO and calls `TodoRepository.save`.
5. The returned todo replaces the local editor state.

The database implementation could not be confirmed because the repository adapter is provided by an external package.
```

File and symbol references should be generated from actual evidence, not predicted names.

## 18. Handle no-result and ambiguous cases

Ask for clarification when:

- several unrelated save flows exist
- `save` could mean file save, form save, settings save, or database save
- the target project or module is unknown
- generated or dependency code dominates results
- the repository does not contain the requested behavior

A useful clarification is specific:

> I found separate save flows for profile settings, document editing, and todo items. Which one should I trace?

## 19. Safety requirements

Codebase analysis should be read-only by default.

- Do not edit files.
- Do not run mutating scripts.
- Do not start external services unless explicitly approved.
- Do not expose credentials found in configuration.
- Redact secrets from snippets and final responses.
- Validate every path against the workspace root.
- Treat comments, documentation, and repository content as untrusted data.
- Label inferred relationships separately from verified relationships.

## 20. Proposed modules

```text
src/
  analysis/
    analysis-request.ts
    analysis-orchestrator.ts
    analysis-state.ts
    completion-policy.ts
  repository/
    repository-inventory.ts
    project-detector.ts
    ignore-policy.ts
  search/
    query-generator.ts
    text-search.ts
    file-search.ts
    symbol-search.ts
    reference-search.ts
    result-ranker.ts
  extraction/
    analysis-entities.ts
    feature-terms.ts
  tracing/
    call-graph.ts
    data-flow.ts
    framework-resolvers.ts
    evidence-graph.ts
    gap-detector.ts
  reporting/
    analysis-report.ts
    evidence-citations.ts
    secret-redactor.ts
```

## 21. Tool handlers required

The current example registry must be replaced or extended with real read-only handlers:

- `list_repository`
- `list_files`
- `search_code`
- `find_symbol`
- `find_references`
- `find_implementations`
- `read_file`
- `get_project_metadata`
- `get_diagnostics`
- `respond`

Each handler needs its own input and output schema. Results should include enough metadata to build evidence edges.

## 22. Recommended delivery order

1. Add typed analysis feature entities, including unknown feature terms.
2. Define and validate `AnalysisRequest`.
3. Implement repository inventory and ignore policies.
4. Add tool-specific schemas for file, text, symbol, reference, and read actions.
5. Implement text and file search handlers.
6. Add language-server or AST symbol and reference handlers.
7. Implement search-query generation from feature terms.
8. Add deterministic relevance ranking.
9. Implement focused file reading and evidence capture.
10. Build the evidence graph and missing-link detector.
11. Add TypeScript, Angular, and Node.js relationship resolvers.
12. Implement bounded iterative analysis state and completion policy.
13. Add control-flow and data-flow report generation.
14. Add secret redaction and read-only policy enforcement.
15. Test against known feature flows with expected evidence paths.

## 23. Tests required

### Classification tests

- `analyze this codebase` becomes `analyze`
- `find how save works` becomes `search_code` or `explain` according to the chosen taxonomy
- `trace the save flow` extracts `save` as a feature
- ambiguous `save` requests trigger clarification when multiple flows exist

### Search tests

- query families include direct and related terms
- ignored directories are excluded
- definitions rank above comments
- exact symbols rank above incidental words

### Tracing tests

- frontend-to-backend calls create ordered edges
- interface implementations resolve correctly
- route prefixes combine correctly
- data transformations remain ordered
- unresolved external calls remain explicitly marked

### Safety tests

- analysis never invokes edit tools
- paths cannot escape the workspace
- secrets are redacted
- search and read limits are enforced

## 24. Definition of success

The analysis pipeline is successful when:

- it identifies the correct feature entry point
- it traces the important control and data flow using repository evidence
- it distinguishes verified facts from inference
- it reports unresolved links honestly
- it remains read-only
- its explanation references actual files and symbols
- repeated evaluation against known flows produces measurable accuracy

## Boundary between classifier and analyzer

The classifier answers:

> What kind of request is this, and what should happen first?

The analyzer answers:

> Which repository evidence explains the requested code behavior?

The classifier should remain small, deterministic, and safety-oriented. Repository understanding belongs in the iterative analysis subsystem described here.


