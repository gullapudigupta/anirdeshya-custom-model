# Cost, capacity, and build-versus-buy

No live pricing quotes are used here. Example rates are invented planning inputs and must be replaced with current vendor quotes and measured workloads.

## 1. Count all cost centers

- Generator input/output tokens and any retry/repair/reviewer calls.
- Embedding/re-embedding and reranking.
- Retrieval database, storage, backups and transfer.
- CPU/GPU serving, idle time, queue capacity and monitoring.
- Sandbox builds, package cache, images and artifact storage.
- Dataset collection, rights review, annotation and evaluation.
- Training experiments, failed runs, checkpoints and deployment testing.
- Development, security review, maintenance and on-call labor.
- Hardware purchase/depreciation, power, cooling and replacement.

MCP fees, remote API quotas and tool-specific charges may apply. Delegating to another agent does not remove generator cost; it usually adds another request.

## 2. Hosted-request formula

```text
request_model_cost
  = input_tokens / 1,000,000 * input_rate
  + output_tokens / 1,000,000 * output_rate
  + additional_calls_and_services
```

Illustration only:

- 8,000 input tokens, 1,000 output tokens.
- Assumed $2 per million input tokens and $8 per million output tokens.
- One call costs $0.016 + $0.008 = $0.024.
- 20,000 such requests cost $480 in generator usage alone.
- A mean of two equivalent calls per request would make that $960.

Actual models have different pricing, cached-input terms and billable features. Use receipts from the actual selected provider. Do not claim these rates for any named model.

## 3. Cost per verified success

```text
cost_per_verified_success
  = total_cost_for_all_eligible_attempts / verified_success_count
```

If request cost averages $0.024 and verified usefulness is 80%, generator-only cost per success is $0.030. Include abstentions, failures, tools, idle capacity and operations to calculate product cost per success. If there are zero successes, the metric is undefined/unbounded, not zero.

## 4. Capacity and queues

Illustrative pilot demand:

- 20 developers x 30 requests/day x 22 working days = 13,200 requests/month.
- Bursty office-hour demand matters more than monthly averages.
- With arrival rate `lambda` and average in-system duration `W`, Little's Law gives `average_in_flight ~= lambda * W` in a stable system.
- At 0.5 requests/s and average 10 s duration, about 5 requests are in flight. This does not imply five GPU slots always suffice: bursts, long-tail context and tool work need headroom.

Measure input/output distribution, generator residence time, tools and queueing separately. Multi-call agents increase service demand. Reserve capacity for interactive requests instead of letting ingestion/training consume it.

Report maximum sustainable throughput **at an agreed p95 latency and error rate**, not unconstrained tokens/second.

## 5. Local economics

```text
monthly_local_cost
  = hardware_cost / amortization_months
  + electricity + cooling + maintenance
  + hosting/storage/network + operations_labor
```

Cloud GPU alternative:

```text
monthly_gpu_rental = allocated_gpu_hours * quoted_hourly_rate
```

Allocated time may include idle service availability. A GPU occupied 24/7 costs more than occasional batch rentals even if average utilization is low. Compare a local model that meets quality targets; a cheaper model with worse outcomes can cost more per useful result.

Privacy and offline requirements may justify local hosting even before pure financial break-even.

## 6. Training economics

Estimate compute from measured tokens/second or sustained training FLOP/s, then include experiments, data work, retries, post-training and evaluation. Initial training is not the whole lifecycle cost.

For the illustrative from-scratch calculation in [training.md](training.md), 117,000 GPU-hours at an assumed $3/GPU-hour would be about $351,000 **compute only**, before overhead and other work. This is not a procurement quote or a frontier-model budget estimate.

Adapter training can be dramatically smaller, but annotation/evaluation and integration may exceed raw GPU costs. Make a small experiment budget before committing.

## 7. Cost controls

- Enforce tenant/request quotas and a hard spend budget.
- Cap context, output, repair loops, fan-out and tool calls.
- Cache only with correct tenant/version/ACL keys and measured invalidation.
- Route easy tasks to cheaper models only after quality tests.
- Use deterministic tools instead of asking the model to simulate compilers/tests.
- Batch ingestion/embeddings; keep them off the interactive serving critical path.
- Stop runaway or redundant agents with task deadlines.
- Track cost by successful task class, not only aggregate spend.

When a cap is reached, report incomplete work; do not fabricate an answer to look successful.

## 8. Procurement gate

Before committing to hardware or provider contracts, compare at least:

1. Approved hosted generator plus RAG.
2. Small local quantized generator plus RAG.
3. Hybrid routing if policy permits.

Require measured quality, privacy approval, latency/capacity, operational effort, monthly total cost, and rollback/exit options. See [hardware.md](hardware.md) and [success-metrics.md](success-metrics.md).
