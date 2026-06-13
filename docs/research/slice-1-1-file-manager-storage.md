# Slice 1·1 — File Manager: Upload Path & Storage Foundations Research

**Date:** 2026-06-11
**Scope:** The genuinely-open, design-blocking threads of slice 1·1 (Matters core + Locations + File Manager): the **inbound large-file upload path** (white paper _Matters and File Manager_ — "Needs development", "likely its own ADR"), the **streaming ZIP64 bulk-download implementation** (ADR-0027 decides the approach, not the how), the **derived-vs-original artifact class** (ADR-0078 item 4, parked for research), the **per-firm storage-metering** design inputs (ADR-0078 item 3), and a **matter-numbering** survey for the configurable-numbering schema. Input to the slice 1·1 **design** cycle, not a design.
**Purpose:** Verify the platform mechanics on the current Cloudflare runtime (golden rule 11) and resolve the open questions into concrete recommended architectures the design cycle can ratify or amend.

## Relationship to what is already decided

Settled and **not** revisited here: the matter shell, configurable numbering with optional location segment, matter types, and Prospective→Open→Closed lifecycle (ADR-0007); Locations as a per-firm dimension (ADR-0031); app-managed version objects with `current`-overwrite + deliberate version-cutting + Standard→IA tiering (ADR-0035); **content hash (SHA-256) on every object** and the storage-metering rollup as build-when-in-the-area foundations (ADR-0078 items 1, 3); the **bulk-download approach** — Worker streams R2 → store mode → ZIP64, version-pinned, with an async-job seam for very large bundles (ADR-0027); the delta-storage seam (`storage_encoding`, ADR-0077); the malware-scan port with deferred engine and the quarantine-on-arrival pipeline shape (white paper threat model); and inline preview via signed URLs (ADR-0029). This research fills the layer below those decisions.

## Method & sources

Primary Cloudflare docs (R2 limits, R2 multipart from Workers, R2 event notifications, Workers platform limits, Analytics Engine limits, Workers Streams) plus the `client-zip` project and practitioner write-ups on streaming ZIP64 in Workers, the tus-vs-S3-multipart trade for R2, and Clio's matter-numbering guidance. Confidence high on the platform limits and the ZIP64/upload mechanics (primary docs); medium on a couple of throughput figures (flagged). Full URLs in [Sources](#sources).

---

## A. Inbound upload path — the primary open decision

### A.1 The forcing function — Worker body caps

The request-body limit is set by the **account plan, not the Workers plan**: **Free/Pro 100 MB, Business 200 MB, Enterprise 500 MB** (Enterprise can request higher). Worker memory is 128 MB. Legal uploads (discovery dumps, video, scanned PDFs) routinely exceed this. **Conclusion: bytes for anything but trivially small files must not transit the Worker** — the Worker authorizes and mints credentials; R2 receives the bytes directly. This is the symmetric inbound counterpart to the already-decided signed-URL download/preview (ADR-0029) and streamed bulk-download (ADR-0027) paths.

### A.2 Recommended architecture — uniform direct-to-R2, two transfer modes

A single principle (bytes go straight to R2, the Worker only authorizes) with two client transfer modes chosen by size:

- **Small files (single-shot):** Worker mints a **presigned PUT URL** (R2's S3-compatible API), scoped to the exact object key with a short TTL; the client PUTs directly. No credentials exposed. Use for files comfortably under the part-size/cap (e.g. ≤ ~100 MB).
- **Large / unreliable-network files (resumable):** **S3 multipart upload** against R2 — `CreateMultipartUpload` → presigned `UploadPart` URLs per chunk → `CompleteMultipartUpload`, orchestrated by the Worker. R2 multipart limits: **parts ≥ 5 MiB** (except the last), **≤ 10,000 parts**, **≤ ~4.995 GiB per part** (→ multi-TiB max object), and **incomplete uploads auto-abort after 7 days** (free orphan cleanup, but also a hard "must finish within 7 days" constraint). Resume = re-list uploaded parts and continue. Parallel part upload + per-part retry is the reliability win.

Recommend **uniform direct-to-R2 even for small files** (one code path, bytes off the Worker, and it composes cleanly with quarantine-on-arrival, A.4) rather than a split where small files stream through the Worker. Through-Worker ingest is kept only as a fallback for any future case that genuinely needs inline byte access before landing.

### A.3 tus vs S3 multipart — why multipart is the primary

Both work over R2, but **R2 has no native tus endpoint** (only Cloudflare _Stream_ speaks tus, for video). Adopting tus would mean running our own tus-server Worker that maps tus offsets onto R2 multipart — extra infrastructure for a protocol nicety. S3 multipart is "functionally identical to S3" on R2, needs no extra server component, and has mature browser clients (**Uppy's `AwsS3Multipart` plugin** is the obvious client library; Tauri uses native multipart on desktop). **Recommendation: S3 multipart as the resumable path; tus reserved** only if a future client wants the simpler resumable abstraction and we accept running the tus-shim. The browser orchestration cost of multipart (backend initiate / sign-parts / complete endpoints) is real but is exactly what the Worker authorization layer is for.

### A.4 Quarantine-on-arrival ingest pipeline

Because direct-to-R2 means no Worker sees the bytes inline, scanning and hashing are **async**, exactly as the white paper's pipeline specifies:

1. Bytes land at a **pending/quarantine key** (or with a `pending` flag) — **not visible, not servable, not indexed**.
2. **R2 event notification** (`object-create`, optionally prefix/suffix-filtered) → **Queue** → consumer Worker. (Up to 100 notification rules/bucket; queue throughput ~5,000 msg/s — split rules across queues if ever exceeded.)
3. The consumer does a **single read** of the object and performs everything that needs the bytes at once: **pre-acceptance gates** (magic-byte type check, size, decompression-bomb/nested-archive guards, filename sanitization), **malware scan** (via the deferred-engine port), **SHA-256 content hash** (ADR-0078 — the read is already happening; compute the hash here rather than a second pass), and the **upload short-circuit** check (A.5).
4. On **clear**: promote the object to its real key / clear the flag, commit the File Manager version record (with hash + scan verdict cached by hash), and index it. On **fail**: keep quarantined (never auto-delete — an infected discovery file is evidence; destruction is hold-blocked).

This makes the ingest consumer the single chokepoint where hash, scan verdict, and version commit all happen against one read — efficient and consistent.

### A.5 Upload short-circuit and the cross-matter dedup boundary

ADR-0078 lists an upload short-circuit ("these bytes are already held") but **cross-matter blob dedup is deliberately undecided** (existence leakage, refcounted destruction, hold semantics). These interact, and the design must respect the boundary:

- **Client-precomputed hash flow:** the client (browser Web Crypto / Tauri) computes SHA-256 locally and asks the Worker "do you already hold this hash _in this matter_?" before uploading. If yes, skip the byte transfer and create a new version/reference to the existing object. This is the bandwidth win (re-saving an unchanged attachment, the no-op version skip).
- **Scope it to within-matter (safe) — not firm-wide (needs the dedup design).** A firm-wide "we already have these bytes" answer leaks that _some other matter_ holds identical content — the exact ethical-wall / existence-leakage problem ADR-0078 defers. So the launch short-circuit answers only within the same matter (or is gated behind explicit same-matter scope). Firm-wide dedup stays the separately-designed feature.
- The no-op version skip (ADR-0078) is the pure within-document case and is always safe: same doc, unchanged hash on explicit Save → cut no version.

### A.6 Per-firm policy enforcement — two points

The per-firm **max-size + content-type allow-list** (Settings registry) is enforced **twice**, because the client controls the actual bytes:

- **At presign time:** the Worker refuses to mint a presigned URL / open a multipart session for a disallowed content-type or an oversize declared length.
- **At the gate (A.4):** magic-byte validation re-checks the real type (extension/declared-type can lie), and actual size is verified. A mismatch quarantines.

### A.7 Open decisions for the design (upload)

- The small/large cutover threshold and whether to truly go uniform-direct-to-R2 or keep a through-Worker small-file path.
- Presigned-URL TTL and key-scoping scheme (pending-key vs flag-on-real-key for quarantine).
- Whether v1 ships resumable multipart or starts single-PUT-only with the multipart seam reserved (discovery/video ingest may force multipart early).
- Client library: adopt Uppy `AwsS3Multipart` vs a thin in-house uploader.
- The presigned-URL mechanism: R2 S3 API presign requires an R2 access-key credential the Worker holds — confirm the credential-custody model (account-level S3 token vs scoped) fits the per-firm-bucket model (ADR-0075).

---

## B. Streaming ZIP64 bulk download — implementation

ADR-0027 fixes the approach; the implementation findings:

- **Use `client-zip` (MIT) rather than hand-rolling.** It is purpose-built for exactly this: streaming, **store-mode only** (no compression — matches ADR-0027's "legal files already compressed" rationale), **ZIP64 when needed** (v2; 4 EB/file, 18 ZB total ceilings — effectively unbounded), returns a **`ReadableStream` from `makeZip`**, and handles **CRC-32 computation and data descriptors internally** (the streaming trick: store mode still needs a per-entry CRC-32, which isn't known until the bytes are read, so the writer emits a streaming data descriptor after each entry rather than seeking — client-zip does this). It accepts per-entry async/stream inputs, so each R2 `get()` body streams straight through. It deliberately lacks encryption/extra-fields — irrelevant for our store-mode archive. This is well-trodden ground (multiple Workers-on-128 MB streaming-ZIP64 write-ups exist).
- **Version-pinning** (ADR-0027): resolve each selected file's R2 object **version key at request time** and stream those exact keys, so a concurrent edit can't make the archive inconsistent.
- **Single-file selection** downloads the object directly (signed URL / stream), never wrapped in a zip.
- **CPU vs wall-clock:** streaming a store-mode zip is I/O-bound (CRC-32 is the only CPU work), so a multi-GB live stream is fine on a Worker as long as bytes keep flowing — wall-clock streaming time is not the CPU limit. The real failure mode is a **client disconnect mid-stream wasting the whole transfer**.
- **The async-job seam** (ADR-0027, deferred to a threshold): past a configurable file-count/total-size threshold, switch from live-stream to **build-to-R2-artifact (Container/DO job) → signed URL**, so a dropped connection doesn't waste a huge rebuild and the download is retryable. v1 ships the live path; the threshold and the artifact TTL/cleanup are the design knobs.
- Every export stays **firm-scoped, RBAC + ethical-wall checked, audit-logged (metadata only)**; portal downloads reuse the engine behind portal auth (already decided).

### Open decisions (download)

- Adopt `client-zip` vs a ~200-line in-house store-mode ZIP64 writer (control vs dependency; client-zip is small and focused — lean adopt, pinned).
- The live→async threshold values and the async-artifact lifecycle (TTL, cleanup, dedup of identical bundle requests). **Resolved 2026-06-12 — see [`async-bulk-download-jobs.md`](async-bulk-download-jobs.md)** (threshold as config knobs; DO-coordinated Worker build; R2 lifecycle-rule TTL; manifest-hash dedup).

---

## C. Derived-vs-original artifact class (ADR-0078 item 4)

The parked question: recomputable artifacts (OCR text, format conversions, preview/CDR renditions, thumbnails, search indexes) are **caches, not archives** — should they inherit keep-forever IA tiering? Research framing and a recommended model (design-judgment, for the cycle to decide):

- **Introduce an `artifact_role` discriminator** on every stored object: **`original`** (uploaded or authored bytes — keep-forever, evidence, the existing tiering/hold/destruction lifecycle) vs **`derived`** (regenerable from an original + a known transform).
- **A derived artifact is defined by its regeneration recipe:** `{ source content hash, producing engine, engine version, parameters }`. Because the transforms are deterministic (same input + same engine version → same output), a derived artifact can be **evicted and regenerated on demand** — it carries no information an `original` doesn't. Recording the recipe also gives **automatic invalidation**: when the source's content hash changes (new version), stale derived artifacts are known-stale and regenerate.
- **Lifecycle: do not inherit keep-forever.** Derived caches should default to a **cache policy** — e.g. keep the current rendition, evict on access-age or storage pressure, regenerate on miss — and likely live in **Standard** (they're read on preview, not archived) or be freely deletable. They should be **excluded from delta-storage** (regenerable, not worth delta-ing) and **counted separately in the storage-metering rollup** (D) so the _retained_ corpus is visible distinct from regenerable cache — this keeps the keep-forever destruction-economics worry (ADR-0049) honest by not inflating it with cache.
- **The critical exception — evidence pinning.** A derived rendition can _become_ evidence: the exact CDR/rasterized copy actually **produced into discovery**, or a specific rendition a recipient relied on. When a derived artifact is served in a production or falls **under a legal/discovery/safe-custody hold**, it must be **pinned** — promoted to retained and removed from cache eviction — mirroring the existing "quarantine never auto-delete" and "holds block destruction" discipline. So the model is `derived` + a `pinned`/`under_hold` override.
- **Ties to existing decisions:** the regeneration recipe leans on the content hash (ADR-0078 item 1); the malware-scan-verdict-cache and the search index are themselves `derived` data under this model; preview renditions are the safe-delivery output (ADR-0029).

### Resolved — eviction policy (owner, 2026-06-12)

The open eviction question is resolved against verified R2 storage-class mechanics. The columns (`artifact_role`, `pinned`) land in slice 1·1 (ADR-0078 item 4 — the expensive-to-retrofit part); the **policy below is the standing model each derived-artifact producer (Phase 2 preview/conversion/CDR, Phase 5 OCR/index, the 2·1 bundle zips) applies in-area when it first emits derived bytes.** Recorded as an ADR-0078 amendment in the 1·1 design cycle.

- **Storage class: Standard, never Infrequent Access.** Verified R2: IA is $0.01/GB-mo storage **but** carries a **$0.01/GB retrieval fee** and a **30-day minimum storage duration** (billed even if the object is deleted/replaced earlier). Derived caches are **read-hot** (a preview rendition is fetched on every view) and **short-lived** (evicted/regenerated as versions churn) — exactly the two access patterns IA punishes. So derived artifacts live in **Standard** (no retrieval fee, no minimum-duration trap), and **eviction = deletion, not tier-down**. IA stays reserved for cold _originals_ (the existing ADR-0035/0049 version-object tiering). This is the inverse of how originals tier.
- **Eviction mechanism: age-based TTL via a native R2 lifecycle rule on the `derived/` prefix** — zero-ops, the same primitive the 2·1 bundle zips already use (a derived artifact is exactly this model; see [`async-bulk-download-jobs.md`](async-bulk-download-jobs.md)). R2 lifecycle conditions are **age-based only** (days since creation/upload) — **there is no last-access/atime condition**, so true LRU would require writing a last-read timestamp to D1 on every read. We do **not** build that now (golden rule 10 — premature without a measured storage problem); age-TTL + the two eager signals below cover it.
- **Two eager-invalidation signals layered on the TTL:** (1) **recipe invalidation** — when a source's content hash changes (new version), its derived artifacts are known-stale and deleted on the version-commit path, not left for the TTL; (2) **current-version default** — for version-tied renditions, keep the current version's artifact and drop the superseded one. The age-TTL is the lazy backstop for everything the eager signals miss.
- **Pinned override (unchanged):** a derived artifact that becomes evidence (produced into discovery, or under a legal/discovery/safe-custody hold) flips `pinned`/`under_hold`, is excluded from the lifecycle rule, and is **promoted to retained** (treated as an original for retention — and only _then_ eligible to tier to IA as a cold original). Mirrors quarantine-never-delete + holds-block-destruction.
- **Per-consumer TTL, one framework:** recompute cost spans orders of magnitude, so each producer sets its own TTL within this model — **cheap+hot** (thumbnails, preview renditions, bundle zips): short TTL (days), regenerate on miss; **expensive** (OCR of a multi-hundred-page scan, the search index): long TTL or effectively retained-until-source-changes, since regeneration is costly — these likely live in their own Phase-2/Discovery homes and set policy there (the discriminator is reserved now, the consumer decides). **Evict-on-pressure / size-cap LRU is deferred** — it needs the access-tracking above and a measured cost trigger; the age-TTL model is the launch policy.
- **Metering (unchanged, §D):** derived cache is counted **separately** in the authoritative D1 rollup so the _retained_ corpus is visible distinct from regenerable cache — keeps the keep-forever destruction-economics (ADR-0049) honest by not inflating it with cache.

### Tiering vs retention vs eviction — three orthogonal axes (clarified 2026-06-12)

Worth pinning, because "IA", "cold", and "delete" sound related and are not. Three independent axes govern an object's life:

- **Retention / disposition (records management):** how long a file is _kept_. Originals are kept indefinitely by default and **never auto-deleted by the platform** — only the firm deletes (explicit action or a firm-configured retention schedule), and **holds always override** (quarantine-never-delete, holds-block-destruction, originals-are-evidence). A firm's "7-year" schedule is records policy, not a storage mechanism.
- **Storage tiering (Standard ↔ IA):** a pure _cost_ optimization over _retained_ data, driven by **access temperature, not age**. Tiering moves the _same bytes, same durability, same retention_ to a cheaper shelf — **it never deletes anything**.
- **Eviction (deletion):** applies to **derived caches only** (regenerable artifacts) — the age-TTL + invalidation policy above. **No original is ever evicted.**

**The only deletion in the system is derived-cache eviction.** Originals — hot or cold, Standard or IA — persist until the firm says otherwise.

**Do we use IA at all, then? Yes, but narrowly — a measured lever, not a default.** A **cold original** is a retained-but-rarely-read original (a document on a matter closed years ago, a superseded version nobody opens) — cold by _access temperature_, not by age or impending deletion. IA's only edge is its ~33% lower storage rate ($0.0099 vs $0.015/GB-mo); R2 egress is free on Standard regardless, so IA's downside — the $0.01/GB retrieval fee + 30-day minimum-duration charge — bites precisely when a cold original is unexpectedly pulled (litigation hold, audit, former-client request), which legal matters do unpredictably. So: **Standard is the default home for originals; IA is opt-in for _provably_-cold archives (e.g. matter closed > N years, zero accesses) and only when the load-profile harness shows storage cost matters at a firm's scale** (golden rule 10; the ADR-0077 ~100 GB/firm note is the order of magnitude). For many firms originals may simply stay in Standard forever. IA is never a default and never deletion. (Refines the Standard→IA tiering seam of **ADR-0035/0049**.)

---

## D. Per-firm storage metering (ADR-0078 item 3) — the Analytics Engine reality

ADR-0078 says the metering rollup "feeds the existing Analytics Engine path … and doubles as the per-firm billing/capacity number." Research surfaces a constraint that **refines** that: Analytics Engine alone cannot be the authoritative billing number.

**Analytics Engine limits (confirmed):** **one index per data point** (the index is the sampling key — providing multiple indexes silently drops the data point), **≤ 250 data points per Worker invocation**, **blob fields ≤ 16 KB total**, **3-month retention**, and **sampled reads** (equitable write-time sampling by index + adaptive read-time sampling over long ranges). Cardinality is unlimited.

**Implications for the metering design:**

- **Index = firm** (slug/id) for equitable per-firm sampling; **storage class and key-prefix/class go in blobs**; **bytes and object counts in doubles**. You cannot index by both firm _and_ storage-class (single-index rule) — class-level breakdowns are blob dimensions, queried under sampling.
- **Sampling + 3-month retention make AE a trend/observability feed, not a system of record.** A sampled, 90-day-windowed number is fine for "is this firm's IA corpus trending toward the ~100 GB delta threshold?" but wrong for an **exact billing/capacity figure** or a precise adopt-when gate.
- **Recommendation — dual metering:** (1) an **authoritative exact rollup in per-firm D1** — counters by storage class/prefix maintained **incrementally on the write / delete / tier paths** (every object create, every Standard→IA `CopyObject`, every hard-delete adjusts the counters), which is exact, retained, and the real billing/capacity number and the precise trigger for adopt-when gates; (2) **AE data points** for cheap time-series/observability and dashboards. ADR-0078's "feeds the AE path" stays true, but the **billing/capacity number should be the D1 rollup**, not AE. This looks worth a one-line ADR-0078 amendment — flagged for the design cycle, not changed here.
- Incremental counters are also cheaper than periodically `LIST`-summing the whole bucket (R2 list is paginated and Class-B-billed); a periodic reconciliation `LIST` can true-up drift occasionally.

### Open decisions (metering)

- Ratify the dual model (exact D1 rollup authoritative; AE for trends) and amend ADR-0078's "doubles as the billing number" line accordingly.
- The counter granularity (by storage class × top-level prefix; whether `derived` cache is a separate counter per C).
- Reconciliation cadence (how often a full `LIST` true-up runs).

---

## E. Matter numbering — survey and the schema-affecting choices

The configurable-numbering design (white paper, with optional location segment and the URL-safe-character constraint already fixed) is sound; the survey confirms the shape and isolates the one schema-affecting decision:

- **Schemes in the wild (Clio and general practice):** default `[sequential number]-[client summary name]`; common variants are pure sequential (`00001`), **year + sequence** (`YY-NNNN` / `YYYY-NNNNN`), **client-then-matter** (`CCCC-MMMM`, a per-client matter counter), and prefixed schemes adding **practice-area or office/location** segments. Padding width, separator, and segment order are all firm preferences.
- **Model it as an ordered template of segments:** literal text, location prefix (ADR-0031), year (with format), client code, and a **sequential counter** — each segment configurable, matching the white paper's "configurable scheme with optional location segment."
- **The schema-affecting decision is the counter's reset/scope:** firm-wide monotonic, **per-year reset**, **per-location**, or **per-client** (client-matter style). This determines the **counter table shape** — a counter keyed by `{firm}` vs `{firm, year}` vs `{firm, location}` vs `{firm, client}` — and atomic allocation under concurrency (the counter increment must be transactional, naturally fitting the slice 0·2 idempotent write path; the identifiers package supplies the opaque PK, while this human-facing number is a separate, firm-configurable attribute). Getting the counter-scope dimension into the schema up front is the expensive-to-retrofit part; the format/template is just config.
- **Out of scope / don't confuse:** **Bates numbering** (document-level stamping for discovery production) is a separate concept that belongs to Discovery (Phase 4), not matter numbering — flagged because the searches surface it together.

### Open decisions (numbering)

- The counter-scope set to support at launch (firm-wide + per-year are the common minimum; per-location follows from ADR-0031; per-client is a bigger commitment).
- Whether numbers are **renumberable** after assignment (most firms freeze them; freezing simplifies the URL-as-identity path) and the collision/uniqueness guarantee per scope.
- Reserved/standalone number allocation for Prospective matters at intake (conflicts run pre-Open).

---

## F. Consolidated open decisions for the slice 1·1 design cycle

1. **Upload path** — ratify uniform direct-to-R2 (presigned PUT small / S3 multipart large), resumable-now vs seam-reserved, client library, presigned-credential custody under per-firm buckets. (§A)
2. **Quarantine ingest** — pending-key vs flag; the single-read consumer doing gate+scan+hash+commit; event-notification rule layout. (§A.4)
3. **Upload short-circuit** — _Decided (owner, 2026-06-11): defer the client-pre-hash short-circuit to future research_ — it is a bandwidth optimization ahead of measurement (golden rule 10). Keep only the always-safe, free pieces: the server-side **no-op version skip** and the **content-hash seam** (ADR-0078). Firm-wide cross-matter dedup remains separately deferred; if the short-circuit is ever built, it stays within-matter-scoped (§A.5). _Marked for future research._
4. **ZIP64 download** — adopt `client-zip` (pinned) vs in-house writer; the live→async threshold + artifact lifecycle. (§B)
5. **Artifact class** — _Decided (owner, 2026-06-11): needs dedicated research + development; reserve the seam now, defer the policy._ Land the `original`/`derived` + `pinned`/under-hold discriminators in the slice 1·1 schema (cheap, expensive-to-retrofit). The **derived-cache eviction policy and storage class are deferred** to dedicated research/development, sensibly timed to Phase 2 when the artifacts (OCR, conversions, preview/CDR renditions) actually exist and recompute-vs-storage costs are measurable. Its **evidence/legal-status sub-question** — whether a derived rendition (e.g. an OCR layer, a rasterized preview) is part of the discoverable record or a mere cache — is a **legal-rules probe**, not pure engineering; a candidate for a focused research pass alongside [`docs/research/trust-rules/`](trust-rules/). (§C) _Marked for future research._
6. **Metering** — dual model (exact D1 rollup authoritative, AE for trends); amend ADR-0078's billing-number line; counter granularity; reconciliation cadence. (§D)
7. **Matter numbering** — the counter reset/scope set (the schema-affecting choice); renumberable-or-frozen; Prospective allocation. (§E)
8. **Build-when-in-the-area seams to reserve now** (cheap columns, deferred machinery): `artifact_role` + `pinned`, the storage-class/prefix metering counters, the numbering counter-scope key, and the already-decided `storage_encoding` (ADR-0077) and content hash (ADR-0078).

The malware-scan **engine** choice stays its own deferred ADR (white paper hardening); this research only wires the **pipeline shape** (§A.4) the upload path requires.

---

## Sources

- [Limits · Cloudflare Workers docs](https://developers.cloudflare.com/workers/platform/limits/)
- [Limits · Cloudflare R2 docs](https://developers.cloudflare.com/r2/platform/limits/)
- [Use the R2 multipart API from Workers · Cloudflare R2 docs](https://developers.cloudflare.com/r2/api/workers/workers-multipart-usage/)
- [Upload objects (presigned URLs) · Cloudflare R2 docs](https://developers.cloudflare.com/r2/objects/upload-objects/)
- [Event notifications · Cloudflare R2 docs](https://developers.cloudflare.com/r2/buckets/event-notifications/)
- [Workers Analytics Engine — Limits · Cloudflare docs](https://developers.cloudflare.com/analytics/analytics-engine/limits/)
- [Streams (ReadableStream) · Cloudflare Workers docs](https://developers.cloudflare.com/workers/runtime-apis/streams/)
- [Touffy/client-zip — a client-side streaming ZIP generator (GitHub)](https://github.com/Touffy/client-zip)
- [How I Built Streaming ZIP64 on Cloudflare Workers (128MB RAM, No Filesystem)](https://dev.to/ryan_e200dd10ede43c8fc2e4/how-i-built-streaming-zip64-on-cloudflare-workers-128mb-ram-no-filesystem-3aaf)
- [Cloud Storage Showdown: S3 vs R2 vs B2 for Large Uploads (tus / resumable)](https://www.resumablejs.com/ops/cloud-storage-showdown-s3-r2-b2-large-uploads-2026/)
- [Resumable and large files (tus) · Cloudflare Stream docs](https://developers.cloudflare.com/stream/uploading-videos/resumable-uploads/)
- [How to Set Up a Matter Numbering System At Your Law Firm · Clio](https://www.clio.com/blog/matter-numbering-system-law-firm/)
- [Matter Numbering Scheme · Clio Help Center](https://help.clio.com/hc/en-us/articles/9286019831707-Matter-Numbering-Scheme)
