import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type {
  CustodyHoldId,
  CustodyItemId,
  CustodyPacketId,
  FileId,
  UserId,
} from "@magna-carta/identifiers/types";
import type { CustodyHoldKind } from "./types.ts";

// Table names tracked against @magna-carta/database's per-firm schema by the schema-name-sync
// fitness test.
export const CUSTODY_HOLD_TABLE = "custody_hold";
export const CUSTODY_SCAN_TABLE = "custody_scan";

export interface CustodyHoldRow {
  readonly id: CustodyHoldId;
  readonly packet_id: CustodyPacketId;
  readonly item_id: CustodyItemId | null;
  readonly kind: CustodyHoldKind;
  readonly placed_at: string;
  readonly placed_by: UserId | null;
  readonly reason: string | null;
  readonly released_at: string | null;
  readonly released_by: UserId | null;
}

const HOLD_COLUMNS =
  "id, packet_id, item_id, kind, placed_at, placed_by, reason, released_at, released_by";

export function insertCustodyHoldStatement(
  database: SqlDatabase,
  row: {
    readonly id: CustodyHoldId;
    readonly packetId: CustodyPacketId;
    readonly itemId: CustodyItemId | null;
    readonly kind: CustodyHoldKind;
    readonly placedAt: string;
    readonly placedBy: UserId | null;
    readonly reason: string | null;
    readonly createdAt: string;
  },
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${CUSTODY_HOLD_TABLE} (id, packet_id, item_id, kind, placed_at, placed_by, reason, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)`,
    )
    .bind(
      row.id,
      row.packetId,
      row.itemId,
      row.kind,
      row.placedAt,
      row.placedBy,
      row.reason,
      row.createdAt,
    );
}

// Releasing carries its own precondition (released_at IS NULL) so a concurrent release makes this a
// no-op the caller detects, rather than silently overwriting the first releaser's identity.
// fitness:unguarded-write — a repeat is meant to be a no-op — zero rows means the state it moves to was already reached
export function releaseCustodyHoldStatement(
  database: SqlDatabase,
  id: CustodyHoldId,
  releasedBy: UserId | null,
  releasedAt: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${CUSTODY_HOLD_TABLE} SET released_at = ?2, released_by = ?3, updated_at = ?2 WHERE id = ?1 AND released_at IS NULL`,
    )
    .bind(id, releasedAt, releasedBy);
}

export function selectCustodyHoldStatement(database: SqlDatabase, id: CustodyHoldId): SqlStatement {
  return database
    .prepare(`SELECT ${HOLD_COLUMNS} FROM ${CUSTODY_HOLD_TABLE} WHERE id = ?1`)
    .bind(id);
}

export async function readCustodyHold(
  database: SqlDatabase,
  id: CustodyHoldId,
): Promise<CustodyHoldRow | undefined> {
  const { results } = await selectCustodyHoldStatement(database, id).all<CustodyHoldRow>();
  return results[0];
}

// Every hold in force on a packet, including the item-scoped ones. An item-scoped hold still blocks
// a packet-level release: releasing the envelope would release the held will inside it.
export function selectActiveCustodyHoldsStatement(
  database: SqlDatabase,
  packetId: CustodyPacketId,
): SqlStatement {
  return database
    .prepare(
      `SELECT ${HOLD_COLUMNS} FROM ${CUSTODY_HOLD_TABLE} WHERE packet_id = ?1 AND released_at IS NULL ORDER BY placed_at ASC, id ASC`,
    )
    .bind(packetId);
}

export async function readActiveCustodyHolds(
  database: SqlDatabase,
  packetId: CustodyPacketId,
): Promise<CustodyHoldRow[]> {
  const { results } = await selectActiveCustodyHoldsStatement(
    database,
    packetId,
  ).all<CustodyHoldRow>();
  return results;
}

export function selectCustodyHoldsStatement(
  database: SqlDatabase,
  packetId: CustodyPacketId,
): SqlStatement {
  return database
    .prepare(
      `SELECT ${HOLD_COLUMNS} FROM ${CUSTODY_HOLD_TABLE} WHERE packet_id = ?1 ORDER BY placed_at DESC, id DESC`,
    )
    .bind(packetId);
}

export async function readCustodyHolds(
  database: SqlDatabase,
  packetId: CustodyPacketId,
): Promise<CustodyHoldRow[]> {
  const { results } = await selectCustodyHoldsStatement(database, packetId).all<CustodyHoldRow>();
  return results;
}

// The blocker a destruction path calls before removing a stored file: is this file a scanned copy
// bound to a packet that is under a hold in force? A scan inherits its packet's holds, so a
// retention sweep must not be able to destroy the scan of a will that is under a legal hold. This is
// the read that makes the deleted-file lifecycle's "blocked by a Custodian hold" arm real rather
// than nominal; a hold-aware destruction sweep calls it, and returning an empty list is the only
// answer that permits destruction.
export function selectActiveCustodyHoldsForFileStatement(
  database: SqlDatabase,
  fileId: FileId,
): SqlStatement {
  return database
    .prepare(
      `SELECT hold.id AS id, hold.packet_id AS packet_id, hold.item_id AS item_id, hold.kind AS kind, hold.placed_at AS placed_at, hold.placed_by AS placed_by, hold.reason AS reason, hold.released_at AS released_at, hold.released_by AS released_by
         FROM ${CUSTODY_HOLD_TABLE} AS hold
         JOIN ${CUSTODY_SCAN_TABLE} AS scan ON scan.packet_id = hold.packet_id
        WHERE scan.file_id = ?1 AND hold.released_at IS NULL
        ORDER BY hold.placed_at ASC, hold.id ASC`,
    )
    .bind(fileId);
}

export async function readActiveCustodyHoldsForFile(
  database: SqlDatabase,
  fileId: FileId,
): Promise<CustodyHoldRow[]> {
  const { results } = await selectActiveCustodyHoldsForFileStatement(
    database,
    fileId,
  ).all<CustodyHoldRow>();
  return results;
}
