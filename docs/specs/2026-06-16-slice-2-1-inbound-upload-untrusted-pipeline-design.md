# Slice 2·1 — Inbound upload path + untrusted-file pipeline + async bulk download — Design

**Status:** Design (brainstormed). **Phase 2, slice 2·1.** Reserves **ADR-0100** (scan engine & execution architecture), **ADR-0101** (untrusted-file hardening & uninspectable-file policy), **ADR-0102** (async bulk-download build job). Home concept: white paper, _Matters and File Manager_.

**One-line goal:** Turn the launch-stub upload pipeline into a real one — a self-hosted, detection-only malware-scan engine, the untrusted-file hardening the launch ingest left on paper, and the async bulk-download build job — all as deltas on the working slice 1·1 seams.

---

## 1. Goal & scope

Three concrete deltas on the file-manager machinery slice 1·1 already shipped:

- **A — Scan engine.** Replace the `unscanned` launch adapter behind `MalwareScanPort` with a real engine in a Cloudflare Container (ClamAV + yara-x + our Rust structural heuristics). Detection-only, self-hosted, no data-holding SaaS.
- **B — Untrusted-file hardening.** The decompression-bomb / nested-archive / inspectable-size gates the launch ingest lists but does not enforce, plus the uninspectable-file policy.
- **C — Async bulk-download build job.** The build-to-R2-artifact path past the live-stream threshold knobs 1·1 already records but does not act on.

**Why now:** this is the foundation Discovery ingest (Phase 5) and the client-portal contributed-file path (Phase 6) both gate on, and the bulk of it is consolidation of decided research, not open design.

**Out of scope:** Content Disarm & Reconstruction (decided out at launch); the SvelteKit File Manager upload UI (rides the UI track); the Notifications subsystem (named as a seam, built elsewhere).

---

## 2. Baseline — what slice 1·1 already provides (not rebuilt)

The entire upload → ingest → commit → download skeleton ships and is wired end-to-end:

- **Uploads:** presigned PUT + resumable S3 multipart (`apps/worker/src/routes/files/uploads.ts`, `apps/worker/src/files/presign.ts` over `aws4fetch`); the `upload_session` lifecycle in `packages/file-manager/src/file-service.ts`.
- **Status gate:** `file_version.status` (`pending`/`clean`/`quarantined`) + `scan_verdict` (`unscanned`/`clean`/`infected`); every read filters `status = 'clean'`, enforced by a source-scan fitness function. Promotion is a status flip — zero bytes move.
- **Scan port:** `packages/file-manager/src/scan-port.ts` — `MalwareScanPort.scan(stream, meta) → { verdict, engineVersion }`; the launch `unscannedAdapter` is the exact seam this slice replaces.
- **Ingest:** `packages/file-manager/src/ingest-core.ts` (`runIngest`) tees the object body once into head-sniff + streaming SHA-256 + the scan port; the `files-ingest` queue consumer (`apps/worker/src/files/ingest-consumer.ts`) commits or quarantines exactly-once.
- **Policy:** `packages/file-manager/src/upload-policy.ts` enforced at presign (declared) **and** at the gate (sniffed).
- **R2-event → queue wiring:** `configureBucketNotifications` on the `FirmResourceProvider` port.
- **Bulk download:** live-stream store-mode ZIP64 (`apps/worker/src/routes/files/downloads.ts` over `client-zip`); the pure `resolveZipSelection`; the `zipAsyncThreshold` is recorded in audit metadata but not yet acted on.
- **Metering:** exact D1 `storage_meter` + daily R2-LIST reconciliation.

---

## 3. Part A — Scan engine (ADR-0100)

A **Rust orchestration service in a Cloudflare Container** implementing `MalwareScanPort`, swapped in for `unscannedAdapter` in the ingest consumer:

- **ClamAV** driven over a **socket** (`clamav-client`) — _not_ libclamav FFI; the C engine stays in its own process for isolation. Signatures from freshclam/Talos feeds.
- **yara-x** (pure-Rust) with the YARA-Forge-Core rule feed.
- **Our Rust structural heuristics** — `lopdf` for PDF active content (`/OpenAction`, `/JS`, `/Launch`, `/EmbeddedFile`); `cfb` + `zip` / `quick-xml` for Office macro/OLE detection.
- The three combine into one verdict: `clean` → commit; `infected` → quarantine; `unscanned` → policy (§5).
- **Scope:** Office + PDF document formats at launch. **Detection-only — no CDR.** Rules are _pulled_ from public feeds; we author none. The structural heuristics are static format facts we own.
- **CI validator:** EICAR through the full pipeline (upload → ingest → scan → quarantine) is the end-to-end proof.

### Execution architecture (split lanes; strict gate deferred)

The `files-ingest` consumer keeps calling the scan port synchronously. Fairness comes from **two ingest lanes keyed by R2 prefix**:

- Interactive uploads write under `files/`, bulk-import uploads under `bulk/` (the prefix is chosen server-side at presign, since keys are server-minted).
- Each prefix gets its own R2-event rule → its own queue, consumed by the **same consumer code** with a **lower `max_concurrency` on the bulk lane**, so a firm bulk-importing thousands of documents never blocks another firm's interactive drag-and-drop.
- The `bulk/` objects still **meter under the existing `files/` logical dimension** — the storage meter is a logical bucket, not the literal key prefix — so the metering model is unchanged and only the scheduled reconciliation LISTs the extra prefix. The lane benefit is queue topology, not a storage-model change.
- Bounded global Container concurrency is the cap; the per-firm in-flight cap is approximate (queue-consumer concurrency), not a hard guarantee.

**Deferred seam (the strict-fairness upgrade):** a per-firm Durable Object admission gate (leased slots + alarm-based leak reclamation) gives a _strict_ per-tenant concurrency cap and ordering. It is **not built now** — the queue-consumer shape does not change to add it later, so it is deferred until real multi-tenant load measures the need (golden rule 10). The everyday user benefit (interactive feels fast under load) is already captured by the lanes; the DO only adds guarantees that a single-firm launch will not exercise.

---

## 4. Part C — Async bulk-download build job (ADR-0102)

Past the `liveMaxFileCount` / `liveMaxTotalBytes` knobs 1·1 already records, `POST /v1/downloads/zip` routes to a build job instead of streaming:

- A **Durable Object keyed by the manifest-hash** coordinates the build (`pending → building → ready | failed`); a DO alarm guards stuck jobs; it is the **single-flight** coordinator, so concurrent identical requests share one build.
- A **`bundle-build` queue-consumer Worker** streams R2 `get()` → `client-zip` → **R2 multipart PUT** at `bundles/<manifest-hash>.zip`, reusing the live-stream composition code. A Container is escalation-only (outlier bundles), never the default.
- **Dedup:** the manifest-hash (SHA-256 of the sorted version keys + zip parameters) is the content key, **within the firm's own bucket only** (never cross-firm). On request: HEAD the existing artifact → mint a fresh signed GET, else build.
- **Lifecycle:** a native R2 lifecycle rule on the `bundles/` prefix deletes artifacts after ~7 days; the signed-GET TTL is independent and short.
- The threshold is two knobs (`liveMaxFileCount` ≈ 1–2k, `liveMaxTotalBytes` ≈ 2–5 GB); async past **either**. The driver is dropped-connection waste, not the subrequest budget.

---

## 5. Part B — Untrusted-file hardening (ADR-0101)

The gates the launch `runIngest` lists but does not enforce, plus the uninspectable-file policy.

### Uninspectable-file policy (the product-meaningful fork)

Some files cannot be inspected. The policy splits on whether the inability _correlates with risk_:

- **Benign-uninspectable → commit as `unscanned` with a visible "not scanned" badge** on the file version:
  - **Password-protected / encrypted** documents (common and legitimate in legal practice — opposing counsel and clients routinely send them).
  - **Files over the scanner's inspectable-size cap** — a large legitimate file (e.g. a video or dataset) is not suspicious for being big.
  - **Future seam:** let staff supply a password to trigger a re-scan.
- **Suspicious-uninspectable → quarantine-hold** (never auto-served, never auto-deleted — potential evidence):
  - A **decompression-bomb signature** (compressed-to-uncompressed expansion ratio over a guard).
  - **Archive nesting depth** over the cap.
  - **Archive entry-count** over the cap.
- **Active content → commit as `clean` with an "active-content" badge** (PDF JavaScript, Office macros). Active content is _not_ uninspectable and is _not_ a standalone quarantine trigger — it is common in legitimate legal documents (fillable court PDFs with calculation scripts, macro-enabled templates). The safe-delivery sandbox (slice 2·3) and the extension blocklist are the execution defenses; the badge warns staff. It escalates to quarantine only when a signature or bomb signal co-occurs — active content _amplifies_, it does not gate alone.

This keeps the common legitimate case frictionless and honest while treating the cases that _look like_ evasion as quarantine.

### Caps (recommended defaults — knobs, build-tuned against ClamAV limits, recorded)

- Inspectable-size cap ~2 GiB (over → benign-uninspectable, commit + badge).
- Archive recursion depth ≤ ~16 levels (over → quarantine).
- Per-archive uncompressed-size ceiling and entry-count ceiling (over → quarantine).
- Compressed:uncompressed expansion-ratio guard (over → quarantine).

Concrete numbers are configuration, tuned at build against ClamAV's own scan limits and recorded — not doctrine. The _policy_ (what a limit-hit means) is the decided part.

---

## 6. Cross-cutting

- **Bundle-ready delivery: client poll (v1).** A job-status endpoint the client polls for `ready` + the signed URL. The Notifications subsystem (not yet built) is the named push seam for later.
- **Re-scan sweep: a weekly bounded-fan-out cron** re-queues `unscanned`-verdict versions after signature updates (signatures improve; today's `unscanned`/`clean` may warrant re-evaluation). A signature-feed-triggered sweep is a future seam.
- **Warm-pool: one always-warm 4 GiB Container instance + burst scale-to-zero**, tuned against the load-profile harness — not fixed in the spec. ~$35–50/mo all-in at launch scale (the async download tier is effectively free — R2 egress is free).
- **Verdict observability:** clean/infected/quarantine rates onto the slice 0·6 telemetry pipeline (Analytics Engine); a **staff alert on quarantine** via the Notifications seam (named, not built).

---

## 7. Decided — do not reopen (from completed research)

Scan-engine roster (ClamAV + yara-x + own Rust heuristics); detection-only, **no CDR at launch**; **no data-holding SaaS** (self-host-first is non-negotiable); rules pulled from public feeds, never authored; ClamAV over socket, not FFI; **quarantine never auto-deletes** (evidence; destruction is hold-blocked); `unscanned` commits (explicit policy); the two bulk-download threshold knobs; artifact TTL ~7 days; per-firm manifest-hash dedup; async build = queue-consumer Worker (Container escalation-only); the dual metering model (exact D1 authoritative, Analytics Engine for trends).

Research homes: [`docs/research/slice-1-1-file-manager-storage.md`](../research/slice-1-1-file-manager-storage.md), [`docs/research/upload-malware-scanning.md`](../research/upload-malware-scanning.md), [`docs/research/async-bulk-download-jobs.md`](../research/async-bulk-download-jobs.md).

---

## 8. Load-profile extension (accretion rule, ADR-0078/ADR-0083)

The slice extends the volume harness in-area: a scan-verdict distribution (clean/infected/unscanned/quarantined) across the generated file versions, quarantine rows, and bundle-build jobs join the measured set, so verdict-skew and bundle-build cost are measurable.

---

## 9. Open items to resolve at plan time

- Concrete cap numbers, tuned against ClamAV's scan limits and recorded.
- The socket protocol between the ingest Worker and the scan Container, and the Container spawn mechanics (scale-to-zero invocation from the consumer).
- Whether the scan Container stands alone or later shares an image with the Phase 2 OCR / LibreOffice Container tiers (a future-reuse question, not a launch blocker).
- Multipart part-size + resume semantics for the R2→R2 bundle build.
- Threshold defaults confirmed against the load-profile harness once 1·1 file volume exists (golden rule 10).

---

## 10. References

- White paper: _Matters and File Manager_, _Inline file preview_ (the safe-delivery sandbox in slice 2·3 still guards rendering of anything committed `unscanned`), _Document versioning & storage tiering_, _Performance & concurrency model_.
- Slice 1·1 design: [`2026-06-11-slice-1-1-matters-locations-file-manager-design.md`](2026-06-11-slice-1-1-matters-locations-file-manager-design.md) (ADR-0081 upload path, ADR-0082 bulk download).
- ADR-0078 (cheap seams up front), ADR-0083 (load-profile harness), ADR-0003 (firm-scoped data-access), ADR-0017/ADR-0038 (observability & no third-party SaaS for privileged content).
