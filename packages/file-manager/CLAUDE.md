# @magna-carta/file-manager — CLAUDE.md

**Purpose.** The File Manager domain module: the D1 folder tree over opaque per-firm R2 keys,
`file`/`file_version` with the pending → clean/quarantined/unscanned/suspicious status flow, the
single-read ingest pipeline (magic-byte gates + streaming SHA-256 + scan port → commit or quarantine),
per-firm upload policy, exact storage metering + reconciliation, and the bulk-download selection resolver.
Validates in memory and composes statements into @magna-carta/data-access's `composeEffectBatch`; never
runs logic mid-transaction.

**White paper:** _Matters and File Manager_ —
[`docs/Magna-Carta-White-Paper.md`](../../docs/Magna-Carta-White-Paper.md). (ADR-0077, ADR-0078, ADR-0081, ADR-0082.)
**Spec:**
[`docs/specs/2026-06-11-slice-1-1-matters-locations-file-manager-design.md`](../../docs/specs/2026-06-11-slice-1-1-matters-locations-file-manager-design.md).

## Key files / entry points

- `src/folder-service.ts` — create/rename/move/delete folders (delete only when empty; cycle-checked in
  the service AND again inside the move `UPDATE`, since the read-then-write window is real)
- `src/file-service.ts` — `initiateUpload`, `commitVersion` (with the no-op hash-skip), `quarantineVersion`, rename/move/soft-delete, upload-session lifecycle
- `src/ingest-core.ts` — the pure single-read pipeline (`runIngest`); the Worker consumer is a thin shell. Also `measureContent`, the hash-only re-measurement the consumer's custody check runs against an already-committed object
- `src/content-type-equivalence.ts` — `contentTypesAgree`: does the sniffed container type describe the same bytes as the declared type (the compound-file and ZIP families), with unknown pairs failing closed
- `src/scan-port.ts` — `MalwareScanPort` (returns a `RawScanResult` of engine facts: clamd state, structural heuristic, YARA matches with tier/score, per-leg timings) + the engine-less `unscannedAdapter` launch adapter
- `src/verdict.ts` — `computeVerdict(raw, policy)` turns the raw facts + a firm scan policy into a `clean | flagged | unscanned` file verdict (the per-firm decision, app-side); `scanDetailFor(verdict)` is the single home for what a committing verdict writes into `scan_detail` (the `active-content` badge, the unscanned reason, the flagged reason) — every writer that has a `FileVerdict` in hand calls it, because three of them once decided it separately and two disagreed. Three committing call sites deliberately do not, because they have no verdict to hand it: the over-cap commit records `oversize` (below) and `commitEditedVersion`/`restoreVersion` in `file-service.ts` commit `unscanned` with no reason at all. A caller that QUARANTINES also skips it and writes its own reason; `ScanFaultError` marks a deployed-engine-unavailable fault the consumer must retry
- `src/queries.ts` — the status-gated reads (`listFiles`, `getCurrentCleanVersion`, `listCleanVersions`, `listFoldersByMatter`, `listCleanCurrentVersionsByMatter`)
- `src/metering-statements.ts` — the storage-meter delta/commit/tier/delete builders + `reconciliationDiff` + `normalizeR2StorageClass`
- `src/scan-policy-settings.ts` — the three firm scan-policy `FirmSettingDefinition`s (`scan.policy`, `scan.flagged_treatment`, `scan.step_up_reauth_on_flagged`) + `readFirmScanPolicy` / `readFlaggedTreatment` / `readStepUpReauthOnFlagged` helpers; defaults preserve today's behaviour (`extended/75/block/off`)
- `src/upload-policy.ts` — per-firm policy checks (presign-time + gate-time) + the mode threshold and the live-download threshold setting definitions (`liveMaxFileCount` / `liveMaxTotalBytes`, superseding `zipAsyncThreshold`)
- `src/zip-composition.ts` — pure selection → clean-current entries + folder-tree paths, plus the content-addressed `bundleManifestHash` (the async-build dedup/artifact key)
- `src/archive-members.ts` — **the ONE door into an archive's contents**, for every format at once: the dispatch for both halves (list, and take one member out), one refusal vocabulary, the firm's caps, and the per-attempt accounting. See the section below

## Archives — one door, four formats, two different questions

`src/archive-members.ts` is the only way in. Nothing else may read an archive's contents, and a fifth
format is a case in its two switches rather than a new path beside them.

- **Listing and extraction are written together and dispatch together.** An extractor locates bytes
  using facts the listing read, so a member carries its own `ArchiveMemberLocator` — the zip's
  central-directory entry, the tar's data offset, the 7z's member index — and a caller never
  assembles one or reads inside one. A listing that forgot a member's offset would be an extractor
  that cannot find it, which is why they are not separable.
- **One refusal vocabulary, whatever said so.** "Password-protected inside the archive" is the same
  fact to a reader whether a zip's general-purpose flag or a 7z's AES coder produced it. A surface
  that had to learn each format's spelling would show one of them as a generic failure.
- **The caps are applied in the module, before any format-specific code runs.** A directory or a
  non-file entry, a member whose own header already exceeds the firm's ceiling, and a member that
  would carry the request past its shared budget are all refused there — so a new extractor cannot be
  written that forgets them. What only a format can know (does this stream inflate to what it
  promised) each extractor checks for itself.
- **The budget is per REQUEST and does not reopen.** Once it is spent, every later member is refused
  even if a small one would fit: letting them through would make the result depend on the order
  somebody clicked. `ArchiveExtraction` holds it, which is why extraction is a session rather than a
  bare function.
- **Every attempt is recorded, including refusals the module did not make.** The ingest gate refusing
  a filed member is still a fact about that member, so the route calls `recordExternalRefusal`. An
  account of a request that holds only the archive's own refusals is not an account of the request.
- **An engine-backed format arrives as a PORT.** 7z needs a real decoder for both halves, and under
  Workers a WebAssembly module is supplied by the bundler at the import site — so this package
  declares `SevenZipEnginePort` and `apps/api-worker/src/files/seven-zip-engine.ts` fills it, the same
  seam `MalwareScanPort` uses. This package must never import a WebAssembly artefact: it would carry
  a binding only one of its consumers could satisfy. An absent engine is a named refusal, never a crash.
- **Listing and extracting are different questions and a format may answer one and not the other.**
  `archiveExtractability` settles it once per archive, before any member is named. **rar is
  deliberately listable and not extractable** — walking its block headers needs no decoder, and
  decoding its packed data has no memory-safe implementation to build against (golden rule 14), so
  this is a boundary rather than a gap. Do not "finish" it by pulling in unrar.
- **A 7z's cost is its BLOCK, not its member.** A solid block is one compressed stream over several
  members, so reaching the fourth means decoding the three before it. The block ceiling exists
  because a small member can sit at the end of a block that unpacks to gigabytes; bounding only what
  the caller keeps bounds the wrong number.

## Invariants that apply here

- **The quarantine gate is a status gate, not a key scheme.** Every read of `file_version` filters
  `status = 'clean'` (and `deleted_at IS NULL` for default lists). A pending or quarantined version is
  never servable. A source-scan fitness function rejects any `file_version` SELECT without a status
  predicate (allowlist a legitimate all-status read with an inline `fitness:allow-no-status` marker).
- **A version-lifecycle batch is all-or-nothing.** The guarded status change (`… AND status = 'pending'`)
  protects only the statement carrying it; everything that follows from it — the meter delta, the
  current-version bump, the session flip, the audit row, the outbox message — has no such predicate.
  Every such batch therefore carries `assertVersionStatusStatement` immediately after the status change:
  it is a no-op when the change landed and a constraint violation when it did not, so a lost race to an
  abort or expiry rolls the whole batch back instead of committing the consequences of a change that
  never happened. Adding a statement to one of these batches means keeping it behind that assertion.
- **A pending version always has a path out.** Two sweeps in the worker's daily pass close the two ways
  one gets stuck: `sweepStalePendingUploads` reclaims sessions the client abandoned (still `open` past
  their expiry), and `redriveStrandedPendingVersions` re-enqueues the ingest for a `completed` session
  whose version is still `pending` past `STRANDED_PENDING_DEADLINE_MILLISECONDS` — the shape a
  dead-lettered ingest leaves behind. The re-drive is safe to repeat: a still-pending version ingests
  normally, and one that committed meanwhile takes the custody branch, which re-verifies the stored
  bytes against the recorded hash.
- **Versions are immutable; soft-delete only.** A committed version's bytes/metadata never change; a new
  version is a new row + a new R2 key. Files soft-delete (`deleted_at`); versions are untouched.
- **A soft-deleted file takes no writes.** Every mutation in `file-service.ts` resolves its file through
  `requireLiveFile`, which refuses a row with `deleted_at` set (`file-deleted`); the routes answer that
  with the same 404 an unknown file gets, so a write is never the path that reveals a deleted file.
  `requireFileIncludingDeleted` exists for the one surface that must see a deleted row — the undelete.
  A new write path picks the live helper unless it is part of recovery.
- **A verdict binds to bytes, not to a key.** The presigned PUT that delivered an upload outlives the
  commit, so the object behind a committed version can be overwritten. An R2 object-create event for an
  already-committed version is therefore an overwrite signal: the ingest consumer re-measures the stored
  bytes against the recorded `content_sha256` and, on a mismatch, withdraws the version
  (`quarantineCommittedVersion`) and scans what replaced it — the swapped content is never re-committed
  onto the version, and a clean verdict is never left standing over content nothing inspected. The
  withdrawal repoints `file.current_version_id` at the newest still-clean version (or null), because the
  file listing joins through that pointer on the strength of it being clean by construction.
- **Sniffed-vs-declared is a container comparison, not string equality.** A magic-byte sniff names the
  container: every pre-2007 Office document reports `application/x-cfb`, and an OOXML/OpenDocument file
  reports the bare archive whenever its marker entries fall outside the head window. `contentTypesAgree`
  (content-type-equivalence.ts) normalizes case/parameters and consults an explicit table of container
  relationships; pairs outside the table still quarantine as `type-mismatch`. The gate re-checks the
  upload policy against the SNIFFED type, so agreeing here never widens what a firm accepts.
- **A version's object carries its matter in its metadata, not in its key.** `initiateUpload` and
  `initiateCheckin` return the `dimensions` the bytes must be written with (built by
  `@magna-carta/object-dimensions`), and every caller — the presigned PUT, the multipart create, and the
  paths that write the bytes themselves — passes that value through unchanged. It is minted once, where
  the matter is known, so an object's scope cannot differ by upload route. A new path that reserves a
  version and then writes bytes takes the same value; one that re-derives the matter has invented a
  second source for a fact that has one.
- **R2 keys are opaque and server-minted** — `files/{fileId}/{versionId}` (interactive lane) or
  `bulk/{fileId}/{versionId}` (bulk lane) — never derived from a client-supplied path. Both key prefixes
  meter under the `files/` logical dimension. The bytes bypass the Worker (direct-to-R2 via presigned URLs).
- **No-op version skip.** A re-upload whose content hash equals the file's current version's hash marks
  the session completed and the new version abandoned — one logical version, not a duplicate.
- **Ingest is one read.** `runIngest` reads the object once: a short tee gives the magic-byte sniff its
  head bytes (then cancels), and what follows splits on the inspectable-size cap. Over the cap only the
  digest consumes the body, so it streams into `crypto.DigestStream` and a multi-GB object never
  buffers. Under the cap the digest AND the scan port both need every byte; that body is read into
  memory once and both are fed from it, because a second tee couples nothing (the faster consumer runs
  ahead and the runtime holds the rest for the slower one anyway) while the cap does bound the buffer.
  The buffer is allocated at the reported size and digested as it fills, so the peak is the object
  plus one chunk; the read stops the moment the body exceeds the size R2 reported, so a lying object
  size cannot grow it past the cap.
- **The inspectable-size cap is a memory bound before it is a policy.** A Worker isolate has 128 MB,
  so `IN_MEMORY_INSPECTION_CEILING_BYTES` (40 MiB, `upload-policy.ts`) is both the setting's default
  and the most it can ever be: `readInspectableSizeCap` reads a larger stored value as the ceiling,
  and `runIngest` clamps whatever it is handed again. A firm may tighten the cap, never loosen it.
  The multi-gigabyte default this replaced sent every recording longer than a few minutes down the
  in-memory lane and out of memory on each delivery, so the version stayed `pending` for good. The
  inline routes that load a whole body on the strength of this number (OCR, repair, integrity,
  decryption, seal, the email entrances) share the bound for the same reason.
- **Uninspectable-file split (inspectable-size short-circuit).** Files that exceed the inspectable-size
  cap bypass the scan port and commit unconditionally as `unscanned` with `scan_detail: "oversize"` — no
  extension allow-list classification occurs at this boundary; large legitimate files are not suspicious
  for being big. Files within the cap follow the normal scan path: the engine returns raw facts and
  `computeVerdict` (verdict.ts) decides app-side. An `unscanned` verdict (e.g. reason `encrypted`) commits
  with `scan_detail` set to that reason (a "not scanned" badge); a `flagged` verdict (clamd signature, a
  counting YARA match, or a structural heuristic: decompression-bomb / archive-nesting / archive-entry-count)
  quarantines with reason `scan-flagged`. The real engine is **built** — the `containers/scan` Rust Container
  (clamd + yara-x + structural heuristics) behind the worker `containerScanAdapter` — but it is dormant until
  its deploy-time wrangler activation; until then `resolveScanPort` runs the launch `unscannedAdapter`
  (raw facts → `unscanned`/`no-engine`), so this mapping does not yet fire in production.
- **Scan verdict policy.** The container reports raw facts; `computeVerdict(raw, policy)` decides per firm.
  `clean` commits the version; an active-content heuristic commits clean with `scan_detail: "active-content"`
  as a badge (PDF JavaScript / Office macros); execution defenses are the safe-delivery sandbox (a later
  slice) and the upload-policy extension blocklist. CDR (Content Disarm & Reconstruction) is not part of this
  platform. `flagged` (any signal that counts under the firm's policy) quarantines with reason `scan-flagged`;
  `unscanned` commits (encrypted, or no engine — explicit launch policy, pending the real engine). A
  deployed engine reporting unavailable raises `ScanFaultError` — the consumer retries, never commits.
- **`scan_detail` records the badge/quarantine reason** — the human-readable string written to the
  `file_version.scan_detail` column explaining why a version received its verdict (e.g. the rule hit, the
  over-size reason, or the suspicious-type classification).
- **Firm scan-policy settings control flagging and treatment.** `scan.policy` `{tier, suspiciousScoreFloor}` is resolved via `readFirmScanPolicy` before every `computeVerdict` call. A `flagged` result is then routed by `scan.flagged_treatment`: `block` quarantines (prior behaviour); `informed-access` and `allow-and-flag` commit the version with `scanVerdict: "flagged"` — the file is persisted but access-gated. The download/preview gate re-reads `flaggedTreatment` at request time (`scan-policy-settings.ts`), so a policy change takes effect on the next request without re-ingesting. `scan.step_up_reauth_on_flagged` surfaces `stepUpRequired: true` in 409 responses; the actual re-auth challenge is a future auth-slice seam.
- **Two ingest lanes: interactive (`files/` queue) + bulk (`bulk/` queue).** Interactive ingests run on
  the `files-ingest` queue (bounded concurrency, low latency, interactive UI path). Bulk ingests run on
  the `magna-carta-production-files-ingest-bulk` queue (higher-throughput, background). Both lanes share
  the same `runIngest` core and metering under the `files/` dimension — the dimension is unchanged by
  lane.
- **Metering is exact in D1, reconciled against R2, and copied nowhere.** The rollup moves in the same
  batch as the version it counts; the scheduled R2 LIST corrects drift (R2 reports the default tier as
  `""`/PascalCase — `normalizeR2StorageClass` maps it to the lowercase token before the diff). No
  analytics store holds a per-firm copy and no trend is kept: `metering-statements.ts` records why, and
  a storage history — if one is ever wanted — is a periodic snapshot row in the firm's own database,
  never a data point indexed by the firm in a cross-firm aggregate dataset.
- **Weekly re-scan sweep (`0 4 * * 0`).** A cron trigger re-queues `unscanned` versions for
  re-inspection when a new scan engine becomes available.

## Dependencies & contracts

- Depends on `@magna-carta/data-access`, `@magna-carta/database`, `@magna-carta/identifiers`,
  `client-zip` (store-mode ZIP64), `file-type` (magic-byte sniff). Holds no D1 binding; the Worker passes
  the database and the R2/presigner seams in.
- The malware-scan engine (`MalwareScanPort`) reports **raw facts** (`RawScanResult`); the per-firm verdict
  (`clean` / `flagged` / `unscanned`) is computed app-side by `computeVerdict` (verdict.ts). The engine is
  **built** — the `containers/scan` Container (ClamAV + yara-x + Rust structural heuristics) + the worker
  `containerScanAdapter`, selected by `resolveScanPort` when its binding is present. The binding is a
  deploy-time activation (the container can't run under the local test pool), so the launch adapter still
  yields an honest `unscanned`/`no-engine` verdict in every test/dev env until the engine is wired in production.

## Gotchas

- D1 has no interactive transactions — read before composing, or assert inside the batch.
- **Bulk download has three delivery paths (Plan 3 built).** A single-file selection 302-redirects to a
  presigned GET; a multi-file selection under both live thresholds (`liveMaxFileCount` /
  `liveMaxTotalBytes`) streams a ZIP inline; over either threshold the worker download route hands off to
  the background build job — a content-addressed `bundles/<manifestHash>.zip` coordinated by the
  `BundleBuildCoordinator` Durable Object, built by streaming R2→`client-zip`→R2 (multipart, since the
  zip stream has no known length) — and returns `202`, with a poll endpoint that mints a fresh signed URL
  when ready. The superseded `zipAsyncThreshold` setting is kept readable for one release.
