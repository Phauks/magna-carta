import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type {
  DocumentCheckoutId,
  DocumentTypeId,
  FileId,
  FileVersionId,
  FolderId,
  MatterId,
  UploadSessionId,
  UserId,
} from "@magna-carta/identifiers/types";

// Table names tracked against @magna-carta/database's schema by the schema-name-sync fitness test.
export const FILE_TABLE = "file";
export const FILE_VERSION_TABLE = "file_version";
export const UPLOAD_SESSION_TABLE = "upload_session";

// The top-level R2 key segment for matter files (also the storage_meter prefix). Keys are opaque:
// files/{fileId}/{versionId} — never derived from a folder path, so a rename moves no bytes.
export const FILES_PREFIX = "files";
// The R2 key prefix for bulk-uploaded objects. Bulk objects live under bulk/ but still meter under
// the files/ logical dimension — the lane benefit is queue topology, not a different meter bucket.
export const BULK_PREFIX = "bulk";

export function fileVersionKey(
  fileId: FileId,
  versionId: FileVersionId,
  prefix: string = FILES_PREFIX,
): string {
  return `${prefix}/${fileId}/${versionId}`;
}

// The single mutable working-copy key for an in-app editing session — files/{fileId}/current. A live
// edit overwrites this object on every save; cutting a version copies it to an immutable
// files/{fileId}/{versionId}. One per file, so a re-open reuses the same key (crash-safe in R2).
export function currentObjectKey(fileId: FileId): string {
  return `${FILES_PREFIX}/${fileId}/current`;
}

export interface InsertFileRow {
  readonly id: FileId;
  readonly matterId: MatterId;
  readonly folderId: FolderId | null;
  readonly name: string;
  readonly documentTypeId: DocumentTypeId | null;
  readonly createdAt: string;
}

export function insertFileStatement(database: SqlDatabase, row: InsertFileRow): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${FILE_TABLE} (id, matter_id, folder_id, name, document_type_id, current_version_id, deleted_at, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, NULL, NULL, ?6, ?6)`,
    )
    .bind(row.id, row.matterId, row.folderId, row.name, row.documentTypeId, row.createdAt);
}

export interface InsertFileVersionRow {
  readonly id: FileVersionId;
  readonly fileId: FileId;
  // Advisory only — for a caller's own return value. The AUTHORITATIVE version_number is computed
  // ATOMICALLY inside the INSERT (the subquery below), so concurrent initiates on one file can never
  // collide on the same number (each SQLite write serializes and sees the prior committed max). The
  // caller's pre-read value would race; the statement does not use it.
  readonly versionNumber: number;
  readonly r2Key: string;
  readonly declaredContentType: string | null;
  readonly uploadedBy: UserId | null;
  readonly createdAt: string;
  // What kind of save cut this version, for one the browser editor cut from the working copy; null
  // for an upload, a check-in or a restore. History folds the autosaves and names the rest.
  readonly saveKind?: VersionSaveKind | null;
  // Set only for the return leg of an offline checkout: the checkout this version came back through.
  // The ingest gate reads it to route a cleared check-in into divergence resolution. Null otherwise.
  readonly checkoutId?: DocumentCheckoutId | null;
  // The last-modified instant the uploading device reported for the source file, when the client sent
  // one. A fact about the source, kept on every version; the file's own dating is decided elsewhere.
  readonly sourceModifiedAt?: string | null;
}

// A pending version: bytes are not yet ingested, so size/sniffed-type/hash/scan are null and status
// is 'pending' — invisible to every consumer read until the ingest gate commits it. version_number is
// computed in the INSERT itself (MAX+1 over the file) so two concurrent initiates serialize on the
// write and take distinct numbers — never an unhandled UNIQUE(file_id, version_number) collision.
export function insertFileVersionStatement(
  database: SqlDatabase,
  row: InsertFileVersionRow,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${FILE_VERSION_TABLE} (id, file_id, version_number, r2_key, size_bytes, declared_content_type, sniffed_content_type, content_sha256, scan_verdict, scan_engine_version, status, uploaded_by, checkout_id, created_at, committed_at, source_modified_at, save_kind) ` +
        // the version-number subquery spans ALL statuses by design (numbers never reuse a slot) — fitness:allow-no-status
        `VALUES (?1, ?2, (SELECT COALESCE(MAX(version_number), 0) + 1 FROM ${FILE_VERSION_TABLE} WHERE file_id = ?2), ?3, NULL, ?4, NULL, NULL, NULL, NULL, 'pending', ?5, ?6, ?7, NULL, ?8, ?9)`,
    )
    .bind(
      row.id,
      row.fileId,
      row.r2Key,
      row.declaredContentType,
      row.uploadedBy,
      row.checkoutId ?? null,
      row.createdAt,
      row.sourceModifiedAt ?? null,
      row.saveKind ?? null,
    );
}

/** What kind of save cut a version from the working copy. The editor names the first three. */
export type VersionSaveKind = "explicit" | "autosave" | "exit" | "reap";

export const FILE_VERSION_PARTICIPANT_TABLE = "file_version_participant";

/**
 * Who was in the editing session when a version was cut: one row per member with a view open. The
 * version's uploaded_by is the member whose save cut it; these are everyone who could have written
 * the words in it. One statement per participant, so the batch that cuts the version carries them.
 */
export function insertVersionParticipantStatements(
  database: SqlDatabase,
  versionId: FileVersionId,
  memberUserIds: readonly UserId[],
): SqlStatement[] {
  return memberUserIds.map((memberUserId) =>
    database
      .prepare(
        `INSERT INTO ${FILE_VERSION_PARTICIPANT_TABLE} (version_id, member_user_id) VALUES (?1, ?2) ON CONFLICT DO NOTHING`,
      )
      .bind(versionId, memberUserId),
  );
}

export interface InsertUploadSessionRow {
  readonly id: UploadSessionId;
  readonly fileVersionId: FileVersionId;
  readonly mode: "put" | "multipart";
  readonly declaredSize: number | null;
  readonly declaredContentType: string | null;
  readonly createdAt: string;
  readonly expiresAt: string | null;
}

export function insertUploadSessionStatement(
  database: SqlDatabase,
  row: InsertUploadSessionRow,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${UPLOAD_SESSION_TABLE} (id, file_version_id, mode, r2_upload_id, declared_size, declared_content_type, status, created_at, expires_at) VALUES (?1, ?2, ?3, NULL, ?4, ?5, 'open', ?6, ?7)`,
    )
    .bind(
      row.id,
      row.fileVersionId,
      row.mode,
      row.declaredSize,
      row.declaredContentType,
      row.createdAt,
      row.expiresAt,
    );
}

// next version_number = max over ALL versions + 1. Status is deliberately NOT filtered: an abandoned
// or quarantined version still consumes its (file_id, version_number) UNIQUE slot, so reusing the
// number would collide. The one file_version read that legitimately spans every status.
// fitness:allow-no-status
export function selectMaxVersionNumberStatement(
  database: SqlDatabase,
  fileId: FileId,
): SqlStatement {
  return database
    .prepare(
      `SELECT COALESCE(MAX(version_number), 0) AS n FROM ${FILE_VERSION_TABLE} WHERE file_id = ?1`,
    )
    .bind(fileId);
}

// The ingest gate acts only on a pending version (status = 'pending' is the guard); a replayed event
// finds it already clean/quarantined and matches nothing.
export function selectPendingVersionStatement(
  database: SqlDatabase,
  versionId: FileVersionId,
): SqlStatement {
  return database
    .prepare(
      `SELECT id, file_id, version_number, r2_key FROM ${FILE_VERSION_TABLE} WHERE id = ?1 AND status = 'pending'`,
    )
    .bind(versionId);
}

// The pending version for ingest, found by its r2_key (the R2 event carries the key, not the
// version id), joined to its session's declared size and the file's name (the ingest gate re-checks
// the extension blocklist against the real name, not the opaque key). status = 'pending' is the
// idempotency guard: a replayed R2 event finds the now-clean/quarantined version absent here and no-ops.
export function selectPendingVersionByR2KeyStatement(
  database: SqlDatabase,
  r2Key: string,
): SqlStatement {
  return database
    .prepare(
      `SELECT v.id, v.declared_content_type, v.r2_key, v.checkout_id, s.declared_size, f.name AS file_name ` +
        `FROM ${FILE_VERSION_TABLE} v JOIN ${UPLOAD_SESSION_TABLE} s ON s.file_version_id = v.id ` +
        `JOIN ${FILE_TABLE} f ON f.id = v.file_id ` +
        `WHERE v.r2_key = ?1 AND v.status = 'pending'`,
    )
    .bind(r2Key);
}

// Flags a just-committed check-in version as a conflicting copy: an offline edit whose base no longer
// matches the file's current version. Runs in the same batch right after commitVersionStatement (which
// has set the row to 'clean'); the version is retained forever and never promoted to current — a human
// resolves it through reconciliation. diverged_from_version_id records the stale base it forked from.
export function markVersionConflictStatement(
  database: SqlDatabase,
  versionId: FileVersionId,
  divergedFromVersionId: FileVersionId,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${FILE_VERSION_TABLE} SET reconciliation_status = 'conflict_pending', diverged_from_version_id = ?2 WHERE id = ?1`,
    )
    .bind(versionId, divergedFromVersionId);
}

// Resolves a conflicting copy: flips it conflict_pending -> reconciled when a human picks the winner.
// Guarded on the conflict_pending state so a replay is a no-op. The copy itself is retained forever
// (never deleted) regardless of which side won — this only clears the document's "needs reconciliation"
// flag (the conflict_pending row is that flag).
// fitness:unguarded-write — a repeat is meant to be a no-op — zero rows means the state it moves to was already reached
export function markVersionReconciledStatement(
  database: SqlDatabase,
  versionId: FileVersionId,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${FILE_VERSION_TABLE} SET reconciliation_status = 'reconciled' WHERE id = ?1 AND reconciliation_status = 'conflict_pending'`,
    )
    .bind(versionId);
}

// Sets a file's current version UNCONDITIONALLY — the deliberate-human override the monotonic
// bumpFileCurrentVersionStatement is not: reconciliation may promote a conflicting copy even when a
// later version exists (the holder is choosing the offline edit over what advanced meanwhile). Ingest
// ordering still uses the monotonic bump; only human reconciliation uses this.
export function setFileCurrentVersionStatement(
  database: SqlDatabase,
  fileId: FileId,
  versionId: FileVersionId,
  updatedAt: string,
): SqlStatement {
  return database
    .prepare(`UPDATE ${FILE_TABLE} SET current_version_id = ?2, updated_at = ?3 WHERE id = ?1`)
    .bind(fileId, versionId, updatedAt);
}

// A specific clean version's bytes facts (key/hash/size) — what version-restore reads to copy an
// archived version forward. status = 'clean' so a pending/quarantined/abandoned version is never
// restorable.
export function selectCleanVersionByIdStatement(
  database: SqlDatabase,
  versionId: FileVersionId,
): SqlStatement {
  return database
    .prepare(
      `SELECT id, file_id, r2_key, content_sha256, size_bytes FROM ${FILE_VERSION_TABLE} WHERE id = ?1 AND status = 'clean'`,
    )
    .bind(versionId);
}

// Every committed version in the firm whose bytes hash to this digest and are the CURRENT version of a
// live file — what the upload dialog asks before sending bytes the firm already holds. Current-only,
// so an archived version of a since-changed file is not offered as "already here"; the size rides
// along so the caller can refuse a digest collision that a size disagrees with. Bounded: a firm that
// holds the same bytes fifty times over has told the caller enough.
export function selectCurrentCleanVersionsBySha256Statement(
  database: SqlDatabase,
  contentSha256: string,
): SqlStatement {
  return database
    .prepare(
      `SELECT v.id AS version_id, v.file_id, f.matter_id, f.folder_id, f.name, v.size_bytes ` +
        `FROM ${FILE_VERSION_TABLE} v JOIN ${FILE_TABLE} f ON f.id = v.file_id ` +
        `WHERE v.content_sha256 = ?1 AND v.status = 'clean' AND f.current_version_id = v.id AND f.deleted_at IS NULL ` +
        `ORDER BY v.committed_at DESC LIMIT 50`,
    )
    .bind(contentSha256);
}

// Every version row of one file with the object it points at and the bytes it holds — what the purge
// guard walks. All statuses on purpose (fitness:allow-no-status): a pending or quarantined version has
// an object too, and a guard that could not see it would destroy bytes a row still names.
export function selectVersionObjectsOfFileStatement(
  database: SqlDatabase,
  fileId: FileId,
): SqlStatement {
  return (
    database
      // fitness:allow-no-status
      .prepare(
        `SELECT id, r2_key, content_sha256, export_r2_key, playable_copy_r2_key FROM ${FILE_VERSION_TABLE} WHERE file_id = ?1 ORDER BY version_number ASC`,
      )
      .bind(fileId)
  );
}

// How many OTHER version rows in the firm still name these bytes — by the hash of the content, or by
// the very object key — across every file, live or soft-deleted, and every status
// (fitness:allow-no-status). This is the reference count the purge guard reads: while it is above zero
// the bytes belong to somebody else as well, and destroying the object would take theirs.
export function countOtherVersionsHoldingBytesStatement(
  database: SqlDatabase,
  input: { versionId: FileVersionId; contentSha256: string | null; r2Key: string },
): SqlStatement {
  return (
    database
      // fitness:allow-no-status
      .prepare(
        `SELECT COUNT(*) AS held_by FROM ${FILE_VERSION_TABLE} ` +
          `WHERE id != ?1 AND (r2_key = ?3 OR (?2 IS NOT NULL AND content_sha256 = ?2))`,
      )
      .bind(input.versionId, input.contentSha256, input.r2Key)
  );
}

// A committed version's whole set of facts — what a server-side duplicate carries across unchanged,
// because the bytes are the same bytes and the verdict the gate reached on them still holds.
export function selectCleanVersionFactsStatement(
  database: SqlDatabase,
  versionId: FileVersionId,
): SqlStatement {
  return database
    .prepare(
      `SELECT id, file_id, r2_key, size_bytes, declared_content_type, sniffed_content_type, content_sha256, scan_verdict, scan_engine_version, scan_detail ` +
        `FROM ${FILE_VERSION_TABLE} WHERE id = ?1 AND status = 'clean'`,
    )
    .bind(versionId);
}

// The current (clean) version's hash, for the no-op skip: re-uploading identical bytes must not cut a
// new version. Reads only the committed version (status = 'clean').
export function selectCurrentVersionHashStatement(
  database: SqlDatabase,
  fileId: FileId,
): SqlStatement {
  return database
    .prepare(
      `SELECT v.content_sha256 AS hash FROM ${FILE_TABLE} f JOIN ${FILE_VERSION_TABLE} v ON v.id = f.current_version_id WHERE f.id = ?1 AND v.status = 'clean'`,
    )
    .bind(fileId);
}

export interface CommitVersionRow {
  readonly versionId: FileVersionId;
  readonly sizeBytes: number;
  readonly sniffedContentType: string | null;
  readonly contentSha256: string;
  readonly scanVerdict: "unscanned" | "clean" | "flagged";
  readonly scanEngineVersion: string | null;
  readonly scanDetail: string | null;
  readonly committedAt: string;
}

// Guarded on status = 'pending': a version commits exactly once. A replayed ingest matches no row.
// fitness:unguarded-write — a replayed ingest matching no row is the at-least-once contract working, not a refusal
export function commitVersionStatement(database: SqlDatabase, row: CommitVersionRow): SqlStatement {
  return database
    .prepare(
      `UPDATE ${FILE_VERSION_TABLE} SET status = 'clean', size_bytes = ?2, sniffed_content_type = ?3, content_sha256 = ?4, scan_verdict = ?5, scan_engine_version = ?6, scan_detail = ?7, committed_at = ?8 WHERE id = ?1 AND status = 'pending'`,
    )
    .bind(
      row.versionId,
      row.sizeBytes,
      row.sniffedContentType,
      row.contentSha256,
      row.scanVerdict,
      row.scanEngineVersion,
      row.scanDetail,
      row.committedAt,
    );
}

// Records a version's inline-playability verdict the first time a reader needs it. The verdict is a
// fact about immutable bytes, so it is written once and never revised: the `inline_playable IS NULL`
// guard lets two readers racing on the same version both compute it and only the first write land.
// fitness:unguarded-write — a lost race to a reader that already recorded the same verdict is the outcome wanted
export function recordInlinePlayableStatement(
  database: SqlDatabase,
  versionId: FileVersionId,
  verdict: "playable" | "download-only" | "indeterminate",
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${FILE_VERSION_TABLE} SET inline_playable = ?2 WHERE id = ?1 AND status = 'clean' AND inline_playable IS NULL`,
    )
    .bind(versionId, verdict);
}

// The in-batch precondition assertion for a version-lifecycle batch. Every statement that MOVES a
// version's status is guarded (`… AND status = 'pending'`), which makes that one statement replay-safe
// — but a D1 batch is a transaction, not a chain: the statements that DEPEND on the move (the meter
// delta, the current-version bump, the session flip, the audit row, the outbox message) carry no such
// predicate and run regardless. So a lost race — an abort or expiry that flips the version first —
// leaves the guarded UPDATE matching zero rows while every consequence of it commits anyway: the meter
// inflates, the file's current pointer can be aimed at a version that was abandoned, and an audit trail
// plus a downstream event both claim a commit that never happened.
//
// This restores the all-or-nothing property. Placed AFTER the guarded statement, it observes the state
// that statement was supposed to produce: if the version reached `expectedStatus`, the SELECT is empty
// and nothing happens. If it did not, the SELECT yields the row and re-inserting its own primary key
// violates the constraint — which aborts the whole batch, rolling back every dependent write with it.
// The caller sees the failure and retries, which is correct: on the retry the version is no longer
// pending, so the status-first guard reads it as already handled and the work is not repeated.
export function assertVersionStatusStatement(
  database: SqlDatabase,
  versionId: FileVersionId,
  expectedStatus: "clean" | "quarantined" | "abandoned",
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${FILE_VERSION_TABLE} (id, file_id, version_number, r2_key, status, created_at) SELECT id, file_id, version_number, r2_key, status, created_at FROM ${FILE_VERSION_TABLE} WHERE id = ?1 AND status <> ?2`,
    )
    .bind(versionId, expectedStatus);
}

export interface RescanVerdictRow {
  readonly versionId: FileVersionId;
  readonly scanVerdict: "clean" | "flagged";
  readonly scanEngineVersion: string;
  readonly scanDetail: string | null;
}

// The in-place re-scan stamp: an ALREADY-COMMITTED version (status = 'clean') is re-scanned under a
// newer engine and its verdict recorded WITHOUT moving the current-version pointer or changing
// visibility. Gated on status = 'clean' so it can never touch a pending row (the commit path owns
// those, and an out-of-order commit must not be clobbered), and so a flagged re-scan finding stays
// VISIBLE — only scan_verdict moves to 'flagged'; the status (and the file's current-version pointer)
// is untouched. The download path gates a flagged verdict; the listing does not (informed access,
// no data loss). NOT to be confused with commitVersionStatement (which gates 'pending' and moves the
// lifecycle) — a re-scan only stamps the safety result on a version that is already live.
// fitness:unguarded-write — a repeat is meant to be a no-op — zero rows means the state it moves to was already reached
export function rescanVerdictStatement(database: SqlDatabase, row: RescanVerdictRow): SqlStatement {
  return database
    .prepare(
      `UPDATE ${FILE_VERSION_TABLE} SET scan_verdict = ?2, scan_engine_version = ?3, scan_detail = ?4 WHERE id = ?1 AND status = 'clean'`,
    )
    .bind(row.versionId, row.scanVerdict, row.scanEngineVersion, row.scanDetail);
}

// Monotonic: the current-version pointer only advances. Ingest commits can land out of order (v2
// before v1, or a redelivery), so the pointer moves only when the committing version's number is
// higher than the one it already points at — an older version committing late never regresses it.
// fitness:unguarded-write — a repeat is meant to be a no-op — zero rows means the state it moves to was already reached
export function bumpFileCurrentVersionStatement(
  database: SqlDatabase,
  fileId: FileId,
  versionId: FileVersionId,
  updatedAt: string,
): SqlStatement {
  // The version_number subqueries read by primary key (id) to compare ordering — they intentionally
  // span all statuses (the committing version and whatever the pointer holds), gating nothing.
  // fitness:allow-no-status
  return database
    .prepare(
      `UPDATE ${FILE_TABLE} SET current_version_id = ?2, updated_at = ?3 WHERE id = ?1 AND (current_version_id IS NULL OR (SELECT version_number FROM ${FILE_VERSION_TABLE} WHERE id = ?2) > (SELECT version_number FROM ${FILE_VERSION_TABLE} WHERE id = ${FILE_TABLE}.current_version_id))`,
    )
    .bind(fileId, versionId, updatedAt);
}

// fitness:unguarded-write — a replayed verdict matching no row is the at-least-once contract working, not a refusal
export function quarantineVersionStatement(
  database: SqlDatabase,
  versionId: FileVersionId,
  scanDetail: string | null,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${FILE_VERSION_TABLE} SET status = 'quarantined', scan_detail = ?2 WHERE id = ?1 AND status = 'pending'`,
    )
    .bind(versionId, scanDetail);
}

// The custody withdrawal: an ALREADY-COMMITTED version (status = 'clean') whose stored bytes no
// longer hash to the value recorded at commit is pulled back behind the status gate. Every read path
// filters status = 'clean', so this one UPDATE is what stops the swapped bytes being served, and it
// is gated on status = 'clean' so it can never disturb a pending row or re-quarantine an already
// quarantined one. scan_verdict moves to 'flagged' alongside the status because the verdict on the
// row described bytes that are gone. The recorded hash/size are LEFT AS THEY WERE: they are the
// evidence of what was measured, not a live mirror of whatever now sits at the key.
// fitness:unguarded-write — a repeat is meant to be a no-op — zero rows means the state it moves to was already reached
export function quarantineCommittedVersionStatement(
  database: SqlDatabase,
  versionId: FileVersionId,
  scanDetail: string | null,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${FILE_VERSION_TABLE} SET status = 'quarantined', scan_verdict = 'flagged', scan_detail = ?2 WHERE id = ?1 AND status = 'clean'`,
    )
    .bind(versionId, scanDetail);
}

// Repoints a file's current version after the version it pointed at was withdrawn. current_version_id
// is clean-BY-CONSTRUCTION — the file listing joins through it without a status predicate on the
// strength of that — so a withdrawal that left the pointer where it was would put a quarantined
// version back on every listing row. The pointer falls back to the newest version that is still
// clean, or to NULL when none is (the file then has no servable content and drops out of the default
// listing, which is the honest answer). MUST run AFTER the withdrawal in the same batch, so the
// subquery already sees the withdrawn version as non-clean; the `current_version_id = ?2` guard keeps
// it a no-op when the pointer had already moved on.
// fitness:unguarded-write — the pointer having already moved is the state this exists to reach
export function repointCurrentVersionAfterWithdrawalStatement(
  database: SqlDatabase,
  fileId: FileId,
  withdrawnVersionId: FileVersionId,
  updatedAt: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${FILE_TABLE} SET current_version_id = (SELECT id FROM ${FILE_VERSION_TABLE} WHERE file_id = ?1 AND status = 'clean' ORDER BY version_number DESC LIMIT 1), updated_at = ?3 WHERE id = ?1 AND current_version_id = ?2`,
    )
    .bind(fileId, withdrawnVersionId, updatedAt);
}

// The no-op skip: identical re-upload abandons the freshly-minted pending version.
// fitness:unguarded-write — a repeat is meant to be a no-op — zero rows means the state it moves to was already reached
export function abandonVersionStatement(
  database: SqlDatabase,
  versionId: FileVersionId,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${FILE_VERSION_TABLE} SET status = 'abandoned' WHERE id = ?1 AND status = 'pending'`,
    )
    .bind(versionId);
}

export function setUploadSessionStatusStatement(
  database: SqlDatabase,
  fileVersionId: FileVersionId,
  status: "completed" | "aborted" | "expired",
): SqlStatement {
  return database
    .prepare(`UPDATE ${UPLOAD_SESSION_TABLE} SET status = ?2 WHERE file_version_id = ?1`)
    .bind(fileVersionId, status);
}

// The session by its own id, joined to its version's r2 key — the read the upload routes use to drive
// part-signing, completion, and abort (the route holds the session id, not the version id). The join
// to file_version reads the key of the still-pending version being uploaded TO (presigning its key is
// the whole point), so it legitimately spans version statuses.
// fitness:allow-no-status
export function selectUploadSessionStatement(
  database: SqlDatabase,
  sessionId: UploadSessionId,
): SqlStatement {
  return database
    .prepare(
      `SELECT s.id, s.file_version_id, s.mode, s.r2_upload_id, s.status, s.declared_content_type, v.r2_key ` +
        `FROM ${UPLOAD_SESSION_TABLE} s JOIN ${FILE_VERSION_TABLE} v ON v.id = s.file_version_id WHERE s.id = ?1`,
    )
    .bind(sessionId);
}

// Open sessions whose expiry has passed — the stale-pending sweep's input. Joined to the version's
// r2 key (needed to abort a multipart upload at R2). Spans version statuses by design: the version it
// reads is the still-pending one being abandoned. LIMIT bounds one pass to a fixed batch so a backlog
// never makes a single Cron fire unbounded; the next */5 pass drains the next batch.
// fitness:allow-no-status
export const STALE_PENDING_SWEEP_BATCH = 100;

export function selectExpiredOpenSessionsStatement(
  database: SqlDatabase,
  now: string,
): SqlStatement {
  return database
    .prepare(
      `SELECT s.id, s.file_version_id, s.mode, s.r2_upload_id, v.r2_key ` +
        `FROM ${UPLOAD_SESSION_TABLE} s JOIN ${FILE_VERSION_TABLE} v ON v.id = s.file_version_id ` +
        `WHERE s.status = 'open' AND s.expires_at IS NOT NULL AND s.expires_at < ?1 ` +
        `LIMIT ${STALE_PENDING_SWEEP_BATCH}`,
    )
    .bind(now);
}

// How long after a version was minted a still-`pending` row behind a COMPLETED session counts as
// stranded. The client finished its PUT and the session closed, so the only thing that can still move
// the version is the ingest queue — which retries with backoff and then dead-letters. Past this window
// no delivery is outstanding, so the version is not slow, it is stuck. Generous by design: re-driving
// an ingest that is merely still retrying costs one redundant pass (the status-first guard makes it a
// no-op), while too short a window would fight the queue's own backoff.
export const STRANDED_PENDING_DEADLINE_MILLISECONDS = 6 * 60 * 60 * 1000;

// Versions abandoned by a FAILED ingest rather than by an abandoned upload: the session reached
// 'completed' (the bytes are in R2 and the client believes the upload succeeded) but the version never
// left 'pending', because its queue message dead-lettered. The expired-open-session sweep cannot see
// these — that sweep matches `s.status = 'open'`, and these sessions are closed — so they would sit
// pending forever, invisible to the meter and undownloadable, with no operator signal. Bounded by the
// same batch size as the expired sweep so one pass is never unbounded.
export function selectStrandedPendingVersionsStatement(
  database: SqlDatabase,
  mintedBeforeIso: string,
): SqlStatement {
  return database
    .prepare(
      `SELECT v.id, v.r2_key, s.declared_size ` +
        `FROM ${UPLOAD_SESSION_TABLE} s JOIN ${FILE_VERSION_TABLE} v ON v.id = s.file_version_id ` +
        `WHERE s.status = 'completed' AND v.status = 'pending' AND v.created_at < ?1 ` +
        `LIMIT ${STALE_PENDING_SWEEP_BATCH}`,
    )
    .bind(mintedBeforeIso);
}

// Records R2's multipart upload id on the open session after createMultipartUpload — composed into
// the same initiate batch so the response and the stored id commit atomically.
export function setUploadSessionR2UploadIdStatement(
  database: SqlDatabase,
  sessionId: UploadSessionId,
  r2UploadId: string,
): SqlStatement {
  return database
    .prepare(`UPDATE ${UPLOAD_SESSION_TABLE} SET r2_upload_id = ?2 WHERE id = ?1`)
    .bind(sessionId, r2UploadId);
}

// Transitions a session by its id, guarded on status = 'open': a replayed complete/abort matches no
// row, so the transition happens exactly once.
// fitness:unguarded-write — a replayed complete or abort matching no row is what makes the transition exactly-once
export function setUploadSessionStatusByIdStatement(
  database: SqlDatabase,
  sessionId: UploadSessionId,
  status: "completed" | "aborted" | "expired",
): SqlStatement {
  return database
    .prepare(`UPDATE ${UPLOAD_SESSION_TABLE} SET status = ?2 WHERE id = ?1 AND status = 'open'`)
    .bind(sessionId, status);
}

export function selectFileStatement(database: SqlDatabase, id: FileId): SqlStatement {
  return database
    .prepare(
      `SELECT id, matter_id, folder_id, name, document_type_id, current_version_id, current_r2_key, deleted_at, created_at FROM ${FILE_TABLE} WHERE id = ?1`,
    )
    .bind(id);
}

// Destroys the live working-copy pointer on a file: nulls the `current` object's hash/size/timestamp
// and returns the file to idle. The caller deletes the R2 object itself (this only clears the rows).
// Used on soft-delete (the working copy dies with the file) and when a session-close consumes `current`.
export function clearCurrentObjectStatement(
  database: SqlDatabase,
  id: FileId,
  updatedAt: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${FILE_TABLE} SET current_r2_key = NULL, current_sha256 = NULL, current_size_bytes = NULL, current_wopi_timestamp = NULL, edit_state = 'idle', updated_at = ?2 WHERE id = ?1`,
    )
    .bind(id, updatedAt);
}

// Undeletes a soft-deleted file (clears deleted_at). The `current` working copy is NOT restored here —
// it re-materializes lazily from current_version_id on the next edit launch (GetFile falls back to the
// committed version when `current` is absent).
export function restoreFileStatement(
  database: SqlDatabase,
  id: FileId,
  updatedAt: string,
): SqlStatement {
  return database
    .prepare(`UPDATE ${FILE_TABLE} SET deleted_at = NULL, updated_at = ?2 WHERE id = ?1`)
    .bind(id, updatedAt);
}

export function renameFileStatement(
  database: SqlDatabase,
  id: FileId,
  name: string,
  updatedAt: string,
): SqlStatement {
  return database
    .prepare(`UPDATE ${FILE_TABLE} SET name = ?2, updated_at = ?3 WHERE id = ?1`)
    .bind(id, name, updatedAt);
}

export type FileEditState = "idle" | "coediting" | "checked_out";

// Sets a file's editing posture — flipped to 'coediting' when an editing session opens and back to
// 'idle' when the last editor leaves / a stale session is reaped (the CHECK constraint guards the enum).
export function setFileEditStateStatement(
  database: SqlDatabase,
  id: FileId,
  editState: FileEditState,
  updatedAt: string,
): SqlStatement {
  return database
    .prepare(`UPDATE ${FILE_TABLE} SET edit_state = ?2, updated_at = ?3 WHERE id = ?1`)
    .bind(id, editState, updatedAt);
}

// Flips a version's storage class (Standard -> Infrequent Access) after the tiering sweep rewrites the
// R2 object's class. Guarded on the current class so a replay/overlap is a no-op and the meter shift
// that rides the same batch applies exactly once.
// fitness:unguarded-write — the caller runs this on its own and branches on the affected-row count, so a refusal is already surfaced there
export function setVersionStorageClassStatement(
  database: SqlDatabase,
  versionId: FileVersionId,
  from: "standard" | "infrequent_access",
  to: "standard" | "infrequent_access",
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${FILE_VERSION_TABLE} SET storage_class = ?3 WHERE id = ?1 AND storage_class = ?2`,
    )
    .bind(versionId, from, to);
}

export function moveFileStatement(
  database: SqlDatabase,
  id: FileId,
  folderId: FolderId | null,
  updatedAt: string,
): SqlStatement {
  return database
    .prepare(`UPDATE ${FILE_TABLE} SET folder_id = ?2, updated_at = ?3 WHERE id = ?1`)
    .bind(id, folderId, updatedAt);
}

export function assignDocumentTypeStatement(
  database: SqlDatabase,
  id: FileId,
  documentTypeId: DocumentTypeId | null,
  updatedAt: string,
): SqlStatement {
  return database
    .prepare(`UPDATE ${FILE_TABLE} SET document_type_id = ?2, updated_at = ?3 WHERE id = ?1`)
    .bind(id, documentTypeId, updatedAt);
}

export function softDeleteFileStatement(
  database: SqlDatabase,
  id: FileId,
  deletedAt: string,
): SqlStatement {
  return database
    .prepare(`UPDATE ${FILE_TABLE} SET deleted_at = ?2, updated_at = ?2 WHERE id = ?1`)
    .bind(id, deletedAt);
}

// Folder-emptiness check (a file in the folder, any status, blocks the delete).
export function selectFolderFileStatement(database: SqlDatabase, folderId: FolderId): SqlStatement {
  return database
    .prepare(`SELECT id FROM ${FILE_TABLE} WHERE folder_id = ?1 LIMIT 1`)
    .bind(folderId);
}
