# Strategy and key considerations

## 1. Outcome

Create a coding assistant that produces useful, version-correct suggestions with evidence, and can progress into a controlled coding agent. Optimize **verified developer outcomes per unit of time and cost**, not model size, token volume, or number of agents.

Recommended sequence:

1. Define the permission boundary and a held-out benchmark before selecting a model.
2. Ship documentation-only answers with citations and explicit abstention.
3. Add authorized repository search, language intelligence, and diagnostics.
4. Add patch previews, isolated builds/tests, and human-approved application.
5. Optimize retrieval, model routing, caching, and tool execution.
6. Fine-tune only if a recurring behavioral weakness remains after context/tool fixes.
7. Consider from-scratch training only as a separately funded research program.

## 2. Product options

| Option | Strength | Limitation | Appropriate use |
|---|---|---|---|
| Templates and exact documentation search, no generative model | Cheap, predictable, offline | Limited synthesis and unfamiliar tasks | API examples, approved recipes |
| Hosted model plus RAG | Fastest path to capable reasoning; no local GPU | Network, provider cost, privacy and availability | Approved public/non-sensitive contexts |
| Local open-weight model plus RAG | Control over data and deployment | Hardware, serving operations, weaker models may fail complex work | Confidential or offline environments |
| Hybrid local/hosted routing | Local simple tasks, stronger approved escalations | Policy and operational complexity | Mixed sensitivity and difficulty |
| RAG plus adapters | Can improve format, style, tool behavior | Dataset and model-release overhead | Proven recurrent behavior gaps |
| Full fine-tuning or continued pretraining | Broader adaptation | Large compute, regression and rights risks | Specialized corpus with funded evaluation |
| Foundation model from scratch | Maximum architectural control | Data, compute, staffing and competitive-performance risk | Research objective, not MVP |

Choose based on evidence using [benchmarks.md](benchmarks.md), not a leaderboard alone. Model availability, context limits, licensing, retention, regional hosting, and pricing must be checked at procurement time.

## 3. What to consider before building

### Product and user experience

- Is the output an explanation, example, autocomplete, patch, or completed issue?
- Inline completion requires a different latency budget and context policy from chat. It is deferred from the initial chat MVP.
- Show sources, framework versions, assumptions, validation state, and permissions without overwhelming the user.
- Provide cancel, inspect-evidence, retry, and feedback controls.
- Resolve missing framework/version/scope information before confident suggestions.
- Separate abstention, incomplete work, policy denial, and infrastructure failure.
- Make onboarding feasible for repositories without existing indexes.

### Knowledge and correctness

- Prefer official, versioned docs and owned runbooks; record contradictory and obsolete sources.
- Separate document facts from repository observations and model inference.
- A citation supports a particular claim, not necessarily an entire generated program.
- Documentation-only mode cannot prove existing symbols, internal flows, dependency compatibility, or test success.
- Validate examples where possible, but never label them validated unless a matching sandbox actually ran.
- Handle monorepos, generated code, dynamic dispatch, multi-language boundaries, and lockfile differences.
- Test long-tail questions and missing evidence, not only easy FAQ matches.

### Architecture and operations

- Use deterministic authorization, scheduling, retries, budgets, and validation outside the model.
- Select bounded task-specific tools; do not expose an unrestricted shell by default.
- Plan tenant isolation, source freshness, cache invalidation, cancellation, checkpointing, and rollback.
- Separate ingestion workloads, interactive serving, training, and test execution.
- Control context and output budgets. A larger context window does not guarantee better evidence selection.
- Account for tool latency and sandbox startup, not only model tokens/second.

### Data, legal, and security

- Verify source collection, storage, quotation, redistribution, and training rights separately.
- Keep user repositories and benchmark answers out of training unless explicitly approved.
- Treat docs, code comments, tool descriptions, and tool output as untrusted input.
- Prevent prompt injection from granting permissions or changing outbound destinations.
- Use short-lived scoped credentials outside model-visible context.
- Define retention, deletion, residency, telemetry access, and provider-data settings.
- Maintain a dependency inventory, licenses, vulnerability process, and incident response.

### People and economics

- Assign a product owner, platform/tool owner, retrieval/data owner, evaluation owner, and security reviewer. One person may fill several roles.
- Budget for annotation, test fixtures, ingestion maintenance, on-call work, and model migration.
- Evaluate cost per verified success and repair effort, not merely cost per request.
- Avoid premature multi-agent systems: extra calls can increase latency, duplicate work, and correlated errors.
- Validate a local model on rented/borrowed hardware before purchasing GPUs.

## 4. Recommended MVP stack

This is a shortlist, not a mandated dependency installation:

- TypeScript orchestrator and versioned JSON Schema/Zod contracts.
- Hybrid lexical and vector retrieval with one datastore initially; a relational database with vector support is an option. Larger dedicated search/vector services are alternatives after measured need.
- Language-server/compiler adapters for repository truth.
- One selected generator behind a provider-neutral interface; optional separate embedding model and reranker.
- Native typed tools first, MCP adapters where portability or external integration justifies them.
- Ephemeral Linux sandbox workers for approved tests; Windows remains a supported client environment.
- OpenTelemetry-compatible instrumentation and CI-based evaluation.

No implementation stack is installed by this documentation task.

## 5. Deliberate non-goals

The MVP does not promise a frontier foundation model, unconstrained autonomy, all languages, self-modifying infrastructure, production deployment, automatic commits, guaranteed injection immunity, or guaranteed correctness. It does not train on arbitrary scraped code.

## 6. Decisions that must not be hidden

| Decision | Default proposal | Trigger to change |
|---|---|---|
| Model training | None | Error analysis shows a stable behavior gap and adapters beat RAG baseline |
| Repository access | Disabled in docs-only; explicit read permission later | User asks for project-specific work |
| Writes/execution | Disabled initially | Patch preview, authorization, isolation, and safety gates pass |
| Multi-agent usage | One orchestrator and tools | Independent tasks outperform single-agent baseline at equal budget |
| Deployment | Hosted public-doc pilot or local private pilot | Data policy, quality, cost, and operations evidence |
| Retrieval | Hybrid, version-filtered | Ablation demonstrates a simpler or richer method is better |
| Existing analyzer reuse | Optional adapter | Contract, boundary, cancellation, and redaction tests pass |

Follow [requirements.md](requirements.md) for enforceable outcomes and [roadmap.md](roadmap.md) for implementation gates.
