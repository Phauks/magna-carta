# Access-Triggered Re-Scan & Dedup-Skip — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use subagent-driven-development (recommended) or executing-plans to implement this task-by-task. Steps use `- [ ]` checkboxes.

**Goal:** Re-scan a file when it is opened — only if its scan is stale (older engine version) — reusing the per-firm dedup cache so a duplicate or repeat access never re-runs the engine; an infected-on-re-scan finding stays accessible behind an informed-access gate (no data loss).

**Architecture:** The access trigger lives in the file open/preview/download path; it reads a per-firm "current engine version" setting, checks `scan_cache` first, and on a miss enqueues a background re-scan. The ingest consumer gains a second branch — a committed-version in-place re-scan that stamps the verdict without moving the current-version pointer. An infected committed version stays `status='clean'` (visible) with `scan_verdict='infected'`; the download path gates it.

**Tech Stack:** TypeScript; Cloudflare Workers + Hono + Queues; per-firm D1 via Drizzle + the firm-scoped data-access layer; Vitest (+ Miniflare worker integration).

## Global Constraints

- **Never silently clean.** Any fault/timeout/missing-engine-version ⇒ the file is left to be (re-)scanned or served under its last-known verdict — NEVER recorded clean without a real scan. A re-scan that cannot reach the engine must not downgrade an existing verdict.
- **Firm-scoped data-access only** (golden rule 3); no query crosses firms; the cache is per-firm.
- **Full names, no shorthand** (golden rule 12); **no process-artifact refs in source** (golden rule 13) — explain reasoning inline or cite a file by path.
- **Redact by default** (golden rule 4): no file id/name/content in telemetry; verdict + outcome only.
- **TDD, frequent commits**; the portable test suite stays green on the dev host.
- Reuse before building (golden rule 1): the cache layer (`scan-cache.ts`), `readFirmSetting`/`FirmSettingDefinition`, and the existing scan port already exist.

---

## File Structure

- `packages/file-manager/src/upload-policy.ts` — add the `scanEngineVersion` `FirmSettingDefinition` + reader beside `inspectableSizeCapDefinition`.
- `packages/file-manager/src/file-service.ts` — stamp the engine-version setting on commit; add `recordRescanVerdict` (the in-place verdict-update effect).
- `packages/file-manager/src/file-statements.ts` — the `status='clean'`-gated in-place verdict UPDATE statement.
- `packages/file-manager/src/queries.ts` — extend the committed-version read to carry `content_sha256`; add a non-pending loader by `r2_key`.
- `packages/file-manager/src/scan-cache.ts` — (reader already exists) add an infected-verdict record helper if not covered.
- `apps/worker/src/files/ingest-consumer.ts` — the status-branch dispatch + the in-place re-scan path.
- `apps/worker/src/routes/files/files.ts` — the access trigger on open/preview/download + the informed-access download gate.
- `apps/worker/src/scheduled.ts` — remove the proactive `runRescanSweep`.
- `packages/telemetry/src/events.ts` — a `rescan.verdict` event (verdict + outcome only).
- Tests beside each.

---

## Task 1: Per-firm `scanEngineVersion` setting + reader

**Files:**

- Modify: `packages/file-manager/src/upload-policy.ts`
- Test: `packages/file-manager/test/upload-policy.test.ts`

**Interfaces:**

- Produces: `scanEngineVersionDefinition: FirmSettingDefinition<string | null>` (key `"fileManager.scanEngineVersion"`, default `null`); `readScanEngineVersion(database): Promise<string | null>`.

- [ ] **Step 1 — failing test:** assert `readScanEngineVersion` returns `null` on an unset firm, and the value after a setting write.

```ts
it("reads the configured scan engine version, null when unset", async () => {
  const database = freshDatabase();
  expect(await readScanEngineVersion(database)).toBeNull();
  await database.batch([
    writeFirmSettingStatement(database, scanEngineVersionDefinition, "clamav/1.0+heuristics/1"),
  ]);
  expect(await readScanEngineVersion(database)).toBe("clamav/1.0+heuristics/1");
});
```

- [ ] **Step 2 — run it, confirm it fails** (`readScanEngineVersion` undefined).
- [ ] **Step 3 — implement** the definition + reader following `inspectableSizeCapDefinition`/`readInspectableSizeCap` exactly (same `FirmSettingDefinition` shape, `readFirmSetting` delegate). Comment why null ⇒ "fall through to a real scan, never fabricate a cache key".
- [ ] **Step 4 — run the test, green.**
- [ ] **Step 5 — commit** `feat(file-manager): per-firm scanEngineVersion setting + reader`.

## Task 2: Stamp the engine version on commit

**Files:**

- Modify: `packages/file-manager/src/file-service.ts` (`commitVersion`)
- Test: `packages/file-manager/test/file-service.test.ts`

**Interfaces:**

- Consumes: `scanEngineVersionDefinition` (Task 1). Produces: the commit batch also upserts `fileManager.scanEngineVersion` when committing a `clean` verdict with a non-null engine version.

- [ ] **Step 1 — failing test:** after a clean commit with `scanEngineVersion: "X"`, `readScanEngineVersion(db)` returns `"X"`; an `unscanned` commit leaves it unchanged.
- [ ] **Step 2 — run, confirm fail.**
- [ ] **Step 3 — implement:** in `commitVersion`, when `input.scanVerdict === "clean" && input.scanEngineVersion !== null`, add a `writeFirmSettingStatement(database, scanEngineVersionDefinition, input.scanEngineVersion)` to the same batch (guarded exactly like the existing `recordScanCacheStatement` block). This makes "current engine version" an observable, auditable fact set by real scans.
- [ ] **Step 4 — green.** **Step 5 — commit** `feat(file-manager): stamp current scan engine version on clean commit`.

## Task 3: In-place verdict-update statement + effect

**Files:**

- Modify: `packages/file-manager/src/file-statements.ts`, `packages/file-manager/src/file-service.ts`
- Test: `packages/file-manager/test/file-service.test.ts`

**Interfaces:**

- Produces: `rescanVerdictStatement(database, { versionId, scanVerdict, scanEngineVersion, scanDetail, now })` — `UPDATE file_version SET scan_verdict=?, scan_engine_version=?, scan_detail=? WHERE id=? AND status='clean'` (idempotent; never touches a pending row, never moves `current_version_id`). And `recordRescanVerdict(database, input, options): { effect }` composing the statement + an audit row + the cache record + a `rescan.verdict` outbox/telemetry signal.

- [ ] **Step 1 — failing test:** seed a committed `clean`+`unscanned` version; apply `recordRescanVerdict` with `clean`; assert the row's `scan_verdict='clean'`, `scan_engine_version` set, `current_version_id` UNCHANGED, a `scan_cache` row written, and an audit row. Repeat for `infected` (asserts `scan_verdict='infected'` but `status` STAYS `clean` — informed access).
- [ ] **Step 2 — run, confirm fail.**
- [ ] **Step 3 — implement** the `status='clean'`-gated statement (it must NOT reuse `commitVersionStatement`/`bumpFileCurrentVersionStatement`) + `recordRescanVerdict` building the effect batch (statement + `recordScanCacheStatement` + `fileAuditStatement` with a new `file.version_rescanned` action). Cache `infected` too (signature carried).
- [ ] **Step 4 — green.** **Step 5 — commit** `feat(file-manager): in-place re-scan verdict update (no pointer move) + cache record`.

## Task 4: Committed-version read carrying `content_sha256` + non-pending loader

**Files:**

- Modify: `packages/file-manager/src/queries.ts`
- Test: `packages/file-manager/test/queries.test.ts` (or the nearest read test)

**Interfaces:**

- Produces: `loadCommittedVersionByR2Key(database, r2Key): Promise<{ id, fileId, contentSha256, scanEngineVersion, scanVerdict } | undefined>` — loads a `status='clean'` version by its R2 key (the dispatch's non-pending branch). And ensure any re-scan candidate read returns `content_sha256`.

- [ ] **Step 1 — failing test:** seed a committed version; `loadCommittedVersionByR2Key` returns its id + content hash + current scan_engine_version; returns `undefined` for a pending or unknown key.
- [ ] **Step 2 — run, confirm fail.**
- [ ] **Step 3 — implement** the read (`WHERE r2_key=? AND status='clean'`), returning the columns the dispatch + cache lookup need.
- [ ] **Step 4 — green.** **Step 5 — commit** `feat(file-manager): committed-version-by-r2key loader for the re-scan dispatch`.

## Task 5: Consumer dispatch — pending vs committed-stale

**Files:**

- Modify: `apps/worker/src/files/ingest-consumer.ts`
- Test: `apps/worker/test/ingest-consumer.test.ts`

**Interfaces:**

- Consumes: `loadCommittedVersionByR2Key` (T4), `readScanEngineVersion` (T1), `lookupScanCache` (exists), `recordRescanVerdict` (T3), the scan port. Produces: `handleIngestMessage` now branches — `pending` ⇒ the existing `runIngest`; `clean`+stale ⇒ the in-place re-scan path; else ack/no-op.

- [ ] **Step 1 — failing test (cache hit):** a committed `clean`+`unscanned` version whose content hash is cached `clean` under the current engine ⇒ `handleIngestMessage` writes the verdict in place WITHOUT calling the scan port (assert the port stub is never invoked).
- [ ] **Step 2 — failing test (miss):** no cache entry ⇒ the scan port IS called, the verdict written in place, and a `scan_cache` row recorded.
- [ ] **Step 3 — failing test (null setting):** `scanEngineVersion` unset ⇒ falls through to a real scan (never a cache key); a scan fault ⇒ the version's verdict is UNCHANGED (never downgraded/cleaned).
- [ ] **Step 4 — run, confirm all fail.**
- [ ] **Step 5 — implement:** after `loadPendingVersionForIngest` returns undefined, call `loadCommittedVersionByR2Key`; if found + `scan_engine_version !== current`, run: read current engine version → `lookupScanCache` → hit ⇒ `recordRescanVerdict`; miss ⇒ R2 read + `scanPort.scan` → `recordRescanVerdict`. Idempotency key `rescan:<versionId>:<engineVersion>`. Keep `ingest-core.ts` READ-ONLY.
- [ ] **Step 6 — green; commit** `feat(worker): in-place re-scan path in the ingest consumer (cache-first)`.

## Task 6: Access trigger on open/preview/download

**Files:**

- Modify: `apps/worker/src/routes/files/files.ts`
- Test: `apps/worker/test/files-routes.test.ts`

**Interfaces:**

- Consumes: `readScanEngineVersion`, `lookupScanCache`, the re-scan enqueue (to `FILES_INGEST`/bulk). Produces: an open/preview/download handler that, for a stale version, applies a cache hit synchronously or enqueues a background re-scan, never blocking the open.

- [ ] **Step 1 — failing test:** opening a version whose `scan_engine_version` matches current serves immediately, no enqueue. Opening a STALE version with a cache hit applies the verdict; a stale MISS enqueues a re-scan and still serves (under last-known status).
- [ ] **Step 2 — run, confirm fail.**
- [ ] **Step 3 — implement** the staleness + cache-first + enqueue-on-miss in the open/preview/download path; the enqueue re-uses the existing ingest queue (the consumer's new branch processes it). Serving is never awaited on a scan.
- [ ] **Step 4 — green; commit** `feat(worker): access-triggered re-scan on file open (stale + cache-first)`.

## Task 7: Informed-access download gate + read mediation + notification

**Files:**

- Modify: `apps/worker/src/routes/files/files.ts`, the download read mediation; `packages/file-manager/src/queries.ts` (download eligibility); add the notification emit.
- Test: `apps/worker/test/files-routes.test.ts`
- Docs: amend `docs/conventions/security.md` (the accepted/mitigated posture of serving a flagged file behind the gate).

**Interfaces:**

- Produces: a raw download of an `infected` committed version requires a confirmation + re-auth and is audited; listing still shows it; a fresh `infected` finding emits a notification.

- [ ] **Step 1 — failing test:** an `infected` committed version still LISTS; a raw download without the confirm flag returns the gate (not the bytes); with confirm + re-auth it serves AND writes an audit row. A `clean`/`unscanned` version downloads normally.
- [ ] **Step 2 — run, confirm fail.**
- [ ] **Step 3 — implement** the download mediation keyed on `scan_verdict='infected'` (the gate + re-auth + audit), the listing left unchanged, and the notification on a fresh infected finding. Amend `security.md` additively (the safe-preview path means viewing never touches the payload; raw download is consented + audited).
- [ ] **Step 4 — green; commit** `feat(worker): informed-access gate for infected files (no data loss) + security.md`.

## Task 8: Remove the proactive weekly sweep

**Files:**

- Modify: `apps/worker/src/scheduled.ts` (drop `runRescanSweep` + its cron), `apps/worker/src/index.ts` (drop the import), `apps/worker/wrangler.jsonc` (drop the weekly cron trigger if scan-specific).
- Test: update `apps/worker/test/*scheduled*`/`firms`/`conformance` as needed.

- [ ] **Step 1 — update the tests** that asserted the sweep ran, to assert it no longer does (access-triggered replaces it).
- [ ] **Step 2 — remove** `runRescanSweep` + its wiring; keep the storage-reconciliation + other sweeps.
- [ ] **Step 3 — green (`pnpm check` + worker suite); commit** `refactor(worker): drop the proactive re-scan sweep (superseded by access-triggered)`.

## Task 9 (fast-follows — separate slice, not built here)

Safe-preview rendition of an infected file via the conversion pipeline; an on-demand "scan this matter now" button (user-initiated bulk pass to the bulk lane). Documented in the design's fast-follows; tracked, not implemented in this plan.

---

## Self-review

- **Spec coverage:** every design component (engine-version setting, in-place re-scan, cache-first, access trigger, informed access, sweep removal) maps to a task. ✓
- **Type consistency:** `scanEngineVersionDefinition` / `readScanEngineVersion` / `recordRescanVerdict` / `loadCommittedVersionByR2Key` / `rescanVerdictStatement` are used with the same names across tasks. ✓
- **Never-silent-clean:** Tasks 3, 5, 6 each pin the fault/null-setting paths to "never downgrade to clean without a real scan." ✓
- **No placeholders:** each task carries concrete interfaces, test assertions, and the file to follow for the pattern.
