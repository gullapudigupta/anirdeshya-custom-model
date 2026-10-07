# Hardware Requirements

Sizing for training, fine‑tuning, inference, and the RAG stack. Numbers are
planning estimates — validate with your chosen model and load.

## 1. The three workloads
1. **Inference/serving** (always on, latency‑critical).
2. **Fine‑tuning** (periodic; LoRA cheap, full SFT heavier).
3. **Pre‑training / continued pre‑training** (rare, very expensive).

Plus **RAG infra** (CPU + vector DB + embeddings) and **storage**.

## 2. GPU memory rule‑of‑thumb
- **Inference:** ~2 bytes/param (fp16) + KV cache. 7B ≈ 14 GB, 13B ≈ 26 GB,
  34B ≈ 68 GB, 70B ≈ 140 GB (before KV cache + overhead).
- **Quantized inference (INT8/INT4):** roughly ½ or ¼ of the above. A 7B in
  4‑bit fits ~6–8 GB; a 70B in 4‑bit fits ~40–48 GB.
- **LoRA fine‑tuning:** base weights (fp16) + small adapters + activations;
  fits far smaller than full training.
- **Full fine‑tuning (SFT):** ~16–20 bytes/param (weights+grads+optimizer in
  mixed precision). 7B full SFT ≈ 100+ GB → multi‑GPU.
- **Pre‑training:** same optimizer overhead × far more tokens × many GPUs.

## 3. Inference tiers
| Tier | Model | Hardware (example) | Use |
|------|-------|--------------------|-----|
| Edge | 3–8B, 4‑bit | 1× consumer GPU (8–16 GB) / high‑end laptop / CPU | offline completion |
| Small | 7–13B, fp16/8‑bit | 1× 24–48 GB GPU (e.g., A10/L40S‑class) | completion, light chat |
| Medium | 30–34B | 1–2× 48–80 GB GPU | agentic chat |
| Large | 70B+ | 2–4× 80 GB GPU (NVLink) | hard reasoning / agent |
| Scale | MoE / 100B+ | multi‑node 8× 80 GB | high throughput service |

Serving efficiency: **vLLM / TGI / SGLang** with paged KV cache, continuous
batching, and **speculative decoding**; quantize (AWQ/GPTQ/FP8) to raise
throughput and cut cost.

## 4. Fine‑tuning hardware
| Method | 7B | 13B | 70B |
|--------|----|-----|-----|
| LoRA / QLoRA | 1× 24 GB (QLoRA 16 GB) | 1× 24–48 GB | 2–4× 48–80 GB |
| Full SFT | 2–4× 80 GB | 4–8× 80 GB | 16–32× 80 GB |
| DPO/RLAIF | ~ SFT + a bit more (ref model) | — | — |

Start with **QLoRA** — it runs the useful experiments on modest hardware.

## 5. Pre‑training / continued pre‑training (only if justified)
- Hundreds to thousands of GPUs for weeks; interconnect (InfiniBand/NVLink),
  fast parallel storage, and a distributed training stack
  (Megatron/DeepSpeed/FSDP).
- Cost is typically six–eight figures; see [cost-model.md](./cost-model.md).
- **Recommendation:** avoid from‑scratch pre‑training until RAG + fine‑tuning
  are proven insufficient. See [training-strategy.md](./training-strategy.md).

## 6. RAG / retrieval infra
- **Embedding generation:** 1 small GPU accelerates indexing; CPU works for
  small corpora.
- **Vector DB:** memory‑bound. Rough RAM: vectors × dim × 4 bytes × overhead.
  1M chunks × 768‑dim fp32 ≈ 3 GB raw (+ index overhead). Scale RAM/sharding
  with corpus size; use quantized/`int8` vectors to shrink.
- **Reranker (cross‑encoder):** small GPU or CPU for low volume.
- **CPU/RAM:** generous for ingestion, chunking, BM25.

## 7. Storage & networking
- **Object store:** raw docs + corpora + checkpoints (checkpoints are large —
  budget TBs for training).
- **Fast local NVMe** for active datasets and KV‑cache spill.
- **High‑bandwidth interconnect** (NVLink/InfiniBand) for multi‑GPU training.

## 8. Cloud vs. on‑prem
| | Cloud | On‑prem |
|--|-------|---------|
| Capex | Low | High |
| Flexibility | Rent big clusters on demand | Fixed capacity |
| Cost at scale | Can exceed on‑prem | Cheaper if well‑utilized |
| Data residency | Depends on provider | Full control |
| Best for | Spiky training, early stage | Steady high‑volume serving |

**Hybrid** is common: cloud for bursty training, on‑prem/reserved for steady
inference.

## 9. Starter configurations
- **Prototype (team of a few):** 1× 24–48 GB GPU for serving a 7–13B model
  + CPU box for vector DB + object storage. QLoRA experiments on the same GPU.
- **Pilot (department):** 2–4× 48–80 GB GPUs (serving + routing), managed
  vector DB, separate fine‑tune node (rented when needed).
- **Production (org):** autoscaling GPU pool, sharded vector DB, dedicated
  eval/monitoring infra; rent large clusters only for training bursts.

## 10. Levers to reduce hardware
Quantization · speculative decoding · model routing (small↔large) · prompt +
semantic caching · offloading work to tools/RAG
([load-distribution.md](./load-distribution.md)) · LoRA over full fine‑tune.
