# File Repair & Salvage — Plan 6b: attach-to-matter (design)

**Status:** design, awaiting review. Follows Plan 6a (stateless integration, shipped — `HEAD 5a5fa60`). This plan makes the repair tool's output *persistable*: a user can save a repaired file into a matter as a new version, or carve embedded files into a matter as new files, with honest provenance travelling with each. Design resolved with the owner 2026-07-03 (four decisions below).

## Context

Plan 6a delivered the stateless tool: `POST /api/v1/file-repair/{diagnose,repair,carve}` runs the corrupt bytes through the `magna-carta-recovery` container and returns the reconstructed files + the honest loss manifest to the browser, re-scanning and withholding on a flagged verdict. Nothing is persisted (the `none` context tag). The catalog row already carries `matterContext: "optional"` and the `file` context tag — the seam this plan fills.

Plan 6b adds the opt-in `attach-to-matter` path (the `file` context). It is a separate, shippable follow-on: no change to the stateless routes, no change to the recovery container or engine.

### Resolved decisions (owner, 2026-07-03)

1. **Source is always the uploaded corrupt file.** Even when saving a new version of an existing matter file, the client uploads the corrupt bytes in the request body — the worker never server-fetches an existing matter version as the source. One source model for every case.
2. **Both destinations.** Repair attaches as a **new version** of a target file when a `fileId` is given, else as a **new file**; carve always creates **N new files** in a chosen folder.
3. **Flagged output rides the firm's normal ingest policy.** The re-scan on attach *is* the ingest scan; a flagged reconstruction is handled by the firm's existing `flaggedTreatment` setting exactly like any upload (quarantine, or commit-marked-flagged) — no special repair rule.
4. **Provenance is persisted with the version.** A repaired/carved version is a lossy machine reconstruction; its operation and honest loss manifest are stored in a per-firm record keyed by the version, so the "this is a reconstruction, here is what was lost/synthesized" fact is surfaced whenever the file is viewed — not just at repair time. The crown rule (never overclaim) applied to durable evidence.

## Architecture — attach is a server-side upload

The decisive reuse: a normal upload is `initiateUpload` (creates a **pending** file version + upload session) → the client PUTs bytes to R2 → **the R2 object-create event drives the async ingest queue consumer** (`ingest-consumer.ts` → `runIngest` → `commitVersion` / `quarantineVersion`, applying the sniff/hash/size gate, the malware scan, and the firm's `flaggedTreatment`). The bytes never pass through the ingest route synchronously.

Attach is exactly that flow with the **worker** performing the PUT instead of the client:

```
client --corrupt bytes--> attach route
  route --> RECOVERY_SERVICE (repair|carve) --> output file(s) + loss manifest
  for each output file:
    initiateUpload(matterId, fileId?, folderId?, name)  -> pending version + r2Key   (existing fn)
    [same atomic batch] insert file_repair_provenance(versionId, operation, manifest) + file.repaired audit
    R2.put(r2Key, bytes)                                  -> emits object-create event
  route returns 202 { fileId, versionId }  (or { files: [...] } for carve)
      ...async... R2 event -> ingest queue consumer -> runIngest -> commit | quarantine   (UNCHANGED)
```

**`ingest-core.ts` and `ingest-consumer.ts` are never edited.** The scan gate, the flagged handling, the scan-once dedup cache, and the size cap are all inherited by writing to the pending version's R2 key. The re-scan is the ingest scan — no double-scan.

**Async by design.** Because ingest is queue-driven, attach returns **202 Accepted** with the `fileId`/`versionId`; the version stays *pending* until the consumer commits or quarantines it — identical to the existing upload `/complete` semantics. The tool UI (deferred) polls the version status, as the upload UI will.

## Routes

Two routes, both `surface:"app"`, `authenticated:true`, `resource:"matter"`, `audited:true`, `idempotency:"optional"`, `rateLimit:"expensive"`. The corrupt file is the octet-stream body; the attach target is query params (mirrors the stateless routes' body shape — no two-phase JSON-then-bytes handshake).

- `POST /api/v1/file-repair/repair/attach`
  - Query: `matterId` (required); `fileId` (optional → new **version** of that file); `folderId`, `fileName` (used when `fileId` is absent → new file).
  - `200`→ the container reconstructed usable content; the worker attaches it. Response **202** `{ fileId, versionId }`.
  - `422` when the engine cannot reconstruct (same as stateless).
- `POST /api/v1/file-repair/carve/attach`
  - Query: `matterId` (required), `folderId` (optional).
  - Response **202** `{ files: [{ fileId, versionId, name }] }` — one entry per carved fragment.
- No `diagnose/attach` (diagnose returns no bytes).

The stateless `diagnose`/`repair`/`carve` routes are unchanged; attach is additive.

## Pipeline detail

1. **Preflight + dispatch** reuse the stateless route's `dispatchToRecovery` (size cap, empty-body 400, missing-binding 503, stream to `RECOVERY_SERVICE`). A non-200 / 422 from the container maps to the same typed Problem as the stateless routes.
2. **Parse** the `RepairResult` (files + loss manifest) at the trust boundary (the existing zod schema).
3. **Per output file, attach:**
   - `initiateUpload(database, { matterId, fileId?, folderId?, name, declaredContentType: file.mediaType, declaredSize: bytes.length, uploadedBy, mode, uploadKind: "interactive" }, options)` — returns `{ fileId, versionId, r2Key, effect }`. `fileId` present → new version (it re-validates the file belongs to `matterId` and the folder matches); absent → new file.
   - Build the attach effect: `{ statements: [...initiated.effect.statements, insertRepairProvenanceStatement(versionId, operation, manifest, sourceMediaType), fileAuditStatement(options, operation === "repair" ? "file.repaired" : "file.carved", versionId, { fullyRecovered, lostCount, synthesizedCount }) ], outboxMessages: initiated.effect.outboxMessages }`. Execute atomically through the chokepoint's effect writer.
   - `R2.put(r2Key, bytes)` — emits the object-create event that drives ingest.
4. **Respond 202** with the version id(s). The async consumer commits or quarantines each pending version.

**Ordering & failure.** The metadata batch (pending version + provenance + audit) commits first, then the PUT. If the PUT fails, the pending version + provenance are orphaned and swept by the existing upload-session expiry/abort path (the version never commits) — the same failure shape as an abandoned client upload. Provenance for a version that never commits is harmless firm-local data.

## Provenance persistence

New per-firm table `file_repair_provenance`:

| column | type | note |
| --- | --- | --- |
| `id` | text PK | `repairProvenance_…` identifier |
| `file_version_id` | text | the attached pending/committed version; indexed |
| `operation` | text | `repair` \| `carve` |
| `fully_recovered` | integer | boolean; carve is always `0` |
| `manifest_json` | text | the verbatim `LossManifest` (items `{name,recovered,detail}`, `synthesized[]`) |
| `source_media_type` | text null | the sniffed/declared type of the corrupt input, for context |
| `created_at` | text | ISO-8601 |

`manifest_json` holds item names (e.g. ZIP entry paths, PDF object numbers). This is **firm data**, access-gated exactly like the file it describes — it is *not* the redacted error-log pipeline, so names belong here (they are the evidentiary record). It must never be copied into an error/log/Problem response.

**Repair vs. carve manifest.** A repair produces one file and stores that repair's manifest. A carve produces N files from one operation whose loss manifest describes the whole salvage (candidates found, recovered, lost); each carved file stores the **whole-operation manifest** verbatim, so every fragment carries the full "carved from an input where X was found, M recovered, K lost" context rather than a lossy per-fragment slice. `fully_recovered` is the engine's value (always `0`/false for carve).

Data-access adds `readRepairProvenance(database, versionId)` (returns the parsed row or `null`) so a file/version view can surface "machine-reconstructed — N items recovered, M lost, K synthesized" with the full manifest on demand. The presence of a provenance row *is* the reconstruction marker; no redundant `origin` column on `file_version`.

A per-firm migration creates the table + the `file_version_id` index and is wired into `per-firm-migrations.ts` and the journal (migration-number coordination as in 6a — confirm against `main` before the number is fixed).

## Audit

Two new file-audit actions, `file.repaired` and `file.carved`, added to the file-audit action vocabulary. Fired in the attach batch with **redacted** metadata only: `{ operation, fullyRecovered, lostCount, synthesizedCount }` — counts, never item names or content. The durable manifest lives in `file_repair_provenance`; the audit is the tamper-evident event that it happened.

## Authorization

`permission: "tools:fileRepair"`, `resource: "matter"` (the chokepoint scopes the actor to `matterId`). Because attach *writes files into a matter*, the handler additionally asserts the same matter file-write capability a normal upload requires, before `initiateUpload` — a dual gate (tool access + file-write). The exact composition (a second `assertPermission` in-handler vs. a chokepoint capability list) is confirmed against `route-meta.ts` / the uploads route in the implementation plan; the security requirement is fixed here: **both** the repair-tool capability and matter file-write are required.

## What is NOT in this plan (seams / deferred)

- **UI.** No tool UI — the attach routes are the API surface; the widget lands in the 0·7a shell with the rest of the tools.
- **Server-fetch of an existing matter version as source.** Out of scope by decision 1 (source is always uploaded).
- **Render-verify** of a repaired PDF (Decision E from Plan 6, deferred) is unchanged.
- **Carve destination beyond a target folder** (e.g. an auto-created "Carved from …" subfolder) — v1 places fragments directly in the given `folderId`.

## Invariants

- **Never edit `ingest-core.ts` or `ingest-consumer.ts`.** Attach composes them from the outside (server-side PUT); the scan gate and flagged policy are inherited, never re-implemented.
- **Never use `commitEditedVersion`** for repaired output — it is the trusted in-app-edit path (`scanVerdict:"unscanned"`, no scan). Repaired bytes are untrusted and MUST ride `commitVersion`/`quarantineVersion` via the ingest gate.
- **Crown rule.** The loss manifest crosses to `file_repair_provenance` verbatim; no route logic softens an honest loss. `fully_recovered` is the engine's value, never fabricated.
- **Log-safety.** Item names/details live only in `file_repair_provenance` (firm data) — never in an audit payload, error, or log.
- **Firm-scoped DAL.** All persistence is through the firm-scoped data-access layer; no query crosses firms.

## Testing

- repair → new version of an existing matter file (version number increments; provenance persisted; `file.repaired` audit).
- repair → new file (no `fileId`; file + version created; provenance; audit).
- carve → N new files in the target folder (N versions; N provenance rows; sanitized names; one 202 listing all).
- flagged reconstruction → the firm's `flaggedTreatment` governs (quarantine under `block`; commit-flagged under allow) — driven by invoking the ingest consumer (`handleIngestMessage`) over the attached pending version, with the container stub emitting the malware marker (the R2-event→queue chain is not automatic under the test pool, so the test drives the consumer directly).
- provenance round-trip: `readRepairProvenance(versionId)` returns the manifest; a committed *and* a quarantined version both carry it.
- authorization: 403 without `tools:fileRepair`; 403 without matter file-write; cross-matter `folderId` rejected (`file-cross-matter`).
- unrepairable / empty-body / oversize / missing-binding reuse the stateless Problem paths.
