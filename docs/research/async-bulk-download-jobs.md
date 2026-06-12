# Async Bulk-Download Jobs — Build-to-R2-Artifact Path (Research)

**Date:** 2026-06-12
**Scope:** The deferred async seam past the live-stream bulk-download path: very large zip bundles switch from a live Worker stream to a **build-to-R2-artifact job → signed URL**, so a dropped connection doesn't waste the whole transfer and the download is retryable. Resolves the four knobs ADR-0082 parked with "no timeline home yet": the **live→async threshold**, the **job lifecycle**, **artifact TTL/cleanup**, and **identical-bundle dedup**.
**Companions:** [`slice-1-1-file-manager-storage.md`](slice-1-1-file-manager-storage.md) §B (the live path this extends; open question 4) · [`upload-malware-scanning.md`](upload-malware-scanning.md) (sibling Hardening research — same Queue/Container/DO machinery, content-keyed cache pattern).
**Purpose:** Take the async seam from "documented but unresearched" to a concrete, buildable design, so a Phase 2 file-manager slice can claim the build without a cold start. Input to that slice's design cycle, not a substitute for its ADR.
**Status (owner, 2026-06-12): RESEARCH COMPLETE — design resolved; build home = slice 2·1** (claimed by the owner 2026-06-12; 2·1 already owns the Queue/Container/Durable-Object file-pipeline machinery). The four knobs are resolved below with verified Cloudflare mechanics. The live→async **threshold** ships as a config knob in slice 1·1 (ADR-0082); the async **build** itself is what awaits a phase. No new ADR is written here — the resolved design is the evidence base for the slice that claims it.

## Already decided — do not revisit (ADR-0027, ADR-0082)

The live path is settled and ships in slice 1·1: **`client-zip`** (MIT, pinned) streaming **store-mode ZIP64**, per-entry CRC-32 via streaming data descriptors, entries fed directly from R2 `get()` bodies (memory-flat at any size), **version keys resolved at request time** (consistent snapshot), **only `clean` versions eligible**, single-file selections download directly (never wrapped), access-checked + audit-logged (ADR-0068). Streaming a store-mode zip is **I/O-bound** (CRC-32 the only CPU work). The one accepted failure mode the async path fixes: **a client disconnect mid-stream wastes the whole transfer.** No compression (legal corpus already compressed). This research only fills the async seam below it.

## The four knobs — resolved

### 1. Live→async threshold — a two-dimensional config knob (defaults to tune, not derive)

**Key update (verified):** the old **1,000-subrequest** Worker cap — which would have force-async'd any bundle over ~1,000 files (each R2 `get()` is a subrequest; R2/D1/KV/DO binding ops all count) — **changed in Feb 2026**. Paid Workers now default to **10,000 subrequests/invocation, configurable up to 10 million** via `wrangler` (free plan stays 1,000 to Cloudflare services). So **file count is no longer the hard live-path ceiling it was** — a live stream of several thousand files is now viable on a Worker.

That moves the real driver to **retryability / dropped-connection waste**, not subrequest budget. The threshold is therefore two config knobs, async past **either**:

- **`liveMaxFileCount`** — soft; default conservative (~1,000–2,000) to leave subrequest headroom for the access checks/metadata reads in the same invocation, well under the 10k budget. Files beyond this either raise the configured subrequest limit or go async.
- **`liveMaxTotalBytes`** — the dominant driver; default ~2–5 GB. Past this, a mid-stream disconnect wastes enough work that build-to-artifact-then-retryable-link wins.

Both ship as config in slice 1·1 (ADR-0082) and are **tuned against the load-profile harness later (golden rule 10)** — the defaults above are conservative starting points to measure, not derived values.

### 2. Job lifecycle — Durable-Object-coordinated, Worker-built, Container-escalated

- **Trigger:** a request past the threshold doesn't stream; it resolves the version-pinned manifest, computes the dedup key (§4), and routes to a **Durable Object keyed by that bundle hash** — the single coordinator for this exact bundle.
- **Build executor:** the async build is the _same_ I/O-bound streaming work as the live path, writing to R2 instead of the client. So v1 runs it in a **queue-consumer Worker** (`bundle-build` queue) streaming R2 `get()` → `client-zip` → **R2 multipart PUT** at `bundles/<hash>.zip` — reusing the proven streaming code, **no standing Container** (unlike malware scanning, this tier has near-zero fixed cost). The existing **Container tier is the escalation seam** for the rare bundle that exceeds Worker CPU/duration — not the default.
- **Status model:** the DO owns job state (`pending → building → ready | failed`) in its isolated storage; the client polls (or is notified) and, on `ready`, receives a fresh short-TTL **presigned GET URL** (`aws4fetch`, already pinned per ADR-0081) scoped to the single artifact key. Same access-check + audit-log discipline as the live path (ADR-0068).
- **Resilience:** the build is **deterministic given pinned version keys**, so a dead job retries from scratch (queue redelivery; idempotent — re-PUT the same `bundles/<hash>.zip`). A **DO alarm** guards stuck jobs (timeout → mark failed / re-enqueue, with the alarm's automatic exponential-backoff retries).

### 3. Artifact TTL / cleanup — native R2 lifecycle rule, DO-alarm belt

- **Primary (zero-ops): an R2 object lifecycle rule** on the `bundles/` prefix — auto-delete after N days (recommend **7**). Verified: R2 supports up to 1,000 prefix-scoped lifecycle rules; objects are removed within ~24 h of the rule's condition. The built bundle is a **recomputable derived cache** (the ADR-0082 item-4 derived-vs-original class — see [eviction-policy research]), never an original, so a short TTL is correct: it can always be rebuilt from the pinned versions.
- **Belt-and-suspenders:** the DO alarm (or the 0·4 cron) sweeps stale **job/DO state** and expired signed-URL records; the bytes themselves are reaped by the lifecycle rule. Note the rule's granularity is days/within-24h — fine for "keep 7 days," too coarse for sub-day TTL (use a DO alarm if a tight TTL is ever needed).
- **Signed-URL TTL is independent and short** (minutes–hours): the artifact persists N days so the user can re-request a link; each link is short-lived.

### 4. Identical-bundle dedup — manifest-hash content key, per-firm, DO-coordinated

- The bundle is **deterministic given (sorted set of file-version keys + zip params)** because versions are pinned at request time. The dedup key is therefore **SHA-256 of the canonical manifest** (sorted version keys + format params) — the artifact lives at `bundles/<manifest-hash>.zip`. This is the same **content-keyed cache** pattern already adopted for the load-profile snapshots (ADR-0083).
- **On request:** compute the hash → if `bundles/<hash>.zip` exists and is unexpired, **return a fresh signed URL immediately, no rebuild**; else route to the DO to build.
- **Race/coordination:** two identical requests hash to the same key → the **DO keyed by that hash** is the natural single-flight coordinator: one build runs, both requests await it. The dedup point and the job coordinator are the same object.
- **Isolation:** dedup is **within the firm's own R2 bucket** (per-firm isolation, golden rule 3) — no cross-firm dedup, which is also the correct privilege boundary. The manifest hash never spans firms.

## Cost — negligible, no standing infrastructure

Unlike the malware scanner (a standing warm Container), the async build has **near-zero fixed cost**: queue-consumer Workers run only when building, the Container is an outlier-only escalation, and the artifact is a short-lived R2 object. R2 storage for a 7-day-retained few-GB bundle ≈ cents (R2 at ~$0.015/GB-month, prorated), and **R2 egress is free**, so the signed-URL download costs nothing in bandwidth. Dedup means repeat requests for the same bundle cost a HEAD + a signed URL. The whole tier is effectively free at MVP scale.

## Open / build-time items (for the claiming slice)

- **Threshold defaults** — confirm `liveMaxFileCount` / `liveMaxTotalBytes` against the load-profile harness once 1·1 file volume exists (golden rule 10).
- **Notify vs poll** — whether `ready` is delivered by client poll, the Notifications subsystem (ADR-0059), or an SSE/WebSocket push; poll is the no-dependency v1.
- **Build executor escalation point** — the bundle size/duration at which the queue-consumer Worker hands off to a Container; a measured seam, not a guess.
- **Interaction with version-history delta storage** (ADR-0077) — bundles read whatever the version key resolves to; if superseded versions move to delta-encoded IA objects, the build reconstitutes them on read (a read-path concern owned by the data-access layer, not the bundler).
- **Hold/retention interplay** — a bundle is a transient export of `clean` versions; bucket-lock/legal-hold rules take precedence over the lifecycle delete (verified), so a held _source_ is unaffected by bundle expiry (the bundle is a copy, not the evidence).

## Method & sources

Grounded in the settled live-path decisions (ADR-0027, ADR-0082) and the slice 1·1 research §B; targeted verification of the Cloudflare mechanics that drive the four knobs (subrequest limits, R2 lifecycle rules, DO alarms). Confidence high — all primary Cloudflare docs/changelogs. Container pricing reused from [`upload-malware-scanning.md`](upload-malware-scanning.md).

- [Workers are no longer limited to 1000 subrequests (changelog, 2026-02-11)](https://developers.cloudflare.com/changelog/post/2026-02-11-subrequests-limit/) — 10k default, up to 10M; R2/D1/KV/DO binding ops count as subrequests
- [R2 Object lifecycles (docs)](https://developers.cloudflare.com/r2/buckets/object-lifecycles/) — prefix-scoped delete-after-N-days, ≤1000 rules, ~24 h processing, bucket-lock precedence
- [Durable Objects Alarms (docs)](https://developers.cloudflare.com/durable-objects/api/alarms/) · [Alarms announcement](https://blog.cloudflare.com/durable-objects-alarms/) — scheduled wake-up, automatic exponential-backoff retries, one-alarm-via-storage pattern
- [Touffy/client-zip (GitHub)](https://github.com/Touffy/client-zip) — the pinned store-mode ZIP64 writer (live + async build)
