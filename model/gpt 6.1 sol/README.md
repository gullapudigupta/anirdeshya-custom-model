# Brand-new coding agent: strategy pack

Planning date: 2026-10-07. Status: proposed, not implemented or benchmarked.

The folder name is a requested organizational label, not a claim that a particular model has been selected, licensed, trained, or made available. This pack is model-provider independent.

## Recommended starting point

Build a new **documentation-grounded coding assistant using an existing code-capable model, hybrid RAG, deterministic tools, and a permission-enforcing orchestrator**. Start read-only. Add previewable patches and sandboxed validation after the evidence and safety gates pass. Do not start by training a foundation model.

Distinguish three products:

1. **Documentation-only assistant:** suggests code from approved documentation; cannot claim repository compatibility.
2. **Repository-aware assistant:** reads authorized project files and symbols to tailor suggestions.
3. **Coding agent:** proposes changes and can execute approved tools in an isolated workspace.

Also distinguish a **new agent product** from **new model weights**. RAG and tool orchestration create a new product without changing model weights. Training is optional and must earn its cost through measured improvement.

## Read in this order

| Document | Purpose |
|---|---|
| [strategy.md](strategy.md) | Decisions, alternatives, considerations, recommended route |
| [requirements.md](requirements.md) | Scope, priorities, measurable acceptance criteria |
| [design.md](design.md) | Architecture, interfaces, state transitions, deployment |
| [documentation-only.md](documentation-only.md) | Options for suggestions grounded purely in documentation |
| [rag-only.md](rag-only.md) | No-weight-training paths, ingestion, retrieval, failure handling |
| [training.md](training.md) | Minimum to maximum training investment and experiment gates |
| [hardware.md](hardware.md) | Hosted, CPU, local GPU, serving, and training sizing |
| [tool-delegation.md](tool-delegation.md) | MCP, native tools, workers, multi-agent load splitting |
| [monitoring.md](monitoring.md) | Telemetry, dashboards, alerts, operational runbooks |
| [benchmarks.md](benchmarks.md) | Reproducible model, retrieval, tool, and agent evaluation |
| [success-metrics.md](success-metrics.md) | Product success, release gates, pilot measurement |
| [security-data.md](security-data.md) | Privacy, security, data rights, dataset governance |
| [cost-capacity.md](cost-capacity.md) | Unit economics, capacity, budget decisions |
| [roadmap.md](roadmap.md) | Phases, dependencies, staffing, delivery decisions |
| [sources.md](sources.md) | Verified references and evidence limitations |
| [index.html](index.html) | Local browser navigation to every file in this folder |

Open the HTML index directly in a browser. Markdown links open the source document; rendered Markdown depends on the browser/editor. The index deliberately requires no server, CDN, JavaScript, or external assets.

## Assumptions and boundaries

- Proposed MVP: TypeScript/JavaScript and Node.js, with Angular as a later focused vertical. This matches the repository's documented analysis focus, not a restriction on future language support.
- Proposed pilot: 5-20 developers; interactive suggestions and small issue fixes, not autonomous production operation.
- Hosted and fully local deployments are alternatives. Private source is never sent to a provider without a documented policy and explicit authorization.
- All targets, hardware bands, workloads, timelines, and cost examples are **planning estimates**, not measured results or vendor promises.
- Public references were consulted without uploading repository code or the supplied attachment.
- This task creates strategy documents only. Existing application files and the read-only attachment are unchanged.

The native classifier documentation describes deterministic routing, bounded analysis, and evidence reporting. The supplied task snapshot also shows pending hardening work. These are design inputs, **not proof that existing modules meet this new agent's requirements**. Reuse only through explicit contract and safety tests; otherwise implement fresh components.

Before implementation, confirm languages, documentation sources and rights, deployment/privacy boundary, budget, concurrency, execution permissions, and the model shortlist. See the decision gates in [roadmap.md](roadmap.md).
