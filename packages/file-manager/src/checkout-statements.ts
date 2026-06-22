import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type {
  DocumentCheckoutId,
  FileId,
  FileVersionId,
  UserId,
} from "@magna-carta/identifiers/types";

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
export async function getActiveExclusiveLock(
  database: SqlDatabase,
  fileId: FileId,
): Promise<DocumentCheckoutRow | undefined> {
  const { results } = await database
    .prepare(
      `SELECT id, file_id, holder_member_id, lock_type, base_version_id, status FROM ${DOCUMENT_CHECKOUT_TABLE} WHERE file_id = ?1 AND lock_type = 'exclusive' AND status = 'active' LIMIT 1`,
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
