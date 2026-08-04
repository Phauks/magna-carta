import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type {
  CustodyItemId,
  CustodyLocationId,
  CustodyMovementId,
  CustodyPacketId,
  ShipmentId,
  UserId,
} from "@magna-carta/identifiers/types";
import type { CustodyBorrowerKind, CustodyMovementKind } from "./types.ts";

// Table name tracked against @magna-carta/database's per-firm schema by the schema-name-sync
// fitness test.
export const CUSTODY_MOVEMENT_TABLE = "custody_movement";

// THIS MODULE DEFINES INSERTS AND READS ONLY, AND THAT IS THE POINT. custody_movement carries
// BEFORE UPDATE / BEFORE DELETE / replace-guard triggers that RAISE(ABORT), so an UPDATE or DELETE
// statement naming this table cannot succeed at runtime — writing one here would only produce a
// failure at the worst possible moment. A mis-recorded movement is corrected by appending a
// `correction` row that names the row it corrects.

export interface CustodyMovementRow {
  readonly id: CustodyMovementId;
  readonly packet_id: CustodyPacketId;
  readonly item_id: CustodyItemId | null;
  readonly kind: CustodyMovementKind;
  readonly occurred_at: string;
  readonly recorded_at: string;
  readonly recorded_by_user_id: UserId | null;
  readonly from_location_id: CustodyLocationId | null;
  readonly to_location_id: CustodyLocationId | null;
  readonly borrower_kind: CustodyBorrowerKind | null;
  readonly borrower_user_id: UserId | null;
  readonly borrower_entity_id: string | null;
  readonly borrower_name: string | null;
  readonly due_back_on: string | null;
  readonly reason: string | null;
  readonly corrects_movement_id: CustodyMovementId | null;
  readonly shipment_id: ShipmentId | null;
  readonly note: string | null;
}

const MOVEMENT_COLUMNS =
  "id, packet_id, item_id, kind, occurred_at, recorded_at, recorded_by_user_id, from_location_id, to_location_id, borrower_kind, borrower_user_id, borrower_entity_id, borrower_name, due_back_on, reason, corrects_movement_id, shipment_id, note";

export interface InsertCustodyMovementRow {
  readonly id: CustodyMovementId;
  readonly packetId: CustodyPacketId;
  readonly itemId: CustodyItemId | null;
  readonly kind: CustodyMovementKind;
  // When the event happened in the physical world, which is what the register displays and reports
  // on — often earlier than when it was typed in, and back-dating is supported on purpose.
  readonly occurredAt: string;
  // When the assertion was made. Kept separate so an unusual gap between the two is something a
  // reviewer can see rather than something the schema silently erases.
  readonly recordedAt: string;
  readonly recordedByUserId: UserId | null;
  readonly fromLocationId: CustodyLocationId | null;
  readonly toLocationId: CustodyLocationId | null;
  readonly borrowerKind: CustodyBorrowerKind | null;
  readonly borrowerUserId: UserId | null;
  readonly borrowerEntityId: string | null;
  readonly borrowerName: string | null;
  readonly dueBackOn: string | null;
  readonly reason: string | null;
  readonly correctsMovementId: CustodyMovementId | null;
  readonly shipmentId: ShipmentId | null;
  readonly note: string | null;
}

export function insertCustodyMovementStatement(
  database: SqlDatabase,
  row: InsertCustodyMovementRow,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${CUSTODY_MOVEMENT_TABLE} (${MOVEMENT_COLUMNS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)`,
    )
    .bind(
      row.id,
      row.packetId,
      row.itemId,
      row.kind,
      row.occurredAt,
      row.recordedAt,
      row.recordedByUserId,
      row.fromLocationId,
      row.toLocationId,
      row.borrowerKind,
      row.borrowerUserId,
      row.borrowerEntityId,
      row.borrowerName,
      row.dueBackOn,
      row.reason,
      row.correctsMovementId,
      row.shipmentId,
      row.note,
    );
}

export function selectCustodyMovementStatement(
  database: SqlDatabase,
  id: CustodyMovementId,
): SqlStatement {
  return database
    .prepare(`SELECT ${MOVEMENT_COLUMNS} FROM ${CUSTODY_MOVEMENT_TABLE} WHERE id = ?1`)
    .bind(id);
}

export async function readCustodyMovement(
  database: SqlDatabase,
  id: CustodyMovementId,
): Promise<CustodyMovementRow | undefined> {
  const { results } = await selectCustodyMovementStatement(database, id).all<CustodyMovementRow>();
  return results[0];
}

// A packet's history, newest first, keyset-paginated on (occurred_at, id). The ledger is the one
// table in this subsystem that grows without bound — a firm holds a packet for decades — so the
// history read is paginated from the start rather than retrofitted once a packet has two hundred
// rows. The cursor is the last row's (occurred_at, id); passing none starts at the newest.
export function selectCustodyMovementsStatement(
  database: SqlDatabase,
  packetId: CustodyPacketId,
  limit: number,
  cursor?: { readonly occurredAt: string; readonly id: string },
): SqlStatement {
  if (cursor === undefined) {
    return database
      .prepare(
        `SELECT ${MOVEMENT_COLUMNS} FROM ${CUSTODY_MOVEMENT_TABLE} WHERE packet_id = ?1 ORDER BY occurred_at DESC, id DESC LIMIT ?2`,
      )
      .bind(packetId, limit);
  }
  return database
    .prepare(
      `SELECT ${MOVEMENT_COLUMNS} FROM ${CUSTODY_MOVEMENT_TABLE} WHERE packet_id = ?1 AND (occurred_at < ?2 OR (occurred_at = ?2 AND id < ?3)) ORDER BY occurred_at DESC, id DESC LIMIT ?4`,
    )
    .bind(packetId, cursor.occurredAt, cursor.id, limit);
}

export async function readCustodyMovements(
  database: SqlDatabase,
  packetId: CustodyPacketId,
  limit: number,
  cursor?: { readonly occurredAt: string; readonly id: string },
): Promise<CustodyMovementRow[]> {
  const { results } = await selectCustodyMovementsStatement(
    database,
    packetId,
    limit,
    cursor,
  ).all<CustodyMovementRow>();
  return results;
}
