# Scan throughput — decision record + the sound horizontal plan

**Status:** Decision (defer the prefilter) + forward plan · **Date:** 2026-06-22 · **Owner:** Trevor Goldsmith
**Supersedes the speedup goal of:** [`2026-06-20-scan-engine-design.md`](2026-06-20-scan-engine-design.md) and its corrections doc (the prefilter design). The safety/transport/extraction work from that effort is **kept** (see "Banked").

---

## Decision: the SIMD-prefilter cannot beat the matcher floor SOUNDLY — defer it

The slice 2·1 goal was to beat ClamAV's ~15 MiB/s matcher floor with a custom engine. A prefilter (clear clean files so they skip clamd) was built through `build-atoms` and **measured against the real CVD**. The result is conclusive and negative:

- `build-atoms` over the real DB: 463,686 atoms, 541,956 hashes, **275,361 unprefilterable signatures**, `fall_through_targets = [0,1,2,3,4,5,6,7,9,10,11,12]` → **100% fall-through today**.
- A ceiling measurement of the best-possible expression-aware coverage (C11): it lifts ~89% of `.ldb` sigs, **but ~1,234 ANY-targeted (TargetType 0) signatures are irreducible** (OR / count / negation / byte-compare / macro logic with no necessary literal). TargetType 0 applies to **every file**; a _sound_ prefilter clears a file only by ruling out _all_ applicable signatures; one irreducible ANY signature ⇒ universal fall-through. Plus the classes we cannot cheaply reduce (`.mdb`/`.imp` PE-substructure hashes, `.cdb`, `.cbc`, `.idb` image-fuzzy, `.pdb` phishing) inherently force `{1,2,3,4,5,6,7,9}`.
- Therefore **even a perfect C11 + C9 leaves `fall_through_targets` = all 12 types → 100% fall-through, zero speedup.** The 218 MiB/s raw atom-scan is real but unreachable (the completeness gate fires first, every file). The only way to "use" it is an **unsound** prefilter (false-clean risk) — unacceptable for a malware firewall.

**Root cause (general, not a bug):** ClamAV's signature set contains ~1,234 ANY-typed signatures whose match condition has no cheap necessary precondition. A sound single-file prefilter over that set cannot exist. Single-file scanning of _unique_ content is irreducibly capped at clamd's matcher rate.

This was established in ~5 minutes of measurement (spike-first) rather than weeks of building C11/C9 — the value of de-risking before building.

## Banked (sound, committed, reused — not wasted)

- **Option B transport** (`38a8afd`): spool body → clamd scratch file + mmap; ~2×→~1× peak RAM, enabling more instances per box.
- **`atoms.rs` + `build-atoms`** (`845efd3`, `8b71d95`): a correct, **fail-closed, self-maintaining** ClamAV signature parser/extractor. It fails loud on any unmodeled DB class (proven live: caught `.hdu` and a fake `.qdb`), so "download the new DB and re-extract" is safe with no rule-writing. **Reusable for content dedup + triage** (below), even though it cannot soundly clear files.
- The investigation + design + corrections + spike records.

---

## Forward plan: hit the throughput goal SOUNDLY via the Container fleet (mostly already wired)

Scanning is async/background (quarantine-until-clean) — it never blocks a user — so the throughput that matters is **files/sec in aggregate**, which scales horizontally. ~80% of the machinery already exists in the worker.

### Already built (prior 2·1)

`apps/worker/`: `ingest-consumer.ts`, `container-scan-adapter.ts`, `scan-container.ts`, `scan-port-binding.ts`, `scan-warm.ts`; `wrangler.jsonc` queue topology with **two lanes** — `FILES_INGEST` (interactive) and `FILES_INGEST_BULK` (bulk migration, `max_concurrency: 2`), each with a dead-letter queue. Flow: `R2 event → Queue → ingest-consumer → container-scan-adapter → scan Container (clamd) → verdict`.

### The throughput model (5 TB, 1000 matters, KB–2 GB files)

The scan unit is a **file** (one queue message → one `/scan` to a fleet instance). Aggregate = `concurrent_scans × per-scan-rate`. A 2 GB file is one unshardable ~2.3-min scan but runs _in parallel_ with everything else, so wall-clock ≈ `total_bytes / aggregate`, not the slowest file:

| Concurrent scans | Aggregate  | 5 TB wall-clock |
| ---------------- | ---------- | --------------- |
| 2 (today)        | ~30 MiB/s  | ~48 h           |
| 100              | ~1.5 GiB/s | ~56 min         |
| 500              | ~7.5 GiB/s | ~11 min         |
| 1000             | ~15 GiB/s  | ~5.5 min        |

### Work items

1. **Deploy the scan Container** (ops — `operations.md` §9 runbook): add the `containers` block to `wrangler.jsonc` (`ScanContainer` class, `instance_type` standard-3/4, `max_instances` high for bursts), the DO binding, the `v2` migration tag; `wrangler deploy` builds the image (freshclam bakes the DB) and `build-atoms` is wired into that build. **Requires the Cloudflare account** — a deploy-time step, not code.
2. **Raise the bulk-lane concurrency** (config): bump `FILES_INGEST_BULK` `max_concurrency` (2 → tens/hundreds) and the Container `max_instances` so the fleet saturates during a migration. A dial, not new code.
3. **Bulk-migration enqueue** (code, buildable now): on a firm migration, enumerate the firm's R2 objects and enqueue one scan job per file to the bulk lane (or rely on R2 event notifications). Small worker addition.
4. **Per-firm content dedup / scan-once** (code, buildable now — the one genuinely-new sound engine-side speedup): a per-firm `content_sha256 → verdict` cache (KV or D1); a file whose content hash was already scanned-clean skips clamd. Sound by construction (identical bytes ⇒ identical verdict, for a given DB version — key the cache by DB version too). Real win for duplicate-heavy migration (~20–40%). **Cross-firm dedup is forbidden** (ADR-0003 tenancy); per-firm only.
5. **Warm-pool sizing + cold-start** (config): size `scan-warm.ts`'s warm pool so a burst doesn't pay clamd's DB-load cold-start on every instance; the Dec-2025 DB retirement (~half the automaton) eases this.
6. **Per-firm fairness across simultaneous migrations** (refinement): today one global bulk lane is FIFO; add per-firm concurrency caps if multiple firms migrate at once so one cannot monopolize the fleet.

### Constraints to size against (measure)

- Cloudflare **container instance cap** per account (verify the current 2026 limit) — the aggregate ceiling, but GB/s territory.
- **Memory per 2 GB scan**: 2 GB mmap + clamd's resident DB ⇒ standard-4 (12 GiB) runs a few concurrent 2 GB scans but many small ones; the Queue self-balances.
- **R2 read bandwidth** under high concurrency (aggregate scales with parallel reads; per-stream is tens of MB/s).
- **Cost**: burst billed only while scanning (~$5 CPU for a ~500k-file / 5 TB migration + burst memory) — cheap, one-time.

**Net:** the throughput goal is met **soundly** by deploy + concurrency tuning + the dedup cache — no custom matcher. Buildable-now items: #3, #4 (+ the #2/#5/#6 config). Deploy (#1) is the owner's Cloudflare step.
