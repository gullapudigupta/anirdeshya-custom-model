# Hardware requirements and sizing

These are **capacity-planning bands, not minimum guarantees**. Model architecture, quantization format, context, concurrent sequences, runtime, OS, offloading and kernels change requirements. Validate a selected model with a measured load test before purchasing.

## 1. Practical configurations

| Workload | CPU/RAM/storage starting point | GPU starting point | Notes |
|---|---|---|---|
| Hosted-model docs MVP | 4-8 CPU cores, 16-32 GB RAM, 100-250 GB SSD | None for generation; embeddings can be hosted or CPU | Client + orchestration + modest index |
| CPU-only local prototype | 8-16 cores, 32-64 GB RAM, 250-500 GB SSD | None | Small quantized model; expect slower generation; not assumed to meet latency SLO |
| Local 3B-8B quantized inference | 8-16 cores, 32-64 GB RAM, 500 GB NVMe | 12-24 GB VRAM; 24 GB gives more headroom | Short/moderate context, low concurrency |
| Local 14B class, quantized | 12-24 cores, 64 GB RAM, 1 TB NVMe | 24-48 GB VRAM | Larger contexts/concurrency can require more |
| Local 30B-32B class, quantized | 16-32 cores, 64-128 GB RAM, 1-2 TB NVMe | 48-80 GB total VRAM | Multi-GPU runtime and topology must be supported |
| Local 70B class, quantized | 24-48 cores, 128-256 GB RAM, 2 TB+ NVMe | 2 x 48 GB or 2 x 80 GB starting band | Not a long-context/high-concurrency guarantee |
| 70B BF16 serving | 32+ cores, 256 GB+ RAM, 2 TB+ NVMe | 4 x 80 GB starting band | Weights alone ~140 decimal GB; additional cache/runtime needed |
| Retrieval at pilot scale | 8-16 cores, 32-64 GB RAM, 250 GB-1 TB SSD | Optional embedding/reranking GPU | Benchmark corpus and query concurrency separately |
| Build/test worker pool | 4-8 cores and 8-16 GB RAM per active worker initially | Usually none | Actual project build profile determines limits |

RAM and SSD figures include operational headroom, not unlimited corpus/model storage. Hardware adequate for loading weights may still fail latency, concurrency, or long-context requirements.

## 2. Weight-memory calculation

Approximate raw dense-model weights:

```text
weight bytes ~= parameter_count * bits_per_weight / 8
```

| Parameters | BF16/FP16 raw weights | 8-bit raw weights | 4-bit raw weights |
|---|---:|---:|---:|
| 7B | 14 GB | 7 GB | 3.5 GB |
| 14B | 28 GB | 14 GB | 7 GB |
| 32B | 64 GB | 32 GB | 16 GB |
| 70B | 140 GB | 70 GB | 35 GB |

Units above are decimal GB. Actual quantized storage includes scales/metadata and possibly unquantized layers. Add runtime workspaces, activations, fragmentation, and KV cache. Quantization can reduce quality; compare against the unquantized baseline when feasible.

## 3. Context and concurrency memory

For a conventional decoder with uniform grouped-query/multi-head attention:

```text
KV bytes ~= 2 * layer_count * kv_head_count * head_dimension
            * stored_tokens * bytes_per_cache_element
```

The factor 2 represents keys and values. Multiply across active sequences; paged caches, prefix sharing, sliding windows, quantized caches, and other architectures alter the actual allocation.

Illustrative architecture: 32 layers, 8 KV heads, head dimension 128, BF16 cache:

- About 128 KiB per stored token.
- 16,384 tokens require about 2 GiB per sequence.
- Five such concurrent sequences require about 10 GiB, before weights and other buffers.
- Prompt plus generated tokens consume the context/cache budget.

This is **not** the specification of a selected model. It shows why a model that fits on a GPU at short context can fail at long context or multi-user load.

Keep measured headroom rather than targeting 100% memory use. Set context and active-sequence caps, queue excess requests, and observe cache preemption/OOM behavior.

## 4. Training configurations

| Training task | Experimental starting band | Important caveat |
|---|---|---|
| Small retriever/intent model | CPU or one 8-24 GB GPU | Architecture/data dependent |
| 3B-8B QLoRA | One 24 GB GPU; 48 GB preferred for larger context/batch | Short sequences, microbatching, checkpointing may be required |
| 14B QLoRA | One 48-80 GB or supported multi-GPU setup | Not guaranteed for long trajectories |
| 30B-32B QLoRA | 80 GB GPU or 2 x 48-80 GB | Sharding/runtime support and activations dominate |
| 7B full-parameter training/fine-tuning | Roughly 4-8 x 80 GB starting experiment | Sharding/optimizer/context choices strongly affect need |
| 70B full fine-tuning | Multi-node multi-GPU cluster; size after memory/throughput pilot | Hundreds of GB to TB of state plus activations |
| Foundation pretraining | Dedicated multi-node accelerator cluster | Token/compute budget, fabric, checkpoints and staffing drive scale |

Some optimized recipes fit in less memory; this is not a promise those recipes work for the required context, throughput, or quality.

For conventional mixed-precision Adam training, model/gradient/master-weight/optimizer state may total roughly **12-20 bytes per parameter before activations and temporary buffers**. An illustrative 16 bytes/parameter gives 112 GB for 7B and 1.12 TB for 70B. Sharding distributes state; it does not eliminate activations, communication, or checkpoint storage. Quantized optimizers and other recipes change these numbers.

## 5. Storage, networking, and OS

- Budget model copies, optimizer checkpoints, datasets, indexes, test images and artifacts independently.
- A full checkpoint can include much more than inference weights. Retaining many checkpoints rapidly exceeds a workstation SSD.
- Use NVMe for active loading/indexing; durable object storage for approved datasets and checkpoints.
- Multi-GPU speed depends on interconnect bandwidth and runtime support, not summed VRAM alone.
- Multi-node training may require high-bandwidth fabric such as 100-400 Gb/s networking; select topology from measured communication needs.
- Confirm electricity, cooling, power supply, driver/runtime compatibility and hardware availability.
- Linux is the proposed production training/serving environment. Windows local inference depends on the selected runtime; WSL2/container support must be verified.
- For unified-memory machines, capacity and bandwidth are shared; RAM size is not equivalent to dedicated VRAM performance.

## 6. Buying decision and test procedure

1. Freeze two candidate models, quantization variants and serving runtimes.
2. Test 4K/8K/16K prompt profiles with realistic output lengths.
3. Sweep concurrency 1/2/5/10, recording queue time, first token, completion p50/p95, memory, failures and throughput.
4. Include cold start, repeated prefixes, long-tail prompts and cancellation.
5. Run quality tests on the exact deployed quantization.
6. Measure the limiting resource: GPU memory/compute, CPU retrieval, disk, network or tool workers.
7. Rent/borrow hardware for this test before purchase; select a configuration with measured headroom.

**Recommended first purchase: no generator GPU until hosted/local privacy and quality comparisons are complete.** For a private local proof of concept, a 24 GB GPU workstation is a reasonable experiment for smaller quantized models, not a promise of large-model production capacity.

Economics: [cost-capacity.md](cost-capacity.md). Measurement: [benchmarks.md](benchmarks.md).
