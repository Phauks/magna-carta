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

- `src/folder-service.ts` — create/rename/move/delete folders (delete only when empty; cycle-checked)
- `src/file-service.ts` — `initiateUpload`, `commitVersion` (with the no-op hash-skip), `quarantineVersion`, rename/move/soft-delete, upload-session lifecycle
- `src/ingest-core.ts` — the pure single-read pipeline (`runIngest`); the Worker consumer is a thin shell. Also `measureContent`, the hash-only re-measurement the consumer's custody check runs against an already-committed object
- `src/content-type-equivalence.ts` — `contentTypesAgree`: does the sniffed container type describe the same bytes as the declared type (the compound-file and ZIP families), with unknown pairs failing closed
- `src/scan-port.ts` — `MalwareScanPort` (returns a `RawScanResult` of engine facts: clamd state, structural heuristic, YARA matches with tier/score, per-leg timings) + the engine-less `unscannedAdapter` launch adapter
- `src/verdict.ts` — `computeVerdict(raw, policy)` turns the raw facts + a firm scan policy into a `clean | flagged | unscanned` file verdict (the per-firm decision, app-side); `ScanFaultError` marks a deployed-engine-unavailable fault the consumer must retry
- `src/queries.ts` — the status-gated reads (`listFiles`, `getCurrentCleanVersion`, `listCleanVersions`, `listFoldersByMatter`, `listCleanCurrentVersionsByMatter`)
- `src/metering-statements.ts` — the storage-meter delta/commit/tier/delete builders + `reconciliationDiff` + `normalizeR2StorageClass`
- `src/scan-policy-settings.ts` — the three firm scan-policy `FirmSettingDefinition`s (`scan.policy`, `scan.flagged_treatment`, `scan.step_up_reauth_on_flagged`) + `readFirmScanPolicy` / `readFlaggedTreatment` / `readStepUpReauthOnFlagged` helpers; defaults preserve today's behaviour (`extended/75/block/off`)
- `src/upload-policy.ts` — per-firm policy checks (presign-time + gate-time) + the mode threshold and the live-download threshold setting definitions (`liveMaxFileCount` / `liveMaxTotalBytes`, superseding `zipAsyncThreshold`)
- `src/zip-composition.ts` — pure selection → clean-current entries + folder-tree paths, plus the content-addressed `bundleManifestHash` (the async-build dedup/artifact key)

## Invariants that apply here

- **The quarantine gate is a status gate, not a key scheme.** Every read of `file_version` filters
  `status = 'clean'` (and `deleted_at IS NULL` for default lists). A pending or quarantined version is
  never servable. A source-scan fitness function rejects any `file_version` SELECT without a status
  predicate (allowlist a legitimate all-status read with an inline `fitness:allow-no-status` marker).
- **Versions are immutable; soft-delete only.** A committed version's bytes/metadata never change; a new
  version is a new row + a new R2 key. Files soft-delete (`deleted_at`); versions are untouched.
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
- **R2 keys are opaque and server-minted** — `files/{fileId}/{versionId}` (interactive lane) or
  `bulk/{fileId}/{versionId}` (bulk lane) — never derived from a client-supplied path. Both key prefixes
  meter under the `files/` logical dimension. The bytes bypass the Worker (direct-to-R2 via presigned URLs).
- **No-op version skip.** A re-upload whose content hash equals the file's current version's hash marks
  the session completed and the new version abandoned — one logical version, not a duplicate.
- **Ingest is one read.** `runIngest` tees a single stream: head bytes to the magic-byte sniff, the full
  stream through `crypto.DigestStream` and the scan port. A multi-GB object never buffers.
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
- **Metering is exact in D1, reconciled against R2.** The rollup moves in the same batch as the version
  it counts; the scheduled R2 LIST corrects drift (R2 reports the default tier as `""`/PascalCase —
  `normalizeR2StorageClass` maps it to the lowercase token before the diff).
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
