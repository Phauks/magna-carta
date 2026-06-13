# Slice 1·1 — Matters core, Locations & File Manager — design

**Status:** Accepted (design) · **Date:** 2026-06-11 · **Owner:** Trevor Goldsmith
**White-paper home:** _Matters and File Manager_ · _Locations_ · _Document versioning & storage tiering_
**Research input:** [`docs/research/slice-1-1-file-manager-storage.md`](../research/slice-1-1-file-manager-storage.md)
**ADRs:** ADR-0007 (matter-centric model) · ADR-0027 (bulk download approach) · ADR-0031 (Locations) · ADR-0035 (version objects & tiering) · ADR-0068 (access-control model) · ADR-0077 (delta-storage seam) · ADR-0078 (storage foundations; amended by this cycle) · **ADR-0079 (matter-numbering engine) · ADR-0080 (matter shell, lifecycle & consultations) · ADR-0081 (inbound upload path & quarantine ingest) · ADR-0082 (bulk-download implementation) — this slice's new decisions**

This spec is the implementation-grade design for slice 1·1 ([`ROADMAP.md`](../../ROADMAP.md)): the matter shell, the Locations entity, and the File Manager over per-firm R2. It does not restate the white paper's model (matter as the top-level access unit, Locations as a dimension, app-managed versions) — it specifies what gets built, where it lives, and how it is tested. Phase 1's first slice; the first slice with end-user UI beyond auth.

**Build gates:** the slice 0·5 contract pipeline (all routes ship through `defineOpenAPIRoute`), slice 0·4 (RBAC chokepoint, per-firm buckets from provisioning), and slices 0·7a/0·7b (design-system components and the first UI shell) precede the build.

---

## 1. The matter shell (ADR-0080)

A `matter` row in the per-firm D1 carries:

- **Identity & description:** `mat_` identifier handle (primary key, ADR-0062), `title`, `description`, `matter_type_id`, optional `location_id` (home Location), `responsible_member_id` (the responsible attorney — also feeds the staff-initials numbering segment and the consultations folder).
- **Client seam (pre-Directory):** `client_display_name` and optional `client_code` — plain display fields for lists and the client-code numbering segment. **No party table or link table exists in this slice.** Slice 1·3 creates the Directory entity graph and a `matter_party` link table, then migrates these display fields into real links. The link shape is sketched here so 1·3 wires into a known seam, and so nothing in 1·1 accidentally forecloses it:
  - `matter_party(matter_id, entity_id, role, valid_from, valid_to)` — **role lives on the link**, one entity may hold several roles in one matter ("many hats"); `role` drawn from a per-firm role list; client-ship is `role = 'client'`.
- **Lifecycle fields:** `status` (`prospective` | `open` | `closed`, TEXT CHECK), `matter_number` (nullable TEXT, UNIQUE per firm where set), `numbered_at`, `opened_at`, `closed_at`.
- Timestamps per the schema conventions. No hard delete — matters are never destroyed.

**Matter types are data, not enums:** a per-firm `matter_type` table (name, optional `code` usable as a numbering segment, `active` flag), seeded empty plus a firm-default row at provisioning. The type-specific **custom-fields engine is deferred** — Directory (slice 1·3) has the identical need (white paper, _Directory_), so one shared engine is designed once, there. Soft-deactivation only (a type referenced by matters never hard-deletes).

All writes ride the slice 0·2 idempotent write path through `composeEffectBatch` and emit outbox events (§10). Every mutation is audited.

## 2. Lifecycle & consultations (ADR-0080)

```
prospective ──open()──▶ open ──close()──▶ closed
     │                    ▲                  │
     └──────close()──┐    └────reopen()──────┘
                     ▼
                  closed
```

- **Prospective = a consultation.** Created when a prospective or existing client consults on a new legal issue. Carries **no matter number**, does not appear in the main matter list, and surfaces in the **per-attorney Consultations folder** — a virtual view (`status = 'prospective' AND responsible_member_id = X`), not a container entity. This replaces the legacy habit of batching consultations inside a special catch-all matter: each consultation is its own lightweight matter from the start, so its notes and files never need moving and (from Phase 4) its parties feed conflicts permanently.
- **`open()` — the client retained the firm.** Draws the matter number from the active scheme at that moment (§3) — so sequences stay dense (dead consultations never consume numbers) and year-scoped counters reflect the retention year. A matter created directly as `open` (the common case for existing clients) draws its number at creation. Permission-gated.
- **`close()` — the matter concludes.** **Closed = archived, not read-only:** a closed matter leaves active lists and dashboards but still accepts additions (documents, notes — late-arriving correspondence is normal). Closing runs the **close-precondition hook**: a named, registry-style list of checks that must all pass. In this slice the list is empty; **Phase 3 registers the financial precondition** (all bills paid, no remaining balance — owner-stated rule, 2026-06-11). This amends the white paper's "Closed/Archived (read-only)" line (corrected in the same commit as this spec).
- **`reopen()`** exists for corrections, permission-gated, audited. A prospective that never converts is closed directly (consultation declined/expired).
- **Stale-consultation policy:** consultations older than a configurable age (per-firm setting, default 1 year) are flagged in the Consultations folder; launch ships the filter + bulk-close action, automation is a later seam. Closed prospectives are retained forever — they are conflict history.

## 3. Matter numbering (ADR-0079)

The survey (research doc, section E, plus the design-cycle survey of Clio/esilaw/Dye & Durham/Lawmatics/court formats) fixed the requirement: firms arrive with proprietary formats and the engine must reproduce them, not approximate them.

- **Scheme = an ordered template of segments.** Segment kinds: `literal`, `counter` (pad width, start value), `year` (2- or 4-digit), `date_opened` (`YYYYMMDD`), `location_code` (ADR-0031), `matter_type_code`, `client_code`, `staff_initials` (responsible attorney), `client_name`. Rendered values join in order; separators are just literal segments. The white paper's URL-safe-character constraint stands (the rendered number must be URL-safe; the settings UI validates).
- **Counter scope is derived from the template:** any segment may be marked **scoping**; the counter resets per distinct combination of rendered scoping-segment values. Year scoping → per-year reset (`2026-0001`); location + year scoping → `RENO-26-0103`; client-code scoping → client-matter style (`10034-00012`); no scoping segments → firm-wide monotonic. One table covers every scheme:
  - `matter_number_counter(scope_key TEXT PRIMARY KEY, next_value INTEGER)` — `scope_key` is the joined rendered scoping values (empty string for firm-wide). The increment executes **inside the matter's own atomic write batch** (the slice 0·2 `batch()` chokepoint) so concurrent number draws cannot collide or double-allocate; the UNIQUE index on `matter.matter_number` is the backstop.
- **Numbers freeze at assignment.** The rendered string is stored on the matter; scheme edits affect only future matters; nothing ever renumbers implicitly.
- **Manual entry and renumber** are explicit, permission-gated actions (`matters:renumber`): court-assigned numbers, legacy/LEAP numbers, and corrections. Uniqueness within the firm is enforced; manual numbers bypass the counter (a later automatic draw never reuses a manually-taken value because uniqueness is checked at assignment with the bounded-retry idiom, ADR-0062).
- **Counter start is configurable** ("we are at 1042, continue from there") — a migrating firm sets the start value per scope.
- **One active scheme per firm** at launch, stored as a per-firm `numbering_scheme` row (segments as a JSON column validated by zod at the boundary), surfaced through the ADR-0040 Settings registry (Settings is a surface over data this subsystem owns). Per-matter-type scheme overrides are a named seam (the `matter_type_code` segment covers the common case meanwhile).
- The settings UI renders a **live preview** of the format from the draft scheme (a pure renderer shared between preview and assignment).
- **Out of scope:** Bates numbering (document-level discovery stamping — Phase 5, flagged in research so the concepts stay separate).

## 4. Locations (ADR-0031, realized)

Built in this slice because numbering and (future) letterhead reference it from day one:

- `location` — `loc_` handle, `name`, `status` (`active` | `closed`, soft-close only), `jurisdiction` (state/territory, informational default), optional `number_code` (the numbering segment value), letterhead text fields (`address_block`, `footer`, `remit_to` — consumed by document automation in Phase 2; the **logo asset is a named seam** deferred to that phase, since no consumer exists until then).
- `location_address` — typed structured addresses (kind: `physical` | `mailing`, street/city/region/postal, phone), one-to-many.
- `member_location` — staff assignment rows; exactly one `is_primary` per member (enforced in the write path).
- **Firm default Location** — a per-firm setting (ADR-0040); unassigned matters fall back to it for numbering/letterhead.
- Location stays a **filter, not an access gate** (ADR-0068); per-location reporting reads the dimension.

## 5. File Manager — files, versions, folders (ADR-0035/0077/0078, realized)

- **Folders are D1 rows; R2 keys are opaque.** `folder(fld_ handle, matter_id, parent_folder_id, name)` — per-matter tree, arbitrary depth, UNIQUE(matter, parent, name). An object's R2 key is `files/{file_id}/{version_id}` (bucket is already per-firm) — **never derived from the user-visible path**, so rename/move is a metadata edit and zero bytes copy.
- `file` — `fil_` handle, matter, folder (null = matter root), `name`, optional `document_type_id` (per-firm `document_type` list, same shape as matter types), `current_version_id`, `deleted_at` (soft delete only — tiering, never deletion; ADR-0035/0049).
- `file_version` — the substance, one row per immutable version:
  - storage: `r2_key`, `size_bytes`, `storage_class` (`standard` | `infrequent_access`), **`storage_encoding`** (`full` — the ADR-0077 delta seam: nothing outside the data-access layer may assume a version object is raw file bytes);
  - integrity & class: **`content_sha256`** (ADR-0078), `declared_content_type`, `sniffed_content_type`, **`artifact_role`** (`original` | `derived`) **+ `pinned`** (the research section C seam: derived artifacts are caches and will not inherit keep-forever tiering; the eviction machinery and policy are deferred to dedicated research timed with Phase 2 — only the columns land now);
  - trust: `scan_verdict` (`unscanned` | `clean` | `infected`), `scan_engine_version` (null until an engine exists), **`status`** (`pending` | `clean` | `quarantined`) — the quarantine gate (§7);
  - provenance: `version_number`, `uploaded_by`, `created_at`, `committed_at`.
- **Every explicit upload cuts a new version.** An upload whose `content_sha256` equals the current version's is the **no-op version skip** (ADR-0078): acknowledged, no version cut. The churning-`current`-key + autosave model (ADR-0035) activates with Collabora in Phase 2 — in this slice every version is deliberate, which is exactly the ADR-0035 posture.
- The **upload short-circuit** (client-precomputed hash) stays deferred per the owner's research-stage decision (research doc, section F item 3); the hash columns it would need are these.

## 6. Inbound upload path (ADR-0081)

**Principle (ratified from research):** bytes never transit the Worker — it authorizes, mints scoped credentials, and records metadata; R2 receives the bytes directly. Uniform direct-to-R2 for all sizes; the through-Worker path exists only if a future case genuinely needs inline byte access.

**Two transfer modes, one client library.** **Uppy (pinned)** with its AwsS3 plugin drives both modes and supplies drag-and-drop, progress, pause/resume, and per-part retry:

- **Single-shot:** presigned PUT, used below the mode threshold (config default 100 MB; R2 caps a single PUT at ~5 GiB).
- **Resumable multipart:** `CreateMultipartUpload` → presigned `UploadPart` URLs (parts ≥ 5 MiB, ≤ 10,000) → `CompleteMultipartUpload`. Parallel parts, per-part retry, resume by re-listing parts. R2 auto-aborts incomplete multipart uploads at 7 days — the natural session ceiling.

**Endpoints** (all through the contract pipeline, `files:upload` permission, idempotency per the 0·2 middleware):

1. `POST /v1/uploads` — initiate: validates per-firm policy (max size + content-type allow-list from the Settings registry — refuses at presign time), creates `file`/`file_version` rows in `pending` and an `upload_session` row (`upl_` handle, mode, R2 multipart upload id when applicable), returns the presigned PUT URL or the multipart session.
2. `POST /v1/uploads/{id}/parts` — mint presigned part URLs (batch).
3. `POST /v1/uploads/{id}/complete` — complete the multipart upload.
4. `POST /v1/uploads/{id}/abort` — abort and mark the session dead.

A sweep (existing cron plumbing from slice 0·4) expires stale `pending` sessions/versions past the 7-day ceiling.

**Credential custody:** one R2 S3 API token held as a Worker secret signs all presigned URLs (SigV4 via **`aws4fetch`**, pinned — the standard Workers presigner). Every minted URL is scoped to a single exact key, one method, and a short TTL (config default 15 minutes for PUT, part URLs sized to the session), so a leaked URL's blast radius is one object slot. Per-firm tokens rejected: thousands of rotating secrets for no real isolation gain — the key already embeds the firm's bucket, and the token never leaves the Worker.

**Provisioning addition:** the `FirmResourceProvider` port (slice 0·4) gains `configureBucketNotifications(firmId)` — `object-create` rule, prefix `files/`, targeting the **`files-ingest` queue** (purpose-named per ADR-0075) — run at provisioning and idempotently re-runnable for existing firms.

## 7. Quarantine ingest pipeline (ADR-0081)

**Quarantine is a status gate, not a separate key.** Bytes land at their final key; the `pending`/`quarantined` status on `file_version` makes them invisible — every list, download, preview, and signed URL is mediated by the firm-scoped data-access layer (golden rule 3), which serves `clean` versions only. Promotion is a status flip, zero bytes move. Pending-key-then-copy was rejected concretely: promotion-by-copy re-copies multi-GB objects and R2's single `CopyObject` caps at ~5 GiB (multipart copy machinery for nothing).

**Flow:** R2 event notification (`object-create`, prefix `files/`) → `files-ingest` queue → consumer Worker, which maps bucket → firm via the registry and performs **everything needing the bytes in one read**:

1. **Gates:** magic-byte type sniff (recorded as `sniffed_content_type`; the declared type may lie), real-size check against the declared size and per-firm policy (enforced a second time here — the client controls the actual bytes), decompression-bomb/nested-archive guards (zips stay opaque per ADR-0027), filename sanitization.
2. **SHA-256** over the same read (ADR-0078).
3. **Malware-scan port** — the swappable port from the white paper's untrusted-file pipeline. **No engine ships in this slice** (the engine is its own deferred ADR — flagged for future research, no timeline home yet): the launch adapter records an explicit `unscanned` verdict, and the white paper's explicit-unscanned policy applies. The verdict column, engine-version field, and the re-scan-sweep seam are engine-ready.
4. **Commit or quarantine:** all gates pass → no-op-skip check (§5), then status `clean`, `committed_at` set, metering incremented (§9), outbox `file.version_committed`. Any gate fails → status `quarantined`, outbox `file.quarantined`, staff alert through the notifications seam — **never auto-deleted** (an infected file is evidence; destruction is hold-blocked).

The consumer is idempotent (replays by `(bucket, key)` against the version row's status) — queue redelivery is safe.

## 8. Bulk download (ADR-0082, implementing ADR-0027)

- **Adopt `client-zip` (MIT, pinned)** over a hand-rolled writer: purpose-built streaming store-mode ZIP64, per-entry CRC-32 via streaming data descriptors, accepts async/stream entries so each R2 `get()` body pipes straight through — memory-flat at any archive size. A ~200-line in-house writer was rejected: it re-implements exactly this, and the library is small, focused, and pinned.
- Selection (files/folders/whole matter) resolves each file's **version key at request time** (consistent snapshot under concurrent edits); only `clean` versions are eligible; single-file selections download directly (signed URL), never wrapped.
- Firm-scoped, chokepoint-checked, **audit-logged (metadata only)**. Reading needs no permission row (trusted-insider, ADR-0068).
- **v1 ships the live stream only.** The async-job seam (build-to-R2-artifact → signed URL past a size/count threshold, retryable, dropped-connection-proof) stays a documented seam with its threshold as a config knob — **flagged for future research** (job lifecycle, artifact TTL, identical-bundle dedup; no timeline home yet — recorded in the roadmap backlog alongside the malware engine).

## 9. Storage metering (ADR-0078 as amended)

Research surfaced the Analytics Engine reality (one index per data point, 3-month retention, sampled reads): AE cannot be the authoritative billing number. **Dual model, ratified:**

- **Authoritative: exact counters in per-firm D1.** `storage_meter(storage_class, artifact_role, prefix, bytes, object_count)` — incremented inside the same write paths that create, tier, or delete objects (ingest commit, future Standard→IA `CopyObject`, future hard-destruction), so the counters cannot drift under normal operation. This is the billing/capacity number and the precise trigger for every storage adopt-when gate (ADR-0077's ~100 GB delta threshold, ADR-0056, ADR-0049).
- **Observability: AE data points** (index = firm; class/role/prefix in blobs) for dashboards and trends.
- **Reconciliation sweep:** a scheduled R2 `LIST` true-up (config default monthly) corrects drift from any out-of-band mutation.

ADR-0078's "doubles as the billing number" line is **amended** accordingly (the D1 rollup is the billing number; AE is the trend feed) — recorded in the Decision Log in this commit.

## 10. Permissions, API surface, events

**Permission registry additions** (ADR-0068 — actions, not visibility): `matters:create`, `matters:open`, `matters:close`, `matters:reopen`, `matters:edit`, `matters:renumber`, `matters:manageTypes`, `matters:manageNumbering` (the numbering routes live in the matters module — namespace matches module, ADR-0068), `locations:manage`, `files:upload`, `files:organize` (folders, rename, move), `files:delete` (soft), `files:manageDocumentTypes`. Reading and downloading stay open to firm members; exports are audit-logged.

**Routes** (all `defineOpenAPIRoute`, per-subsystem namespaces, RFC 9457 problems, idempotency where mutating):

| Area              | Routes                                                                                                                                                                                                                                                    |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Matters           | `POST /v1/matters` · `GET /v1/matters` (status/type/location/attorney filters — the Consultations folder is `status=prospective&responsibleMember=me`) · `GET/PATCH /v1/matters/{id}` · `POST /v1/matters/{id}/open` · `/close` · `/reopen` · `/renumber` |
| Types & numbering | `GET/POST/PATCH /v1/matter-types` · `GET/PUT /v1/numbering-scheme` · `POST /v1/numbering-scheme/preview`                                                                                                                                                  |
| Locations         | `GET/POST/PATCH /v1/locations` · member assignment under `PATCH /v1/locations/{id}/members`                                                                                                                                                               |
| Folders & files   | `GET/POST/PATCH/DELETE /v1/matters/{id}/folders/...` · `GET /v1/matters/{id}/files` · `GET/PATCH/DELETE /v1/files/{id}` · `GET /v1/files/{id}/versions` · `GET /v1/files/{id}/download`                                                                   |
| Upload            | `POST /v1/uploads` · `POST /v1/uploads/{id}/parts` · `/complete` · `/abort`                                                                                                                                                                               |
| Bulk download     | `POST /v1/downloads/zip` (streams)                                                                                                                                                                                                                        |
| Document types    | `GET/POST/PATCH /v1/document-types`                                                                                                                                                                                                                       |

**Outbox events:** `matter.created`, `matter.opened`, `matter.closed`, `matter.reopened`, `matter.renumbered`, `matter.updated`, `location.created`, `location.updated`, `file.version_committed`, `file.quarantined`, `file.deleted`, `folder.changed`. Consumers arrive in later slices; the events are the contract.

## 11. UI scope

Design-system components only (golden rule 2), on the 0·7a archetypes, after 0·7b ships the shell:

- **Matter list** — status-filtered (open by default), type/location/attorney facets, search.
- **Matter create/detail** — create as open (default) or as consultation; detail shows lifecycle actions per permission.
- **Consultations folder** — per-attorney view, stale-age flag, bulk-close.
- **Numbering settings** — segment editor with live preview.
- **Locations & matter-types & document-types admin.**
- **File Manager** — folder tree, file list, drag-and-drop upload (Uppy: progress, pause/resume, per-file errors), version-history panel, quarantine state visible to staff (file exists, contents unavailable), bulk-download selection.

## 12. Testing

Per [`docs/conventions/testing.md`](../conventions/testing.md) and the established slice workflow (TDD; the 7-angle adversarial review during build):

- **Unit (heavy):** the numbering renderer and counter (property tests: every surveyed format reproduces; scope resets; padding; URL-safety; concurrent allocation against real SQLite — two simultaneous draws never collide); lifecycle transitions + close-precondition hook; policy validation.
- **Integration (Miniflare):** initiate → simulated R2 event → ingest consumer → `clean` (and each gate's quarantine path); multipart session lifecycle incl. abort/expiry; no-op version skip; folder move/rename never touches R2; ZIP streaming (content + ZIP64 structure asserted); metering counter accuracy across create/delete; route registry conformance (permissions exist in the registry).
- **Fixtures:** the demo firm gains locations, a numbering scheme, matters in all three statuses, folders/files/versions — write-path factories only (ADR-0034), deterministic.
- **Owner manual verification checklist (new standard, this slice on):** every UI-bearing slice ships a human walkthrough checklist as a build deliverable — concrete visual steps the owner performs (create a year-scoped scheme and watch the preview; create a consultation, confirm no number and correct folder; convert it, watch the number draw; upload past the multipart threshold, pause/resume; verify a quarantined file is invisible as a client/insider; add a document to a closed matter). Registered in [`docs/conventions/testing.md`](../conventions/testing.md) as a definition-of-done item for UI slices.

## 13. Seam register

| Seam                                    | Reserved as                                              | Built in                                        |
| --------------------------------------- | -------------------------------------------------------- | ----------------------------------------------- |
| Matter↔party links                      | `matter_party` shape sketched (§1)                       | 1·3                                             |
| Client display fields → Directory links | migration noted (§1)                                     | 1·3                                             |
| Close preconditions                     | named hook, empty set (§2)                               | Phase 3 (zero balance)                          |
| Per-matter-type numbering schemes       | named seam (§3)                                          | when a firm needs it                            |
| Per-client counter scope                | works via `scope_key` once stable client identity exists | 1·3                                             |
| Location letterhead logo asset          | named seam (§4)                                          | Phase 2 (document automation)                   |
| Delta storage                           | `storage_encoding` column (§5)                           | Phase 2 (ADR-0077)                              |
| Derived-artifact eviction policy        | `artifact_role` + `pinned` columns (§5)                  | Phase 2 + dedicated research                    |
| Malware-scan engine                     | port + verdict/engine columns (§7)                       | own ADR — **future research, no timeline home** |
| Async bulk-download jobs                | threshold knob + documented seam (§8)                    | **future research, no timeline home**           |
| Upload short-circuit (client pre-hash)  | hash columns only                                        | future research (owner-deferred)                |
| Custom fields on matter types           | type list only (§1)                                      | 1·3 (shared engine)                             |
| Stale-consultation automation           | filter + bulk action (§2)                                | later seam                                      |

## 14. Out of scope

Directory and real party links (1·3); the `protected()` crypto module (1·2); editing/Collabora, tiering execution, previews, conversion (Phase 2); time/billing/trust (Phase 3); conflicts (Phase 4); Bates numbering (Phase 5); portal access (Phase 6); cross-matter dedup (explicitly undecided, ADR-0078); the malware-scan engine choice and the async download job (future research, above).
