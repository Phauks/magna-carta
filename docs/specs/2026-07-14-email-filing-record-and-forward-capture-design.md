# Email filing — record model & forward/CC capture (slice 1) — design

**Status:** Draft — proposed for acceptance · **Date:** 2026-07-14 · **Owner:** Trevor Goldsmith
**Parent design:** [`2026-06-16-email-filing-design.md`](2026-06-16-email-filing-design.md) (the subsystem brainstorm; Draft). This document refines that brainstorm's **first slice** — the matter-email **record model** plus the **forward/CC capture** path — into an acceptance-ready, buildable scope. It does not re-open the subsystem's settled decisions; it selects the launchable subset and pins the concrete shapes.
**White-paper home:** _Communications layer_ (email) — the inbound email-to-matter capture seam. Relates to _Matters and File Manager_, _Directory_, _Conflicts Check_, _Discovery_, _Client portal_.
**Foundation already built:** the pure-Rust `email-core` parse engine and its `@magna-carta/email` WASM wrapper ([`2026-07-09-email-core-parse-engine-design.md`](2026-07-09-email-core-parse-engine-design.md)); the source-agnostic ingest / quarantine pipeline (`@magna-carta/file-manager` + the worker `files/` consumer); per-firm D1 over the `FirmDatabase` Durable Object; the firm-scoped data-access layer.

---

## 0. Why this slice, and why this shape

The subsystem brainstorm settles the strategy: capture the firm's own email into matters as first-class, thread-aware records, converging every capture mechanism on **one pipeline and one record**. It decomposes into slices — **record model → add-in + forward → sync → calendar → import** — and lanes the launchable subset as MVP (parent design, _Facet triage_).

This slice builds the **record model** and the **forward/CC capture** path together, for three reasons:

1. **It is a real vertical slice.** A record model with no capture source is a horizontal layer, not a working feature. Forward/CC is the simplest capture that carries the model end to end (schema → data-access → ingest → API → tests → docs).
2. **It is pure backend and gates on nothing new.** The forward/CC path terminates on a Cloudflare Email Worker and reuses the existing ingest chokepoint. It needs no client-side add-in toolchain (Office.js / NAA / Gmail CardService), no OAuth, and no CASA/Microsoft-verification review — those belong to the add-in and mailbox-sync slices.
3. **It is the universal fallback and de-risks the model.** Forward/CC reaches any client on any device (parent design, _Strategy & sequencing_). Landing the record model behind it first means the harder add-in slice arrives against a proven schema and dedup, not a speculative one.

The **add-in** ("Save & File" / "Send & File") is the hero UX and follows as its own slice; this slice builds the **authenticated `file this MIME to matter` API endpoint** the add-in will call, so that later slice is client work against a settled server contract, not a fresh backend.

## 1. Scope

**In scope**

- The per-firm **record model**: `email_message`, `email_thread`, `email_matter_link`, `email_participant`, `email_attachment` — metadata in per-firm D1, bytes in per-firm R2 (golden rule 3).
- **Forward/CC capture** over a Cloudflare **Email Worker**: a per-matter token address plus a firm catch-all, terminating on the existing ingest / quarantine chokepoint.
- The **`file this MIME to matter`** authenticated API endpoint (the add-in's future target and the manual "upload an .eml/.msg to this matter" path), sharing the same ingest and record code.
- **Message-ID dedup** (per firm) with a normalized-header+body content-hash fallback; the server-side **"already filed"** determination, wall-safe (absence-not-existence).
- **Multi-matter linking** through the `email_matter_link` junction — stored once, linked many, unique on `(message, matter)`, per-matter access.
- **Attachments** extracted into the File Manager as first-class `file` / `file_version` documents, R2-deduplicated by content hash, quarantined on the same chokepoint; inline `cid:` decorative images filtered from the document set.
- The **verbatim original** message kept whole in R2 for fidelity and evidence.
- **Integrity facts recorded** verbatim (DKIM signatures, Authentication-Results, Received chain) as the parse engine surfaces them — stored, not yet adjudicated.
- **Staff-accept onto matter(s)** as the default disposition; the capture lands **staged**, a person confirms.
- The **seams** that later slices need placed now (they are cheap now, expensive to retrofit): the filing-time conflict/ethical-wall **hook**, the Notifications **raise-point**, the DKIM-**verdict** boundary, and the discovery-readiness fields (content hash, chain-of-custody audit).

**Out of scope (named, with their home)**

- The **native add-in** (Outlook/Gmail) UI and distribution — its own slice; this slice ships its API target.
- **Mailbox sync + send-as** (the credentialed adapter, CASA-gated) — parent design _Capture C_; Phase 7.
- **DKIM cryptographic verdict** computation — recorded evidence now; the verifier is a named seam (§7).
- **Predictive matter-match beyond a transparent heuristic**, and **ML / filing-history scoring** — fast-follow.
- The **matter correspondence timeline UI** and any web surface — deferred to the UI plan (post design-system), as with the slice 1·1 / 1·3 UI plans. This slice is backend + API + the Email Worker.
- **Guardrailed auto-file rules** as a configurable engine — this slice files on staff-accept only; the `autofile_rule` model is a fast-follow. (The DKIM-authenticated-sender guardrail it depends on is itself gated on the verdict seam.)
- **Tamper-diff / "unauthenticated — from quote" integrity markers**, **conflict-check engine**, **Discovery indexing**, **client-portal sharing** — later phases; only their seams are placed here.

## 2. Architecture — one pipeline, two entrances

Inbound email is **a source on the existing source-agnostic ingest / quarantine chokepoint**, not a parallel path (parent design, _The convergent pipeline_). Two entrances feed the same staging → parse → dedup → stage-onto-matter flow:

- **The Email Worker entrance** (forward/CC). A Cloudflare Email Worker (`apps/email-worker`, a new worker analogous to `apps/scan-worker` / the planned `apps/convert-worker`) receives the forwarded message, resolves the destination address to a firm (and, for a per-matter token address, a candidate matter), and hands the raw MIME to the ingest path. Cloudflare Email Routing caps a message near **~25–40 MiB**; over that, the worker records a `capture_oversize` outcome and the message is not silently dropped (the add-in path handles large messages later).
- **The API entrance** (`POST /api/v1/matters/{matterId}/emails` — "file this MIME to matter"). Authenticated, chokepoint-governed, firm- and matter-scoped. The add-in and the manual uploader both post raw `.eml` / `.msg` bytes here.

Both entrances converge on a single **`captureEmail`** operation in a new `@magna-carta/email-filing` package:

1. **Parse** the bytes through the `@magna-carta/email` WASM edge (`parseMessage`) — the same engine the Email Inspector uses. One parser, one `ParsedMessage`, no second implementation.
2. **Persist the verbatim original** to R2 by content hash (content-addressed write, so re-capture is idempotent at the blob layer).
3. **Dedup** on `Message-ID` (+ firm); on a stripped/rewritten identifier, fall back to the normalized-header+body content hash (§4).
4. **Upsert** the `email_message` row and its `email_participant` rows; link into `email_thread` by `In-Reply-To` / `References`.
5. **Extract attachments** into the File Manager as first-class documents through the untrusted-file pipeline (§5), filtering decorative inline images.
6. **Stage** an `email_matter_link` for the candidate matter in a **staged** state; staff-accept promotes it to **filed**. (The API entrance, being already authenticated to a specific matter with `emails:file` permission, may stage-and-accept in one step per firm policy; the Email Worker entrance always lands staged.)

**Compute placement** (ADR-0039): parse / hash / attachment-extract / index run **off the hot path** on a Queue consumer; the entrances enqueue and return. Large attachments escalate to a Container in a later slice; this slice bounds attachment size to the ingest pipeline's existing cap and records an oversize outcome above it.

### 2a. What this reuses, and what is new

- **Reused:** the `@magna-carta/email` parser; the File Manager ingest / quarantine chokepoint and its content-hash-on-write; the `FirmDatabase` Durable Object and the firm-scoped data-access layer; the telemetry pipeline; the problem-type registry.
- **New:** the `@magna-carta/email-filing` package (the record model, `captureEmail`, dedup, thread-linking); the `apps/email-worker`; the `email_message` / `email_thread` / `email_matter_link` / `email_participant` / `email_attachment` tables and their per-firm migration; the `POST /api/v1/matters/{matterId}/emails` route + the `GET` read routes; the `emails:*` permission family; the capture-address routing model and its DNS.

## 3. The record model

Per-firm D1 metadata over per-firm R2 bytes. All access is through the firm-scoped data-access layer; no query crosses firms (ADR-0003). Sensitive bodies and identifiers are `protected()` where the firm flags them (ADR-0084). This realizes the parent design's data model (its _Data model_ section); the shapes below are the buildable pinning.

- **`email_message`** — one row per **unique** message, the unit of truth. Columns: the firm-scoped identifier; `message_id_value` + `message_id_provenance` (`header` | `mapi` | `absent`, never flattened — mirrors the parse engine's typed `MessageIdentifier`); `subject`; `sent_at` / `received_at` as UTC instants (ADR-0055); `from_display` / `from_address` (frozen as-at receipt); `thread_id`; `in_reply_to`; `content_sha256` (ADR-0078); `dedup_key` (§4); `original_r2_key` (the verbatim message); `references_remote_content`; the captured `integrity` facts (stored as recorded, no verdict); `source_format` (`eml` | `msg` | `mboxMember`); provenance (`captured_via`: `forward` | `api` | later `addin` | `sync`). Unique on `(firm, dedup_key)`.
- **`email_thread`** — the conversation as a **DAG**, not a line: messages linked by `Message-ID` / `References` / `In-Reply-To`. A `thread_id` groups them; forks and late-surfacing messages are edges, reconciled by content hash when a segment is known only from a quote (the integrity work is a later slice; the DAG columns are placed now).
- **`email_matter_link`** — the multi-matter junction. `(email_message × matter)`, **unique on the pair**. Carries `state` (`staged` | `filed` | `unlinked`), `linked_by`, `linked_at`, per-matter tags, provenance, and the capture entrance. Access is **per-link/per-matter**.
- **`email_participant`** — each from/to/cc/bcc row, the address frozen as-at receipt; a nullable `directory_entity_id` resolving to a Directory Person/Organization when matching is available (§6). No shadow address list — the frozen string is the record; the Directory link is enrichment.
- **`email_attachment`** — ties a File Manager `file` back to its `email_message` and `email_thread`: the `file_id`, the part's declared filename and media type, `disposition` (`attachment` | `inline`), and whether it was promoted from an inline image. The bytes live once in R2 (content-hash deduped); this row is the link.

**Reconstruction:** a matter's email view is assembled from all messages linked to that matter (through `email_matter_link` in `filed` state), deduped by `dedup_key`, ordered by the thread DAG and time — never a re-saved per-reply blob.

## 4. Dedup & the wall-safe "already filed" signal

The cross-user correctness win (parent design, _Dedup_). Two people on the same email, one files it — the record must converge, not duplicate.

- **Dedup identity** is `Message-ID` (+ firm) — identical in every recipient's copy. When a Message-ID is absent or rewritten (some forwarders do), the fallback `dedup_key` is a content hash over **normalized headers + body** (canonical header casing/order, whitespace-collapsed body), so cross-inbox copies still converge. The `dedup_key` column stores whichever applied; the unique constraint enforces one row.
- **One record, many filers.** A second capture of the same message updates provenance ("also confirmed by …") rather than inserting; it can add a new `email_matter_link` but never a second `email_message`.
- **The "already filed" read** (`GET /api/v1/emails/already-filed?messageId=` or by content hash) returns, for a message the firm has captured: the matters it is filed to **filtered to the ones the caller can access**. A caller with no access to any of them receives a generic **"already captured by your firm"** with no matter identity — the signal can never become an oracle for a walled matter's existence (ADR-0052). This is the endpoint the add-in's "Already filed to {Matter}" indicator will consume; it is built now because the dedup logic is here.

## 5. Attachments — first-class documents on the same chokepoint

Attachments are extracted into the matter's File Manager as first-class `file` / `file_version` documents, while the original email is also kept whole (parent design, _Attachments_).

- **Extracted through the untrusted-file pipeline** — staged, magic-byte gated, scanned, preview-verdict, **quarantined until cleared** (ADR-0081; the malware engine is deferred, launch verdict `unscanned`). Served only from the cookieless preview origin (ADR-0029), never inline-active.
- **Content hash on write** (ADR-0078) — every extracted part is hashed as it lands, so the same PDF across five replies of one message resolves to a single version rather than five. **A known constraint (§12 gate check):** the File Manager stores blobs under **per-version keys** (`files/{fileId}/{versionId}`), not content-addressed keys — its dedup lives at the version / scan-cache layer, not the object store. So an attachment filed to three matters becomes three matter-rooted `file` documents whose bytes may duplicate in R2. This slice accepts that (files are matter-rooted by design; a per-matter document is the correct unit), and records **true content-addressed single-blob storage as an enhancement** the parent design's "store once by content hash" aspiration needs — not free from the current file store, and out of scope here.
- **The parse engine's two-phase extraction is the mechanism.** `parseMessage` returns `PartDescriptor`s that locate bytes without materializing them; `extractPart` pulls one part's bytes on demand. The consumer extracts only real attachments, so a headers-and-text capture never pays for attachment bytes it discards.
- **Inline `cid:` decorative images are filtered** out of the document set (a signature logo is not a document), with the `email_attachment.disposition` recorded so a later "promote this inline image to a document" action is a data change, not a re-parse.
- **The Email Worker size ceiling** (~25–40 MiB) bounds the forward path; over it, the message records a `capture_oversize` outcome (the add-in path handles larger later). This slice does not add the Container escalation.

## 6. Directory participant resolution (graceful degradation)

Every participant should resolve to a Directory Person/Organization (parent design, _Cross-cutting integrations_). The gate check (§12) found that Directory's **entity graph and `matter_party` bridge are built, but address→entity resolution is not** — `directory_email` is a schema-only table with no write path, no lookup function, and no index on `address`. So this slice **degrades gracefully and defers resolution** rather than hard-gating:

- The `email_participant.directory_entity_id` is **nullable** and, in this slice, **written null** — the frozen address string is the record. Resolving each address to a Directory entity waits on a Directory **contact-details** capability (the `directory_email` write path + a reverse `address → entity` lookup + an `address` index), which is a small, well-scoped build that can be a fast-follow or folded into this feature's own scope by agreement. The record model is built so that turning resolution on later is a **backfill + a wiring step**, not a schema change.
- **Predictive matter-match** in this slice is therefore the CASA-free, Directory-free heuristic only — thread-continuation (a reply to an already-filed thread proposes its matter) and subject matter-number/name — degrading to no suggestion when neither fires. This is exactly the ladder the parent design lanes as buildable pre-Directory. The participants∩parties and sender-domain→organization signals layer in once resolution exists; ML scoring is fast-follow.

## 7. Seams placed now (cheap now, expensive to retrofit)

Per the "build when in the area" rule, this slice places the seams later slices need, without building the machinery behind them:

- **DKIM verdict boundary.** The parse engine records DKIM/Authentication-Results/Received **verbatim with no verdict** (its parse-only boundary). This slice stores those facts and exposes a `dkim_verdict` field defaulted to `unverified`; the cryptographic verifier that fills it is a named consumer, not built here. The forward/CC path has a known limitation — a forwarded message's envelope authenticates the **forwarding firm user**, not the original sender (forwarding breaks the original DKIM); the add-in path (later) reads the original message directly and preserves it. The auto-file "DKIM-authenticated sender" guardrail therefore waits on both the verdict seam and the add-in.
- **Filing-time conflict/ethical-wall hook.** Linking an email to a matter calls a hook that is a no-op now and becomes the conflict check in Phase 4 (the differentiator; parent design, _Cross-cutting_). Placing the call site now means the engine drops in without touching the capture path.
- **Notifications raise-point.** "email filed to matter" is a notification type raised off the hot path; the raise call is placed (a no-op until the Notifications subsystem ships, ADR-0059), carrying a deep link, never body content.
- **Discovery readiness.** `content_sha256`, the immutable capture audit (who/when/how, in the per-firm audit log), and the verbatim original make each record discovery-ready now; the indexing-unit decision (thread vs message) is Phase 5.

## 8. Tenancy, security, and integrity invariants

- **Firm isolation** through the firm-scoped data-access layer; no query crosses firms; bulk bytes (the verbatim original, attachments) to R2, never D1 (ADR-0003, golden rule 3).
- **Absence-not-existence** for every walled/missing case — the "already filed" signal, the multi-matter "also on …" list, and any matter reference filter to the caller's access and never leak a walled matter's identity (ADR-0052).
- **Untrusted bytes** — the raw message and every attachment are hostile input; parsing is the hardened `email-core` engine, attachments ride the quarantine chokepoint, nothing is served inline-active (ADR-0081, ADR-0029).
- **`protected()`** wraps sensitive bodies/identifiers where the firm flags them; per-firm crypto-shred applies (ADR-0084).
- **The authenticated message is the unit of truth**; quoted history embedded in a reply is unauthenticated and is not promoted to a standalone `email_message` (the tamper-diff feature that exploits the redundancy is a later slice).

## 9. Prerequisite gates

The parent design gates this subsystem on Directory (slice 1·3, participant→party matching) and the untrusted-file pipeline (slice 2·1, attachment ingest). This slice's stance:

- **Upload / quarantine pipeline (2·1)** — a hard dependency for attachments; the capture path calls into it. _Verified state (§12): **green**_ — the chokepoint, content-hash-on-write, the matter-rooted `file`/`file_version` model, and email MIME acceptance are all built and directly reusable.
- **Directory (1·3)** — a **soft** dependency: participant resolution degrades gracefully (§6), so the record model and forward capture land without it. _Verified state (§12): **partial**_ — the entity graph and `matter_party` bridge are built, but address→entity resolution is not, so resolution is deferred (§6), not blocking.

## 10. Verification

- **Unit** — dedup convergence (same Message-ID → one row; stripped Message-ID → content-hash convergence); thread DAG linking; inline-image filtering; the wall-safe "already filed" filter (a walled matter never leaks).
- **Integration (Miniflare)** — the API entrance end to end (post `.eml` → staged link → accept → matter view); the Email Worker entrance against a captured fixture; attachment extraction landing quarantined File Manager documents; multi-matter linking (one message, two matters, per-matter access).
- **Contract** — the new routes re-emit the OpenAPI snapshot and regenerate the client; conformance lists the new operations.
- **Load profile** (ADR-0083) — the volume-shaped reads join the harness in-area: a matter's threads, a thread's messages, the "already filed" lookup, the dedup probe.
- **Fixtures** reuse the `email-core` corpus (`.eml`, `.msg`, mbox) plus a forwarded-message fixture that exercises the envelope-vs-original DKIM limitation (§7).

## 11. Documentation & decision deltas (on acceptance)

- **New ADRs** (numbers assigned at merge, per the fragment workflow) — the parent design reserves three; this slice records the two it realizes and defers the third:
  - the **subsystem architecture** (add-in-led CASA-free posture; the convergent pipeline) — the parent's reserved architecture ADR, realized here for the forward/API entrances.
  - the **data model** (message record + thread DAG + multi-matter junction + Message-ID dedup + first-class attachments).
  - the **filing-time conflict check + wall-safe "already filed" indicator** — the indicator ships here; the conflict engine is Phase 4, so this ADR records the seam and the wall-safe rule now.
- **White paper** — the _Communications layer_ email section gains the inbound-capture entrances and the record model; reconcile the "OAuth mailbox sync is the email integration" framing (sync is the later credentialed tier).
- **ROADMAP / STATUS** — the subsystem's first slice opens with a `status.d` fragment; ROADMAP moves email-filing from "draft design" to "in build (slice 1)".
- **User docs** — a _Filing email to a matter_ guide (forward/CC address, what gets filed, "already filed") ships with the slice (golden rule 5).
- **Operating cost** — the forward path adds the inbound capture subdomain (co-tenants the `magnacarta.esq` zone, no new recurring cost); the CASA assessment binds only when the sync adapter is built.

## 12. Gate-check result

Verified against the codebase 2026-07-14.

**Upload / quarantine pipeline (slice 2·1) — GREEN, directly reusable.**

- The ingest chokepoint is `@magna-carta/file-manager` `runIngest` (`packages/file-manager/src/ingest-core.ts`): a single-read tee into magic-byte sniff, streaming SHA-256 + byte count, and the scan port, yielding a `commit` or `quarantine` outcome. Entry is an R2 object-create event → the `files-ingest` queue (interactive) / `…-files-ingest-bulk` (bulk); the consumer is `apps/worker/src/files/ingest-consumer.ts` (`handleIngestMessage`), committing (`clean`) or quarantining (`quarantined`) in one idempotent batch keyed `ingest:<versionId>`.
- **Content hash on write** is present (`contentSha256`, streaming, stored at commit). Dedup lives at the version layer (a re-upload whose hash equals the current version is abandoned) and the `scan_cache` table (keyed `content_sha256 + engine_version`). **Blob storage is per-version keys `files/{fileId}/{versionId}`, not content-addressed** — the constraint §5 records.
- **Email MIME is already accepted:** `DEFAULT_UPLOAD_POLICY.allowedContentTypes` in `packages/file-manager/src/upload-policy.ts` includes `message/rfc822` and `application/vnd.ms-outlook`; `.eml`/`.msg` are not extension-blocked.
- The `file` (matter-rooted via `matter_id`) and immutable `file_version` (status `pending`→`clean`|`quarantined`|`abandoned`) tables are exactly the model attachments become documents in.
- **Caveat (accepted):** live malware scanning is built (`containers/scan`, `apps/scan-worker`, `SCAN_SERVICE`) but dormant — `resolveScanPort` falls back to the engine-less adapter until the binding is activated at deploy, so attachments commit `unscanned`. The quarantine flow, dedup, and access-triggered / weekly rescan are all present; this is a platform-wide activation step, not a missing capability.

**Directory (slice 1·3) — PARTIAL; resolution deferred (see §6).**

- Built and reusable: the entity graph (`directory_person`, `directory_organization`), and the **matter↔party bridge** `matter_party` (`packages/directory/src/party.ts` — `linkMatterParty`, `readMatterParties`, role catalog). These back the participants∩parties signal once resolution exists.
- **Not built:** email-address → entity resolution. `directory_email` (`per-firm-schema.ts`) exists as a temporal child table but has **no write path, no lookup function, and no index on `address`** — reverse lookup is unsupported at the schema level. Resolving `from/to/cc → Person/Organization` is net-new. This slice therefore writes `directory_entity_id` null and defers resolution to a Directory contact-details capability (§6); it does not block the record model or forward capture.

## 13. What this unblocks

- The **add-in slice** — its "Save & File" / "Send & File" posts to the `file this MIME to matter` endpoint and reads the "already filed" signal, both built here.
- The **mailbox-sync slice** — feeds the same record model and dedup, adding no parallel data path.
- **Discovery** — email-as-evidence stands on this record model (content hash, chain-of-custody, verbatim original).
- The **matter correspondence timeline UI** — the data model already supports it; the render is a pure UI-plan concern.
