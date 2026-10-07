# Data Strategy

Data quality dominates model and RAG quality. This covers sourcing,
licensing, cleaning, and governance for both **training data** and the **RAG
corpus**.

## 1. Data types
| Data | Used for |
|------|----------|
| Source code corpora | pre‑training / continued pre‑training / SFT |
| Instruction / task data | SFT, agent behavior |
| Preference pairs (accepted vs. rejected) | DPO/RLHF |
| Documentation (internal + external) | RAG corpus, doc‑grounding |
| Eval datasets | benchmarks (kept separate!) |
| Production traces + feedback | eval mining + future training |

## 2. Sourcing
- Internal: your repos, docs, wikis, past tickets/PRs (with consent).
- External: permissively licensed open code, public docs, official API refs.
- Synthetic: model‑generated, **execution‑verified** examples.

## 3. Licensing & copyright (critical)
- Only train on data with compatible licenses; **track license per source**.
- Exclude non‑permissive/unknown‑license code from training.
- For RAG, respect doc licenses and terms; store provenance + URL.
- Watch output‑side contamination (generated code resembling restricted
  sources) — see [security-privacy.md](./security-privacy.md).

## 4. Cleaning pipeline
1. **Dedup** (exact + near‑dup / MinHash) — reduces memorization + waste.
2. **PII & secret removal** (keys, tokens, emails) before storage/training.
3. **Quality filtering** (heuristics + model scoring; drop junk/auto‑gen).
4. **Language/domain balancing** to match target usage.
5. **Toxicity/unsafe filtering.**
6. **Decontamination** against all eval sets (prevents inflated scores).
7. **Provenance tagging** (source, license, version, timestamp).

## 5. RAG corpus pipeline
- Normalize HTML/MD/PDF/docstrings → clean text + metadata.
- Source‑aware chunking (code‑aware vs. prose); attach version + symbol + URL.
- Embed + index (dense + BM25); re‑index on doc change.
- Version documentation so answers can be version‑pinned.
- Detect + handle conflicting/outdated docs.

## 6. Data versioning & lineage
- Version every dataset + corpus snapshot; immutable, reproducible.
- Track lineage from raw → cleaned → training/index → model/index version.
- Register datasets alongside models ([design.md](./design.md) §4).

## 7. Feedback data loop
Production traces + accept/reject/edit signals
([monitoring-strategy.md](./monitoring-strategy.md)) →
- hard/failed cases → **eval set** ([benchmarks.md](./benchmarks.md));
- accepted edits → **SFT** candidates;
- accepted‑vs‑rejected → **preference pairs** for DPO/RLHF.
Honor privacy/opt‑in before any training use.

## 8. Governance
- Data sheets per dataset (source, license, size, filters applied).
- Access controls + retention policy per data class.
- Opt‑in/opt‑out for user data; honor deletion requests.
- Audit trail for what data trained which model.
