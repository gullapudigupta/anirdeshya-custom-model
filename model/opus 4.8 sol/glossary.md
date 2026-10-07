# Glossary

| Term | Meaning |
|------|---------|
| **Agent** | System that plans, calls tools, observes results, and iterates toward a goal. |
| **Orchestrator** | Controller that runs the agent loop and dispatches tools/sub‑agents. |
| **RAG** | Retrieval‑Augmented Generation: fetch relevant text and condition the model on it. |
| **Hybrid search** | Combine dense (embedding) and sparse (BM25 keyword) retrieval. |
| **Reranker** | Cross‑encoder that re‑orders retrieved candidates for precision. |
| **Embedding** | Vector representation of text used for semantic search. |
| **Vector DB** | Database for storing/searching embeddings (e.g., Qdrant, Milvus, pgvector). |
| **Chunking** | Splitting documents into retrievable units. |
| **Grounding** | Basing answers on retrieved/authoritative sources. |
| **Groundedness / faithfulness** | Degree to which claims are supported by cited sources. |
| **Abstention** | Model declining to answer when sources don't cover the question. |
| **Citation** | Reference linking an answer span to its source. |
| **MCP** | Model Context Protocol: standard for exposing tools/resources to models. |
| **Tool / function call** | Model‑invoked external capability (run tests, search, edit files). |
| **Sub‑agent** | Specialized agent handling part of a task (planner, coder, reviewer). |
| **Model routing** | Sending requests to small vs. large models by difficulty. |
| **SFT** | Supervised Fine‑Tuning on instruction/response data. |
| **PEFT** | Parameter‑Efficient Fine‑Tuning (e.g., LoRA). |
| **LoRA / QLoRA** | Low‑Rank Adapters (quantized) — cheap fine‑tuning without full weights. |
| **DPO / ORPO / KTO** | Preference‑tuning methods without a separate reward model. |
| **RLHF / RLAIF** | Reinforcement Learning from Human / AI Feedback. |
| **RLEF** | RL from Execution Feedback (reward = tests pass/compile). |
| **Continued pre‑training** | Further pre‑training a base on domain data. |
| **FIM** | Fill‑In‑the‑Middle objective for code completion. |
| **MoE** | Mixture‑of‑Experts architecture. |
| **Distillation** | Training a small model to mimic a larger one. |
| **Quantization** | Reducing weight precision (INT8/INT4/FP8) to cut memory/cost. |
| **Speculative decoding** | Draft‑then‑verify decoding to speed generation. |
| **Continuous batching** | Dynamically batching requests to raise GPU utilization. |
| **KV cache** | Cached attention keys/values reused during generation. |
| **pass@k** | Benchmark metric: ≥1 of k samples passes all tests. |
| **SWE‑bench** | Benchmark of real GitHub issues resolved by editing a repo. |
| **Contamination** | Eval data leaking into training, inflating scores. |
| **Drift** | Shift in input distribution (data) or quality (performance) over time. |
| **Guardrail** | Safety check on inputs/outputs (secrets, licenses, unsafe code). |
| **Prompt injection** | Malicious instructions hidden in untrusted content. |
| **Sandbox** | Isolated environment for safely executing code. |
| **North‑star metric** | Single primary metric capturing delivered value. |
| **Canary** | Limited rollout to a subset to catch regressions. |
| **Trace** | Full record of an agent run (steps, tools, model calls). |
