import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { FirmSettingDefinition } from "@magna-carta/data-access/setting-statements";
import type {
  DocumentCheckoutId,
  FileId,
  FileVersionId,
  UserId,
} from "@magna-carta/identifiers/types";
import { z } from "zod";

// The document_checkout table — an offline-working-copy claim or an opt-in exclusive lock on a file,
// held by one member against a base version. Tracked against @magna-carta/database's schema by the
// schema-name-sync fitness test.
export const DOCUMENT_CHECKOUT_TABLE = "document_checkout";

export type CheckoutLockType = "exclusive" | "offline_working_copy";
export type CheckoutStatus = "active" | "stale" | "released" | "reconciling";

export interface InsertDocumentCheckoutRow {
  readonly id: DocumentCheckoutId;
  readonly fileId: FileId;
  readonly holderMemberId: UserId;
  readonly lockType: CheckoutLockType;
  readonly baseVersionId: FileVersionId;
  readonly acquiredAt: string;
}

// Opens a checkout against a file's base version. acquired_at == last_activity_at at creation; status
// starts 'active' and idle_release_at is null until an idle window schedules a release.
export function insertDocumentCheckoutStatement(
  database: SqlDatabase,
  row: InsertDocumentCheckoutRow,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${DOCUMENT_CHECKOUT_TABLE} (id, file_id, holder_member_id, lock_type, base_version_id, acquired_at, last_activity_at, status, idle_release_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6, 'active', NULL)`,
    )
    .bind(row.id, row.fileId, row.holderMemberId, row.lockType, row.baseVersionId, row.acquiredAt);
}

export interface DocumentCheckoutRow {
  readonly id: DocumentCheckoutId;
  readonly fileId: FileId;
  readonly holderMemberId: UserId;
  readonly lockType: CheckoutLockType;
  readonly baseVersionId: FileVersionId;
  readonly status: CheckoutStatus;
}

function rowFrom(raw: {
  id: string;
  file_id: string;
  holder_member_id: string;
  lock_type: string;
  base_version_id: string;
  status: string;
}): DocumentCheckoutRow {
  return {
    id: raw.id as DocumentCheckoutId,
    fileId: raw.file_id as FileId,
    holderMemberId: raw.holder_member_id as UserId,
    lockType: raw.lock_type as CheckoutLockType,
    baseVersionId: raw.base_version_id as FileVersionId,
    status: raw.status as CheckoutStatus,
  };
}

// The single active (or reconciling) checkout for a file, if any — the open-checkout lookup the
// checkout/check-in paths gate on. A released/stale checkout is not returned.
export async function getOpenCheckout(
  database: SqlDatabase,
  fileId: FileId,
): Promise<DocumentCheckoutRow | undefined> {
  const { results } = await database
    .prepare(
      `SELECT id, file_id, holder_member_id, lock_type, base_version_id, status FROM ${DOCUMENT_CHECKOUT_TABLE} WHERE file_id = ?1 AND status IN ('active', 'reconciling') LIMIT 1`,
    )
    .bind(fileId)
    .all<{
      id: string;
      file_id: string;
      holder_member_id: string;
      lock_type: string;
      base_version_id: string;
      status: string;
    }>();
  const raw = results[0];
  return raw === undefined ? undefined : rowFrom(raw);
}

// The active exclusive lock on a file, if any — the launch read-only gate and the double-acquire
// refusal both key off this. An offline_working_copy checkout (optimistic, never-block) is not a lock
// and is never returned here; a released/stale/reconciling exclusive lock is not active.
export function getActiveExclusiveLockStatement(
  database: SqlDatabase,
  fileId: FileId,
): SqlStatement {
  return database
    .prepare(
      `SELECT id, file_id, holder_member_id, lock_type, base_version_id, status FROM ${DOCUMENT_CHECKOUT_TABLE} WHERE file_id = ?1 AND lock_type = 'exclusive' AND status = 'active' LIMIT 1`,
    )
    .bind(fileId);
}

export async function getActiveExclusiveLock(
  database: SqlDatabase,
  fileId: FileId,
): Promise<DocumentCheckoutRow | undefined> {
  const { results } = await getActiveExclusiveLockStatement(database, fileId).all<{
    id: string;
    file_id: string;
    holder_member_id: string;
    lock_type: string;
    base_version_id: string;
    status: string;
  }>();
  const raw = results[0];
  return raw === undefined ? undefined : rowFrom(raw);
}

export async function getCheckoutById(
  database: SqlDatabase,
  checkoutId: DocumentCheckoutId,
): Promise<DocumentCheckoutRow | undefined> {
  const { results } = await database
    .prepare(
      `SELECT id, file_id, holder_member_id, lock_type, base_version_id, status FROM ${DOCUMENT_CHECKOUT_TABLE} WHERE id = ?1`,
    )
    .bind(checkoutId)
    .all<{
      id: string;
      file_id: string;
      holder_member_id: string;
      lock_type: string;
      base_version_id: string;
      status: string;
    }>();
  const raw = results[0];
  return raw === undefined ? undefined : rowFrom(raw);
}

// Advances a checkout's lifecycle (active -> reconciling on a divergent check-in, -> released on a
// fast-forward or release). Guarded on the id so a replay is a no-op when already at the target.
export function setCheckoutStatusStatement(
  database: SqlDatabase,
  checkoutId: DocumentCheckoutId,
  status: CheckoutStatus,
): SqlStatement {
  return database
    .prepare(`UPDATE ${DOCUMENT_CHECKOUT_TABLE} SET status = ?2 WHERE id = ?1`)
    .bind(checkoutId, status);
}

// How long a checkout may sit with no activity before the idle sweep moves it toward release —
// firm-configurable, generous by default (7 days) so a real, slow offline edit is never reaped early.
export const checkoutIdleHoursDefinition: FirmSettingDefinition<number> = {
  key: "editing.checkoutIdleHours",
  schema: z.number().int().positive(),
  defaultValue: 7 * 24,
};

// The grace between 'stale' (the idle window passed) and 'released' (the auto-release), so a holder who
// returns during the grace can still resume before the checkout is reclaimed. A fixed window — the
// firm tunes the idle threshold above, not this safety margin.
export const CHECKOUT_STALE_GRACE_HOURS = 24;
// One sweep pass's per-firm cap so a large backlog never makes a single fire unbounded.
export const IDLE_CHECKOUT_SWEEP_BATCH = 200;

export interface IdleCheckoutRow {
  readonly id: DocumentCheckoutId;
  readonly fileId: FileId;
  readonly lockType: CheckoutLockType;
}

// Active checkouts whose last activity predates the cutoff — stage one of the idle sweep moves these to
// 'stale'. Both lock kinds qualify (an abandoned exclusive lock or offline copy); a reconciling
// checkout is mid-resolution and excluded by the status filter.
export function selectIdleActiveCheckoutsStatement(
  database: SqlDatabase,
  lastActivityBeforeIso: string,
  limit: number,
): SqlStatement {
  return database
    .prepare(
      `SELECT id, file_id, lock_type FROM ${DOCUMENT_CHECKOUT_TABLE} WHERE status = 'active' AND last_activity_at < ?1 LIMIT ?2`,
    )
    .bind(lastActivityBeforeIso, limit);
}

export async function selectIdleActiveCheckouts(
  database: SqlDatabase,
  lastActivityBeforeIso: string,
  limit: number,
): Promise<IdleCheckoutRow[]> {
  const { results } = await selectIdleActiveCheckoutsStatement(
    database,
    lastActivityBeforeIso,
    limit,
  ).all<{ id: string; file_id: string; lock_type: string }>();
  return results.map((row) => ({
    id: row.id as DocumentCheckoutId,
    fileId: row.file_id as FileId,
    lockType: row.lock_type as CheckoutLockType,
  }));
}

// Stale checkouts whose grace has elapsed — stage two releases these.
export async function selectReleasableStaleCheckouts(
  database: SqlDatabase,
  nowIso: string,
  limit: number,
): Promise<IdleCheckoutRow[]> {
  const { results } = await database
    .prepare(
      `SELECT id, file_id, lock_type FROM ${DOCUMENT_CHECKOUT_TABLE} WHERE status = 'stale' AND idle_release_at IS NOT NULL AND idle_release_at < ?1 LIMIT ?2`,
    )
    .bind(nowIso, limit)
    .all<{ id: string; file_id: string; lock_type: string }>();
  return results.map((row) => ({
    id: row.id as DocumentCheckoutId,
    fileId: row.file_id as FileId,
    lockType: row.lock_type as CheckoutLockType,
  }));
}

// Moves an active checkout to 'stale' and schedules its release. Guarded on the active state so an
// overlapping pass is a no-op.
// fitness:unguarded-write — a repeat is meant to be a no-op — zero rows means the state it moves to was already reached
export function markCheckoutStaleStatement(
  database: SqlDatabase,
  checkoutId: DocumentCheckoutId,
  idleReleaseAt: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${DOCUMENT_CHECKOUT_TABLE} SET status = 'stale', idle_release_at = ?2 WHERE id = ?1 AND status = 'active'`,
    )
    .bind(checkoutId, idleReleaseAt);
}

// Releases a stale checkout. Guarded on the stale state so a replay is a no-op.
// fitness:unguarded-write — a repeat is meant to be a no-op — zero rows means the state it moves to was already reached
export function releaseStaleCheckoutStatement(
  database: SqlDatabase,
  checkoutId: DocumentCheckoutId,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${DOCUMENT_CHECKOUT_TABLE} SET status = 'released' WHERE id = ?1 AND status = 'stale'`,
    )
    .bind(checkoutId);
}
