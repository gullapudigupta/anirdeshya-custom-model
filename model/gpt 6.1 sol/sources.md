# Sources, verification, and limitations

Public references consulted on 2026-10-07. Only public URLs were fetched; repository code and the supplied attachment were not sent to web services.

Links can change. Pin implementation/library/spec versions before building. This pack is planning guidance, not a literature review, vendor quote, hardware certification, or benchmark result.

## 1. Primary references

| Source | Verified relevance | Used in |
|---|---|---|
| [MCP specification, 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25) | Host/client/server roles, JSON-RPC, resources/prompts/tools, capability negotiation, cancellation and trust/consent principles | [design.md](design.md), [tool-delegation.md](tool-delegation.md), [security-data.md](security-data.md) |
| [SWE-bench documentation](https://www.swebench.com/SWE-bench/) | Real-world repository issues, generated patches, Docker-based reproducible evaluation, named dataset variants | [benchmarks.md](benchmarks.md) |
| [SWE-bench leaderboard site](https://www.swebench.com/) | Public results interface; no ranking or score is adopted here | [benchmarks.md](benchmarks.md) |
| [BigCodeBench repository](https://github.com/bigcode-project/bigcodebench) | Practical function-level programming tasks and library use; benchmark/harness context | [benchmarks.md](benchmarks.md) |
| [OpenTelemetry signals](https://opentelemetry.io/docs/concepts/signals/) | Traces, metrics, logs and signal categories | [monitoring.md](monitoring.md) |
| [Hugging Face PEFT LoRA guide](https://huggingface.co/docs/peft/main/en/conceptual_guides/lora) | Frozen base weights, low-rank trainable updates, rank/configuration and merging | [training.md](training.md) |
| [vLLM optimization guide](https://docs.vllm.ai/en/latest/configuration/optimization/) | KV-cache pressure, preemption, concurrency/tensor/pipeline trade-offs and monitoring | [hardware.md](hardware.md), [monitoring.md](monitoring.md) |
| [OWASP prompt injection guidance](https://genai.owasp.org/llmrisk/llm01-prompt-injection/) | Direct/indirect injection; RAG/fine-tuning do not fully mitigate it; least privilege and validation | [security-data.md](security-data.md) |

The PEFT link uses the main documentation branch. The fetched vLLM page explicitly labels itself developer-preview documentation. Use a tested stable release for implementation; do not assume preview flags exist in a chosen deployment.

## 2. Repository context examined

- Repository root README: states the intention to build custom models.
- Native classifier README: describes Node.js/TypeScript deterministic intent handling, bounded read-only analysis, provenance-bearing results and explicit unresolved boundaries.
- Supplied read-only task snapshot: describes analysis contracts and completed/pending tasks, including outstanding hardening and release work.

These files were examined to align proposed language/tool concepts. Their claims were **not independently certified by executing application tests** in this documentation-only task. The new agent remains independent until reuse is explicitly validated.

## 3. Planning estimates, not sourced guarantees

The following are design proposals or arithmetic illustrations:

- Language scope, team size, pilot concurrency, time ranges and rollout sequence.
- Chunk sizes, candidate counts, context budgets and delegation limits.
- Quality thresholds, latency SLOs, alert thresholds and retention periods.
- Hardware bands, raw-weight/KV/training-state approximations.
- Training example counts, compute estimate and sustained-throughput assumption.
- Hypothetical token/GPU prices, workload volumes, ROI and cost targets.

They require representative measurements, organizational approvals, and current quotes. No specific model is selected or claimed to meet these targets.

## 4. What remains unverified

- Actual user budget, hardware, deployment constraints and allowed data transfers.
- Source rights for the future documentation corpus or training data.
- Model quality, availability, exact license, context support and procurement price.
- Real task success, productivity gains, inference/training throughput and capacity.
- Existing analyzer implementation completeness and release readiness.
- Runtime support on the user's Windows hardware and intended production platform.

Use [roadmap.md](roadmap.md) to resolve these before implementation, and [benchmarks.md](benchmarks.md) to convert proposals into measured evidence.
