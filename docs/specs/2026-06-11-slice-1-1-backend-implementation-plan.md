# Slice 1·1 Implementation Plan (backend) — Matters core, Locations & File Manager

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build slice 1·1's backend — the matter shell with the owner-shaped lifecycle, the segment-template numbering engine, Locations, and the File Manager (folders, hashed versions, direct-to-R2 upload with quarantine ingest, streaming ZIP64 bulk download, exact storage metering) — through schema, domain packages, data access, and Worker routes.

**Architecture:** Three new domain packages on the slice 0·3 `ledger` pattern (validate in memory, compose statements into the slice 0·2 `composeEffectBatch` atomic batch): `@magna-carta/locations`, `@magna-carta/matters`, `@magna-carta/file-manager`. The Worker adds the presign/upload surface (bytes never transit it), the `files-ingest` queue consumer (one read: gates + SHA-256 + scan port + commit), the ZIP streaming route, and cron sweeps. Quarantine is a status gate enforced by the data-access layer, not a key scheme.

**Tech Stack:** `@magna-carta/{identifiers,database,data-access,access-control}`, hono + the slice 0·5 `defineOpenAPIRoute` pipeline, `aws4fetch` (SigV4 presigning), `client-zip` (streaming store-mode ZIP64), `file-type` (magic-byte sniffing), Workers `crypto.DigestStream` (streaming SHA-256), Miniflare via `@cloudflare/vitest-pool-workers`.

**Spec:** [`2026-06-11-slice-1-1-matters-locations-file-manager-design.md`](2026-06-11-slice-1-1-matters-locations-file-manager-design.md) · ADR-0079–0082 (ADR-0007/0027/0031/0035/0068/0077/0078 upstream).

**UI plan:** spec §11 (matter list/detail, Consultations folder, numbering settings with live preview, admin pages, the File Manager UI with Uppy) plus the **owner manual verification checklist** is its own plan, written **after slices 0·7a/0·7b land** — writing component-level tasks against an unbuilt design system would invent APIs. The route/response shapes in this plan (Uppy-compatible upload endpoints, list filters) are the UI's contract. Until that plan exists, STATUS.md shows 1·1 Plan `[~]`.

**Build gates (do not start before):** 0·4 landed (per-firm buckets, member mirror, RBAC seeds, cron skeleton) and 0·5 landed (`defineOpenAPIRoute`, the ADR-0067 chokepoint reading `x-mc-permission`, RFC 9457 problem module). 0·6's `@magna-carta/telemetry` is assumed for Analytics Engine writes; if 1·1 starts first, stub the two metering data points behind the telemetry seam and note it.

## Decided up front (read before coding)

1. **Three packages, not one.** `locations` and `matters` are separate (Phase 3 trust accounts and Custodian reference Locations without matters); `file-manager` owns folders/files/versions/ingest-core/zip/metering. Dependency direction: `matters → locations` (number rendering reads a location code) is **forbidden** — the renderer takes a plain `RenderContext` of strings; route handlers assemble it. No domain package imports another; all import `identifiers`/`money`-style leaves and compose through `data-access`.
2. **Pin exact in the catalog at build:** `aws4fetch`, `client-zip` (v2.x — ZIP64), `file-type` (v19+ — `Uint8Array` API, no Node streams). Verify each against current docs at build (golden rule 11). `uppy` is a UI-plan dependency, not this plan's.
3. **Prefix-registry additions** (follow the file's existing shape; extend its enumeration tests): `location→loc`, `matterType→mtt`, `documentType→dty`, `numberingScheme→nsc`, `folder→fld`, `file→fil`, `fileVersion→fvr`, `uploadSession→upl`, `auditLog→alg`. `matter→mat` exists; verify at build, add if not.
4. **Minimal per-firm `setting` table now** — the ADR-0040 framework is unbuilt, but this slice needs per-firm config (upload policy, mode threshold, stale-consultation age, default Location, zip threshold, reconciliation cadence). Land the storage seam ADR-0040 will formalize: `setting(key TEXT PRIMARY KEY, value TEXT /* JSON */, updated_at)` + a typed accessor with zod-validated **defaults in code** (a missing row = the default). No settings UI this slice. This is build-when-in-the-area, scoped to the table + accessor only.
5. **Minimal per-firm `audit_log` table now** — the spec requires every mutation audited and exports audit-logged; no audit subsystem exists yet. Land the append-only row: `audit_log(id alg_ PK, event TEXT, actor_user_id TEXT, subject_id TEXT, metadata TEXT /* JSON, redacted — never privileged content */, created_at)`. Written inside the same effect batch as the mutation. The full audit subsystem (viewer, retention) is a later design; this is its storage contract.
6. **Counter allocation idiom (ADR-0079):** read `next_value` (absent row → the scheme's counter start), render the number, then compose into the batch: an ensure-row `INSERT … ON CONFLICT DO NOTHING`, a **guarded** `UPDATE matter_number_counter SET next_value = next_value + 1 WHERE scope_key = ? AND next_value = ?`, and the matter INSERT carrying the rendered number. A concurrent draw makes the guard match zero rows and the loser's matter INSERT hits the **UNIQUE index on `matter.matter_number`**, aborting its whole batch — retried by the bounded-retry idiom (ADR-0062). The UNIQUE backstop is load-bearing; the concurrency test proves two simultaneous draws yield distinct numbers on real SQLite.
7. **Scope-key encoding:** the joined rendered values of scoping-marked segments, in template order, `:`-separated (rendered values are URL-safe per spec §3, so `:` cannot appear in them); empty string = firm-wide. Manual numbers touch no counter.
8. **R2 S3 endpoint & credentials:** presigning targets `https://{accountId}.r2.cloudflarestorage.com/{bucket}/{key}` with `AwsClient` from `aws4fetch` and new Worker secrets `R2_S3_ACCESS_KEY_ID` / `R2_S3_SECRET_ACCESS_KEY` (one account-scoped R2 API token; ADR-0081 custody — every signed URL is single-key, single-method, short-TTL). Local values in `.dev.vars`; Miniflare tests stub the presigner seam (assert URL shape, never call out).
9. **Local dev cannot receive R2 event notifications.** Miniflare has queues but not R2 notification delivery. The ingest consumer therefore takes its message as data; integration tests enqueue **synthetic event messages** (the documented R2 shape: `{ bucket, object: { key, size, eTag }, action, eventTime }`). In dev, a post-upload dev-only hook enqueues the synthetic event so the local flow completes. Production rules are configured by `configureBucketNotifications` (Task 12).
10. **Streaming SHA-256 via `crypto.DigestStream`** (Workers-specific; verify current API at build) — multi-GB objects must never buffer (`crypto.subtle.digest` requires the full buffer; rejected). Magic-byte sniff reads only the head bytes (`file-type` needs ≤ 4 KiB) from the same single `get()` stream via a tee.
11. **Uppy-shaped upload endpoints.** The UI plan will use Uppy's AwsS3 plugin; its expected backend contract fixes our response shapes now: single-shot → `{ method: "PUT", url, headers }`; multipart → create `{ uploadId, key }`, sign-part `{ url }`, complete `{ location }`. Recorded in each route's zod schema (Task 11).
12. **Mode threshold default 100 MB** (single-shot ≤ threshold < multipart), per-firm policy defaults: max size 50 GiB, content-type allow-list = a permissive launch list (documents, images, audio/video, archives, email formats; **block** executables/scripts by both extension and sniffed type). All under the Task 3 settings accessor.
13. **Scan port ships engine-less:** `MalwareScanPort.scan(stream, meta) → { verdict: "unscanned" }` launch adapter. The verdict is recorded honestly; nothing pretends to be clean-by-scan (ADR-0081; engine is its own future ADR).
14. **Per-firm role seeds gain this slice's grants** (extend the 0·4 seed migration pattern in a new migration): Owner/Admin → all new permissions; Attorney → `matters:create/open/close/edit`, `files:upload/organize/delete`; Paralegal → `matters:create`, `files:upload/organize`; Billing → none new; Read-only → none. Adjustable data, not code (ADR-0068).
15. **Telemetry/AE writes go through the 0·6 telemetry package's counter path** (`storage.meter` data points; index = firm). If 0·6 hasn't landed when this builds, write behind a local `MeterTelemetry` seam and wire it when it lands.
16. **Concurrent-session discipline:** stage explicit paths only; every commit gated on `pnpm check && vp test` for the touched packages.

## File structure

```
packages/locations/
  package.json · tsconfig.json · vitest.config.ts
  src/location-service.ts            # create/update/close, addresses, member assignment (statements + validation)
  src/validation.ts                  # named-code validation (ledger pattern)
  test/…
packages/matters/
  src/numbering/segments.ts          # NumberSegment types + zod schema for scheme JSON
  src/numbering/render.ts            # renderMatterNumber + deriveScopeKey (pure)
  src/numbering/counter-statements.ts# ensure-row + guarded-increment statement builders
  src/matter-service.ts              # createMatter/openMatter/closeMatter/reopenMatter/renumberMatter/updateMatter
  src/close-preconditions.ts         # the named hook registry (empty set this slice)
  src/matter-type-service.ts         # types CRUD (soft-deactivate)
  src/queries.ts                     # list filters incl. consultations view + stale flag
  test/…
packages/file-manager/
  src/folder-service.ts              # create/rename/move/delete folders (D1 tree)
  src/file-service.ts                # initiate (pending rows), commitVersion, no-op skip, rename/move, soft delete
  src/ingest-core.ts                 # pure single-read pipeline: gates + hash + scan port -> commit|quarantine actions
  src/scan-port.ts                   # MalwareScanPort + unscanned launch adapter
  src/zip-composition.ts             # selection -> resolved clean version keys -> client-zip entry iterable
  src/metering-statements.ts         # storage_meter increment/decrement builders + reconciliation diff
  src/upload-policy.ts               # per-firm policy checks (presign-time + gate-time)
  test/…
packages/identifiers/src/prefix-registry.ts       # MODIFY (decided #3)
packages/database/src/per-firm-schema.ts          # MODIFY: all Task 2 tables
packages/database/drizzle/per-firm/               # generated migration + role-grant seed
packages/data-access/src/setting-statements.ts    # getSetting/setSetting + typed accessor w/ zod defaults
packages/data-access/src/audit-statements.ts      # insertAuditLogStatement
packages/access-control/src/registry.ts           # MODIFY: the 13 new permission keys
apps/worker/src/files/presign.ts                  # aws4fetch presigner (PUT + multipart ops), injectable
apps/worker/src/files/ingest-consumer.ts          # queue(files-ingest) handler over ingest-core
apps/worker/src/routes/{matters,matter-types,numbering,locations,folders,files,uploads,downloads,document-types}.ts
apps/worker/src/firm-resource-provider.ts         # MODIFY: + configureBucketNotifications
apps/worker/src/scheduled.ts                      # MODIFY: stale-pending sweep + metering reconciliation
apps/worker/wrangler.jsonc                        # MODIFY: files-ingest queue, secrets, crons
apps/worker/test/…                                # per task below
```

---

### Task 1: Scaffold — prefixes, packages, pins, queue

- [ ] Catalog: add `aws4fetch`, `client-zip`, `file-type` (exact latest stable each; check `npm view <pkg> version`).
- [ ] `packages/identifiers/src/prefix-registry.ts`: the decided #3 entries; extend the registry enumeration tests.
- [ ] Scaffold `packages/{locations,matters,file-manager}` mirroring `packages/ledger`'s configs (package.json exports map, tsconfig, vitest.config); deps: `@magna-carta/identifiers` + `@magna-carta/data-access` (workspace), `file-manager` also `client-zip`/`file-type`.
- [ ] `apps/worker/wrangler.jsonc`: `queues.producers += { binding: "FILES_INGEST", queue: "magna-carta-production-files-ingest" }`, `queues.consumers += { queue: "magna-carta-production-files-ingest" }` (ADR-0075 purpose-naming); mirror in the Miniflare config in `vitest.config.ts`.
- [ ] `vp install`; `vp test` (identifiers green); commit `chore(slice-1-1): scaffold domain packages, prefixes, pins, files-ingest queue`.

### Task 2: Per-firm schema + migration (`packages/database`)

- [ ] Extend `src/per-firm-schema.ts` (house conventions: TEXT identifier-handle PKs, ISO-8601 UTC text instants, INTEGER bytes/counters, no REAL):
  - `location` (`id loc_`, `name` notNull, `status` notNull default `'active'` CHECK in (`active`,`closed`), `jurisdiction`, `number_code` nullable UNIQUE, `address_block`, `footer`, `remit_to`, timestamps),
  - `location_address` (`id`, `location_id` FK, `kind` CHECK in (`physical`,`mailing`), street/city/region/postal/phone text columns, timestamps),
  - `member_location` (`id`, `member_user_id` FK→member, `location_id` FK, `is_primary` INTEGER 0/1; UNIQUE(member, location)),
  - `matter_type` (`id mtt_`, `name` notNull UNIQUE, `code` nullable UNIQUE, `active` default 1, timestamps),
  - `document_type` (same shape, `dty_`),
  - `numbering_scheme` (`id nsc_`, `segments` TEXT /_ zod-validated JSON _/, `active` INTEGER, timestamps; one active row enforced in the write path),
  - `matter_number_counter` (`scope_key` TEXT **PK**, `next_value` INTEGER notNull) — **documented fitness exception** to the handle-PK rule (a natural-key counter, like `_migrations`; extend the fitness test's allow-list with a comment),
  - `matter` (`id mat_`, `title` notNull, `description`, `status` CHECK in (`prospective`,`open`,`closed`) notNull, `matter_type_id` FK, `location_id` nullable FK, `responsible_member_id` notNull FK→member, `client_display_name`, `client_code`, `matter_number` nullable, `numbered_at`, `opened_at`, `closed_at`, timestamps; **UNIQUE index on `matter_number` WHERE not null**),
  - `folder` (`id fld_`, `matter_id` FK, `parent_folder_id` nullable self-FK, `name` notNull; UNIQUE(matter, parent, name)),
  - `file` (`id fil_`, `matter_id` FK, `folder_id` nullable FK, `name` notNull, `document_type_id` nullable FK, `current_version_id` nullable, `deleted_at` nullable, timestamps),
  - `file_version` (`id fvr_`, `file_id` FK, `version_number` INTEGER notNull, `r2_key` notNull UNIQUE, `size_bytes` INTEGER, `declared_content_type`, `sniffed_content_type`, `content_sha256`, `storage_encoding` notNull default `'full'`, `artifact_role` notNull default `'original'` CHECK in (`original`,`derived`), `pinned` INTEGER default 0, `storage_class` notNull default `'standard'` CHECK in (`standard`,`infrequent_access`), `scan_verdict` CHECK in (`unscanned`,`clean`,`infected`) nullable, `scan_engine_version`, `status` notNull default `'pending'` CHECK in (`pending`,`clean`,`quarantined`,`abandoned`), `uploaded_by`, `created_at`, `committed_at` nullable; UNIQUE(file, version_number)),
  - `upload_session` (`id upl_`, `file_version_id` FK, `mode` CHECK in (`put`,`multipart`), `r2_upload_id` nullable, `declared_size` INTEGER, `declared_content_type`, `status` CHECK in (`open`,`completed`,`aborted`,`expired`), `created_at`, `expires_at`),
  - `storage_meter` (`storage_class`, `artifact_role`, `prefix`, `bytes` INTEGER notNull, `object_count` INTEGER notNull; **composite PK** (class, role, prefix) — same documented fitness exception),
  - `setting` (decided #4) and `audit_log` (decided #5).
- [ ] Generate the next per-firm migration (`drizzle-kit generate`); append the **role-grant seed SQL** (decided #14) for the five seeded roles; expand-contract guard passes (additive).
- [ ] Extend schema fitness tests: handle-PK allow-list additions (counter, meter — with rationale comments); no-REAL holds; CHECK columns present (query `sqlite_master` for the `file_version` and `matter` CHECKs — the 0·3 pattern).
- [ ] `vp test` green; commit `feat(database): slice 1·1 per-firm schema — matters, locations, file manager, settings seam, audit log`.

### Task 3: Settings accessor (`packages/data-access/src/setting-statements.ts`)

TDD against the existing stub-d1 + `node:sqlite` patterns.

```ts
export interface FirmSettingDefinition<T> {
  readonly key: string;
  readonly schema: z.ZodType<T>;
  readonly defaultValue: T;
}
// Reads the row, parses JSON through the schema; absent row or invalid stored value -> defaultValue
// (a bad write must never brick reads; invalid values surface via a telemetry warning at the call site).
export async function readFirmSetting<T>(
  db: D1Like,
  definition: FirmSettingDefinition<T>,
): Promise<T>;
export function writeFirmSettingStatement<T>(
  db: D1Like,
  definition: FirmSettingDefinition<T>,
  value: T,
  now: string,
): Statement;
```

- [ ] Definitions live with their owning packages (e.g. `matters` exports `staleConsultationAgeDays`, `file-manager` exports `uploadPolicy`, `modeThresholdBytes`, `zipAsyncThreshold`, `defaultLocationId`, `reconciliationCadence`); the accessor is generic.
- [ ] Tests: default on absent; round-trip; invalid JSON → default; write statement composes into a batch.
- [ ] Commit `feat(data-access): per-firm setting accessor — the ADR-0040 storage seam`.

### Task 4: Audit statement builder (`packages/data-access/src/audit-statements.ts`)

- [ ] `insertAuditLogStatement(db, { id, event, actorUserId, subjectId, metadata, now })` — metadata `canonicalJsonStringify`-ed; the password-key canary test from the 0·4 auth-audit builder pattern; extend `schema-name-sync.test.ts`.
- [ ] Commit `feat(data-access): per-firm append-only audit-log statement builder`.

### Task 5: Permission registry additions (`packages/access-control`)

- [ ] Add to `PERMISSIONS` (one block per namespace, commented): `matters:create`, `matters:open`, `matters:close`, `matters:reopen`, `matters:edit`, `matters:renumber`, `matters:manageTypes`, `matters:manageNumbering`, `locations:manage`, `files:upload`, `files:organize`, `files:delete`, `files:manageDocumentTypes`.
- [ ] Registry tests extend; the database role-seed fitness (Task 2's grants ∈ registry) now passes against the grown registry.
- [ ] Commit `feat(access-control): slice 1·1 permission namespaces (matters, locations, files)`.

### Task 6: Locations package

TDD (ledger-pattern: named-code validation, statements composed for `composeEffectBatch`).

- [ ] `location-service.ts`: `createLocation`, `updateLocation`, `closeLocation` (soft only; refuse close if it is the firm-default setting — named code `location-is-firm-default`), `setLocationAddresses` (replace-set semantics), `assignMemberLocations` (enforces exactly-one-primary per member — named code `member-needs-one-primary`). Every mutation emits `location.created`/`location.updated` outbox rows + an audit row in the same batch.
- [ ] Tests: validation codes; one-primary enforcement; close refusals; statement composition (batch contains location + outbox + audit rows); round-trip on real SQLite.
- [ ] Commit `feat(locations): location service — addresses, staff assignment, soft close`.

### Task 7: Numbering — segments, renderer, scope key (`packages/matters/src/numbering/`)

Pure module; property-test heavy. No D1, no clock (dates arrive in the context).

```ts
export type NumberSegment =
  | { kind: "literal"; text: string }
  | { kind: "counter"; padWidth: number; start?: number }
  | { kind: "year"; digits: 2 | 4; scoping?: boolean }
  | { kind: "date_opened"; scoping?: boolean } // YYYYMMDD
  | { kind: "location_code"; scoping?: boolean }
  | { kind: "matter_type_code"; scoping?: boolean }
  | { kind: "client_code"; scoping?: boolean }
  | { kind: "staff_initials"; scoping?: boolean }
  | { kind: "client_name"; scoping?: boolean };

export interface RenderContext {
  // plain strings — handlers assemble it (decided #1)
  readonly openedDate: string; // ISO civil date (ADR-0055)
  readonly locationCode?: string;
  readonly matterTypeCode?: string;
  readonly clientCode?: string;
  readonly staffInitials?: string;
  readonly clientName?: string;
}

export function deriveScopeKey(segments: readonly NumberSegment[], context: RenderContext): string;
export function renderMatterNumber(
  segments: readonly NumberSegment[],
  context: RenderContext,
  counterValue: number,
): string;
export const numberingSchemeSchema: z.ZodType<readonly NumberSegment[]>; // exactly one counter segment; validates URL-safety of literals
```

- [ ] Validation in the zod schema: **exactly one counter segment**; literals URL-safe; a scoping segment whose context value is absent at render time is a named-code refusal (`scheme-segment-value-missing` — e.g. location-scoped scheme on a matter with no Location and no firm default).
- [ ] Rendering rules: counter zero-padded to `padWidth` (wider values never truncate); `client_name`/`staff_initials` sanitized to URL-safe (spaces dropped, diacritics folded); year from `openedDate`.
- [ ] Property tests: every surveyed format reproduces (`2026-00042`, `13-0001`, `RENO-26-0103`, `PI-2026-001`, `10034-00012`, `20260611`, `MC-0042`); rendered output always URL-safe; `deriveScopeKey` is exactly the scoping values in template order, `:`-joined; same context + same counter → identical render (determinism).
- [ ] Commit `feat(matters): numbering segment model, renderer, scope-key derivation (ADR-0079)`.

### Task 8: Counter statements + matter service (`packages/matters`)

- [ ] `numbering/counter-statements.ts`: `ensureCounterRowStatement(db, scopeKey, startValue)` (`INSERT … ON CONFLICT DO NOTHING`), `guardedIncrementStatement(db, scopeKey, observedValue)` (decided #6), `readCounterValue(db, scopeKey)`.
- [ ] `matter-service.ts` — all through `composeEffectBatch` + the bounded-retry idiom around number assignment:
  - `createMatter({ …, status: "prospective" | "open" })` — prospective: no number; open: assign (read counter → render → compose [ensure, guarded increment, matter INSERT, outbox `matter.created` (+`matter.opened`), audit]).
  - `openMatter(matterId)` — prospective→open transition + number assignment (same idiom); named codes `matter-not-prospective`, `scheme-missing`.
  - `closeMatter(matterId)` — runs `close-preconditions.ts` registry (empty this slice; the hook takes `{ matterId, db }` and returns named-code failures — Phase 3 registers the zero-balance check); sets `closed_at`; works from `prospective` (declined consultation) and `open`.
  - `reopenMatter`, `updateMatter` (title/description/type/location/attorney/client display fields), `renumberMatter({ matterNumber })` — manual/court/legacy entry: validates URL-safety + firm-uniqueness (UNIQUE backstop + bounded retry), never touches a counter; also usable to assign a manual number to a prospective.
  - Every mutation: outbox event + audit row in the batch (events per spec §10).
- [ ] Tests: full lifecycle paths incl. refusal codes; number drawn at open not creation for prospectives; **the concurrency proof** — two concurrent `openMatter` batches against real SQLite (`node:sqlite`): one succeeds, one retries to the next value, both numbers distinct and sequential; manual number colliding with a future counter draw → the draw retries past it; scheme edit affects only later matters.
- [ ] Commit `feat(matters): matter service — lifecycle, atomic number allocation, manual numbering (ADR-0079/0080)`.

### Task 9: Matter types + queries (`packages/matters`)

- [ ] `matter-type-service.ts`: create/update/deactivate (soft; named code `type-in-use` only blocks hard paths — there are none); UNIQUE name/code surfaced as named codes.
- [ ] `queries.ts`: `listMatters({ status?, matterTypeId?, locationId?, responsibleMemberId?, search? })` — main list **defaults to excluding `prospective`**; `listConsultations({ responsibleMemberId, now, staleAgeDays })` returns prospectives with an `isStale` flag; both paginated (the api.md conventions).
- [ ] Tests: default exclusion of prospectives; stale flag boundary (created exactly `staleAgeDays` ago → stale); filters compose.
- [ ] Commit `feat(matters): matter types + list/consultations queries`.

### Task 10: File Manager domain — folders, files, versions (`packages/file-manager`)

- [ ] `folder-service.ts`: create/rename/move/delete (delete only when empty — named code `folder-not-empty`); move cycle-check (`folder-cycle`); UNIQUE(matter,parent,name) → `folder-name-taken`.
- [ ] `file-service.ts`:
  - `initiateUpload({ matterId, folderId, name, declaredSize, declaredContentType, uploadedBy, mode })` → composes pending `file` (or version-on-existing-file), `file_version` (status `pending`, `r2_key = files/{fileId}/{versionId}`), `upload_session`; refuses on policy (`upload-policy-size`, `upload-policy-type` — via `upload-policy.ts` reading the Task 3 settings).
  - `commitVersion({ versionId, sizeBytes, sniffedContentType, contentSha256, scanVerdict, scanEngineVersion, now })` → **no-op skip check** (hash equals the file's current version's hash → mark session `completed`, version `abandoned`, return `skipped: true`); else status `clean`, `committed_at`, bump `file.current_version_id` + `version_number`, metering increments (Task 11), outbox `file.version_committed`, audit.
  - `quarantineVersion({ versionId, reason })` → status `quarantined`, outbox `file.quarantined`, audit.
  - `renameFile`/`moveFile` (metadata only — tests assert no R2 statements), `softDeleteFile` (sets `deleted_at`; versions untouched), document-type assignment; `document_type` CRUD mirrors matter types.
  - **Read mediation:** every list/get/download query filters `status = 'clean'` (and `deleted_at IS NULL` for default lists) — the quarantine gate (golden rule 3). A grep-style fitness test asserts no query in the package selects `file_version` without a status predicate (the 0·3 source-scan pattern).
- [ ] Tests: pending invisible in lists; commit flips visibility; no-op skip; quarantine path; folder rules; soft-delete excluded by default + recoverable query.
- [ ] Commit `feat(file-manager): folders, files, versions — pending/clean/quarantined status gate (ADR-0081)`.

### Task 11: Metering (`packages/file-manager/src/metering-statements.ts`)

- [ ] Increment/decrement builders keyed (storage_class, artifact_role, prefix = top-level R2 key segment, today always `files`): `meterCommitStatements(version)` (+bytes, +1), future-facing `meterTierChangeStatements`, `meterHardDeleteStatements` (built + tested now, consumed by Phase 2 — they are the contract).
- [ ] `reconciliationDiff(listedObjects, meterRows)` — pure: aggregates an R2 `LIST` result and returns correction statements + a drift report (consumed by Task 15's cron).
- [ ] AE data-point emission behind the decided #15 seam: `emitMeterDataPoint(telemetry, firmId, meterRow)`.
- [ ] Tests: commit increments exactly once (idempotent-replay safe — increments live inside the same batch as `commitVersion`, replays no-op with it); reconciliation corrects an injected drift; prefix derivation.
- [ ] Commit `feat(file-manager): exact storage metering + reconciliation (ADR-0078 as amended)`.

### Task 12: Ingest core + scan port (`packages/file-manager/src/ingest-core.ts`)

The pure single-read pipeline; the Worker consumer (Task 14) is a thin shell around it.

```ts
export interface MalwareScanPort {
  scan(
    body: ReadableStream<Uint8Array>,
    meta: { sizeBytes: number; sniffedContentType: string | null },
  ): Promise<{ verdict: "unscanned" | "clean" | "infected"; engineVersion: string | null }>;
}
export const unscannedAdapter: MalwareScanPort; // launch adapter — decided #13

export interface IngestInput {
  readonly objectBody: ReadableStream<Uint8Array>;
  readonly objectSize: number;
  readonly version: PendingVersionRow; // declared size/type, expected key
  readonly policy: UploadPolicy; // re-checked against real bytes (ADR-0081)
  readonly scanPort: MalwareScanPort;
}
export type IngestOutcome =
  | {
      kind: "commit";
      sizeBytes: number;
      sniffedContentType: string | null;
      contentSha256: string;
      scanVerdict: "unscanned" | "clean";
      scanEngineVersion: string | null;
    }
  | {
      kind: "quarantine";
      reason: "type-mismatch" | "size-mismatch" | "policy-size" | "policy-type" | "scan-infected";
    };
export async function runIngest(input: IngestInput): Promise<IngestOutcome>;
```

- [ ] One pass over the stream: tee → head bytes to `file-type` sniff; full stream through `crypto.DigestStream("SHA-256")` (decided #10) and the scan port. Size from R2 object metadata cross-checked against declared (tolerance: exact) and policy max.
- [ ] Quarantine reasons are named and tested individually; an `unscanned` verdict **commits** (explicit-unscanned policy — quarantine is for failed gates and `infected` only).
- [ ] Tests (Workers pool — DigestStream): known-bytes hash matches; a `.docx` magic-byte sniff; declared-type lie → `type-mismatch`; oversize → quarantine; infected stub adapter → quarantine; unscanned → commit.
- [ ] Commit `feat(file-manager): single-read ingest core + engine-less malware-scan port (ADR-0081)`.

### Task 13: Presign service + upload routes (`apps/worker`)

- [ ] `src/files/presign.ts` — injectable `AwsClient` seam:

```ts
export interface R2Presigner {
  presignPut(
    bucket: string,
    key: string,
    contentType: string,
    expiresSeconds: number,
  ): Promise<string>;
  createMultipartUpload(
    bucket: string,
    key: string,
    contentType: string,
  ): Promise<{ uploadId: string }>;
  presignUploadPart(
    bucket: string,
    key: string,
    uploadId: string,
    partNumber: number,
    expiresSeconds: number,
  ): Promise<string>;
  completeMultipartUpload(
    bucket: string,
    key: string,
    uploadId: string,
    parts: { partNumber: number; etag: string }[],
  ): Promise<void>;
  abortMultipartUpload(bucket: string, key: string, uploadId: string): Promise<void>;
}
```

(aws4fetch implementation per decided #8; unit tests over a stubbed `fetch` assert SigV4 URL shape — `X-Amz-Signature`, single key, method, expiry — never network.)

- [ ] Routes (`defineOpenAPIRoute`, `x-mc-permission: files:upload`, `idempotency: required` on initiate, Uppy shapes per decided #11):
  - `POST /v1/uploads` → `initiateUpload` (Task 10) + mode pick by threshold → single-shot `{ mode: "put", url, headers }` or `{ mode: "multipart", uploadId: session.id, key }`.
  - `POST /v1/uploads/{id}/parts` (body: part numbers) → signed part URLs; session must be `open` (else 409 problem).
  - `POST /v1/uploads/{id}/complete` → `completeMultipartUpload` + session `completed` (+ dev-only synthetic event enqueue, decided #9 — also after single-shot via a dev `PUT`-callback test hook).
  - `POST /v1/uploads/{id}/abort` → abort + session `aborted`, version `abandoned`.
- [ ] Integration (Miniflare, stubbed presigner): policy refusal at initiate (size, type); mode threshold boundary; part-sign on closed session 409s; abort path; idempotent initiate replay.
- [ ] Commit `feat(worker): direct-to-R2 upload surface — presign + multipart session lifecycle (ADR-0081)`.

### Task 14: Ingest consumer + bucket notifications (`apps/worker`)

- [ ] `src/files/ingest-consumer.ts` — `queue()` handler for `files-ingest`: parse the R2 event (decided #9 shape) → bucket→firm via registry → version row by `r2_key`; not found or not `pending` → ack (idempotent no-op); else `env`-bucket `get()` → `runIngest` → `commitVersion` or `quarantineVersion` (Task 10) — each an idempotent effect batch. Throw on transient failures (queue retry → DLQ at max, the 0·2 relay discipline).
- [ ] `firm-resource-provider.ts`: `configureBucketNotifications(firmId)` — REST `PUT /accounts/{account}/event_notifications/r2/{bucket}/configuration/queues/{queueId}` (verify exact API at build) with rule `{ actions: ["PutObject","CompleteMultipartUpload"], prefix: "files/" }`; dev adapter records-and-no-ops. Idempotently re-runnable; wired into the provisioning orchestration after `createBucket`.
- [ ] Integration: synthetic event for a pending version → clean + visible + metered + outbox event; replayed event → no double commit/meter; type-lie upload → quarantined + invisible + alert outbox row; event for unknown key → acked.
- [ ] Commit `feat(worker): files-ingest queue consumer + provisioning bucket-notification rule (ADR-0081)`.

### Task 15: Matters/Locations/types/numbering routes + cron sweeps (`apps/worker`)

- [ ] Routes (each `defineOpenAPIRoute` with its spec §10 permission, `idempotency: required` on mutations, problems per api.md):
  - `routes/matters/matters.ts`: create/list/get/patch + `open`/`close`/`reopen`/`renumber` actions; list filters incl. the consultations view (`status=prospective&responsibleMember=me`); close failure returns the precondition codes as a 422 problem `errors[]`.
  - `routes/firm/matter-types.ts`, `routes/firm/document-types.ts`, `routes/matters/locations.ts` (+ member assignment), `routes/firm/numbering.ts`: `GET/PUT /v1/numbering-scheme` (PUT validates via `numberingSchemeSchema`, `matters:manageNumbering`) + `POST /v1/numbering-scheme/preview` (pure render with a sample context — no counter touch).
- [ ] `scheduled.ts` additions: **stale-pending sweep** (sessions/versions past `expires_at` → `abortMultipartUpload` + session `expired` + version `abandoned`) and **metering reconciliation** (per active firm on the configured cadence: R2 `list({ prefix: "files/" })` paginated → `reconciliationDiff` → corrections batch + drift telemetry event).
- [ ] Integration: route happy paths + permission 403s (a Read-only member); preview never increments a counter (assert counter table untouched); sweep expires an old open session; reconciliation corrects a manually-skewed meter row.
- [ ] Commit `feat(worker): matters/locations/numbering routes + upload-expiry and reconciliation crons`.

### Task 16: Files/folders routes + downloads (`apps/worker`)

- [ ] `routes/files/folders.ts` + `routes/files/files.ts`: folder CRUD; file list (folder/matter scoped, `clean`+undeleted only), get, patch (rename/move/document-type), delete (soft), versions list; `GET /v1/files/{id}/download` → 302 to a presigned **GET** URL for the current clean version (single-key, short TTL — reuses the presigner) + an `audit_log` export row.
- [ ] `routes/files/downloads.ts`: `POST /v1/downloads/zip` `{ matterId?, folderIds?, fileIds? }` → resolve selection to clean current versions **at request time** (ADR-0082) → single file → 302 like above; multiple → stream `makeZip` (client-zip) of R2 `get()` bodies as `Response` (`Content-Disposition: attachment`), entry paths = folder-tree paths; audit row with `{ fileCount, totalBytes }` metadata only. The async-job threshold knob (`zipAsyncThreshold` setting) is **read and recorded in the audit row but not yet acted on** — the seam stays documented (future research).
- [ ] Integration: zip of a 3-file selection round-trips (unzip in test, byte-equal + paths correct); a pending/quarantined version never appears in zip or download; version pinned under a concurrent commit (commit between resolve and stream → archive holds the resolved version); single-file selection 302s.
- [ ] Commit `feat(worker): file/folder routes, signed single-file download, streaming ZIP64 bulk download (ADR-0082)`.

### Task 17: End-to-end + conformance fitness

- [ ] `apps/worker/test/slice-1-1-e2e.test.ts`: provision firm → create Location (RENO) + matter type (PI) + a location+year-scoped scheme → attorney creates a **consultation** (no number, in their consultations view, absent from main list) → client retains: `open` draws `RENO-26-0001` → upload a file (initiate → synthetic bytes → synthetic event → clean) → re-upload same bytes (no-op skip, still one version) → upload an oversize file (quarantined, invisible) → bulk-download zip (one clean file inside) → close the matter (succeeds, empty preconditions) → add a document to the **closed** matter (succeeds — archived-but-additive) → second firm sees none of it (isolation assert).
- [ ] Conformance fitness (the 0·4 pattern over the emitted OpenAPI document): every new mutating route carries `x-mc-audited`, non-null `x-mc-idempotency`, registry-known `x-mc-permission`; the file-manager status-predicate source scan (Task 10) runs repo-wide over `apps/worker` too.
- [ ] Full `vp test` + `pnpm check` green; commit `test(worker): slice 1·1 backend end-to-end + conformance fitness`.

### Task 18: Docs + closeout (golden rule 5 — same PR)

- [ ] Per-package `CLAUDE.md` for `locations`, `matters`, `file-manager` (area template; the status-gate invariant, the counter idiom, the no-R2-key-from-path rule).
- [ ] [`docs/conventions/invariants.md`](../conventions/invariants.md): add the File Manager invariants (versions immutable; quarantine gate = status + data-access mediation; soft-delete only; R2 keys opaque) and the numbering invariant (frozen at assignment; UNIQUE per firm).
- [ ] `ROADMAP.md` (slice to Now/shipped per its conventions) + `CHANGELOG.md` entry + `STATUS.md` (Built `[x]` when the adversarial review pass completes — the workflow's 7-angle review runs during this build).
- [ ] Decision Log: amendments only if a build-time verification (decided #2, #8, #10, #14 API shapes) deviated.
- [ ] No user docs yet (no UI — they land with the UI plan, which this task formally hands off: write `2026-XX-XX-slice-1-1-ui-implementation-plan.md` once 0·7a/0·7b are Built, covering spec §11 + the owner manual verification checklist).
- [ ] `pnpm check`; commit `docs: slice 1·1 backend closeout`.

## Self-review (spec coverage)

§1 matter shell → Tasks 2, 8, 9 · §2 lifecycle & consultations → Tasks 8, 9 (close-precondition hook: Task 8; stale flag: Task 9) · §3 numbering → Tasks 7, 8 (+ settings surface Task 15) · §4 Locations → Tasks 2, 6, 15 · §5 files/versions/folders → Tasks 2, 10 (artifact_role/pinned/storage_encoding columns: Task 2; no-op skip: Task 10) · §6 upload path → Tasks 13, 14 (credential custody decided #8; policy double-enforcement Tasks 10+12) · §7 quarantine ingest → Tasks 12, 14 · §8 bulk download → Task 16 · §9 metering → Tasks 11, 15 (ADR-0078 amendment honored: D1 authoritative, AE via seam) · §10 permissions/routes/events → Tasks 5, 8 (events in batches), 13–16, 17 (conformance) · §11 UI → deferred to the named UI plan (Task 18 hands off) · §12 testing → distributed per task + Task 17 e2e; owner checklist belongs to the UI plan · §13 seams → columns Task 2, hook Task 8, knob Task 16, port Task 12 · §14 out-of-scope honored (no Collabora/preview/tiering-execution/dedup/engine tasks).
