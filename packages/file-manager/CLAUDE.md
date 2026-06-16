# @magna-carta/file-manager — CLAUDE.md

**Purpose.** The File Manager domain module: the D1 folder tree over opaque per-firm R2 keys,
`file`/`file_version` with the pending → clean/quarantined status gate, the single-read ingest pipeline
(magic-byte gates + streaming SHA-256 + scan port → commit or quarantine), per-firm upload policy, exact
storage metering + reconciliation, and the bulk-download selection resolver. Validates in memory and
composes statements into @magna-carta/data-access's `composeEffectBatch`; never runs logic mid-transaction.

**White paper:** _Matters and File Manager_ —
[`docs/Magna-Carta-White-Paper.md`](../../docs/Magna-Carta-White-Paper.md). (ADR-0077, ADR-0078, ADR-0081, ADR-0082.)
**Spec:**
[`docs/specs/2026-06-11-slice-1-1-matters-locations-file-manager-design.md`](../../docs/specs/2026-06-11-slice-1-1-matters-locations-file-manager-design.md).

## Key files / entry points

- `src/folder-service.ts` — create/rename/move/delete folders (delete only when empty; cycle-checked)
- `src/file-service.ts` — `initiateUpload`, `commitVersion` (with the no-op hash-skip), `quarantineVersion`, rename/move/soft-delete, upload-session lifecycle
- `src/ingest-core.ts` — the pure single-read pipeline (`runIngest`); the Worker consumer is a thin shell
- `src/scan-port.ts` — `MalwareScanPort` + the engine-less `unscannedAdapter` launch adapter
- `src/queries.ts` — the status-gated reads (`listFiles`, `getCurrentCleanVersion`, `listCleanVersions`, `listFoldersByMatter`, `listCleanCurrentVersionsByMatter`)
- `src/metering-statements.ts` — the storage-meter delta/commit/tier/delete builders + `reconciliationDiff` + `normalizeR2StorageClass`
- `src/upload-policy.ts` — per-firm policy checks (presign-time + gate-time) + the mode/zip-async threshold setting definitions
- `src/zip-composition.ts` — pure selection → clean-current entries + folder-tree paths

## Invariants that apply here

- **The quarantine gate is a status gate, not a key scheme.** Every read of `file_version` filters
  `status = 'clean'` (and `deleted_at IS NULL` for default lists). A pending or quarantined version is
  never servable. A source-scan fitness function rejects any `file_version` SELECT without a status
  predicate (allowlist a legitimate all-status read with an inline `fitness:allow-no-status` marker).
- **Versions are immutable; soft-delete only.** A committed version's bytes/metadata never change; a new
  version is a new row + a new R2 key. Files soft-delete (`deleted_at`); versions are untouched.
- **R2 keys are opaque and server-minted** (`files/{fileId}/{versionId}`) — never derived from a
  client-supplied path. The bytes bypass the Worker (direct-to-R2 via presigned URLs).
- **No-op version skip.** A re-upload whose content hash equals the file's current version's hash marks
  the session completed and the new version abandoned — one logical version, not a duplicate.
- **Ingest is one read.** `runIngest` tees a single stream: head bytes to the magic-byte sniff, the full
  stream through `crypto.DigestStream` and the scan port. A multi-GB object never buffers. An `unscanned`
  verdict commits (the explicit launch policy); quarantine is for failed gates and `infected` only.
- **Metering is exact in D1, reconciled against R2.** The rollup moves in the same batch as the version
  it counts; the scheduled R2 LIST corrects drift (R2 reports the default tier as `""`/PascalCase —
  `normalizeR2StorageClass` maps it to the lowercase token before the diff).

## Dependencies & contracts

- Depends on `@magna-carta/data-access`, `@magna-carta/database`, `@magna-carta/identifiers`,
  `client-zip` (store-mode ZIP64), `file-type` (magic-byte sniff). Holds no D1 binding; the Worker passes
  the database and the R2/presigner seams in.
- The malware-scan engine is a future Phase 2 build behind `MalwareScanPort`; the launch adapter records
  an honest `unscanned` verdict.

## Gotchas

- D1 has no interactive transactions — read before composing, or assert inside the batch.
- The `zipAsyncThreshold` setting is read and recorded in the download audit row but not yet acted on —
  the build-to-R2-artifact job is a Phase 2 build; the live stream is the only path today.
