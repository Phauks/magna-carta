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
  // Populated only on a `released` row, and refused by trigger on any other kind: the authority the
  // property left on, how the person collecting it was identified, who made that check, and the
  // second signatory when the firm requires one.
  readonly release_authority_basis: string | null;
  readonly release_identity_evidence: string | null;
  readonly release_identity_verified_by_user_id: UserId | null;
  readonly release_witnessed_by_user_id: UserId | null;
}

const MOVEMENT_COLUMNS =
  "id, packet_id, item_id, kind, occurred_at, recorded_at, recorded_by_user_id, from_location_id, to_location_id, borrower_kind, borrower_user_id, borrower_entity_id, borrower_name, due_back_on, reason, corrects_movement_id, shipment_id, note, release_authority_basis, release_identity_evidence, release_identity_verified_by_user_id, release_witnessed_by_user_id";

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
  // The release capture, resolved by the gate in release-gate.ts. Optional rather than a required
  // null because only ONE caller ever sets them — the movement write path, on a `released` kind,
  // after the gate has run. Every other append in this package (a hold, a review, the opening entry
  // on a new packet) omits them, which is both less noise and one fewer place a capture could be
  // attached to a movement nothing gated. The database refuses that too.
  readonly releaseAuthorityBasis?: string | null;
  readonly releaseIdentityEvidence?: string | null;
  readonly releaseIdentityVerifiedByUserId?: UserId | null;
  readonly releaseWitnessedByUserId?: UserId | null;
}

export function insertCustodyMovementStatement(
  database: SqlDatabase,
  row: InsertCustodyMovementRow,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${CUSTODY_MOVEMENT_TABLE} (${MOVEMENT_COLUMNS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22)`,
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
      row.releaseAuthorityBasis ?? null,
      row.releaseIdentityEvidence ?? null,
      row.releaseIdentityVerifiedByUserId ?? null,
      row.releaseWitnessedByUserId ?? null,
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
//
// WHAT AN ITEM'S HISTORY IS, WHICH IS WHY THE FILTER IS NOT `item_id = ?`. A chain of custody for
// one original has to answer where that original has been, and an item inside a packet goes
// wherever the packet goes: the will was in the box when the box moved to the Reno safe, and it was
// in the deed case when the case went to a completion meeting. A filter that returned only rows
// naming the item would answer "itemized, superseded" over a decade and call it a chain of custody.
// So the scope is the item's own rows PLUS the packet-wide rows, and it is the READER that is told
// which is which — the row carries `item_id`, so nothing is inferred to draw that distinction.
export function selectCustodyMovementsStatement(
  database: SqlDatabase,
  packetId: CustodyPacketId,
  limit: number,
  cursor?: { readonly occurredAt: string; readonly id: string },
  itemId?: CustodyItemId,
): SqlStatement {
  // The predicate and its bindings are assembled together, in one place, numbering as they go.
  // Written as four hand-numbered query strings the two optional parts multiply into, `?5` in one
  // of them silently means `?4`'s value in another, and the wrong page comes back rather than an
  // error — the failure this shape cannot have.
  const bindings: (string | number)[] = [packetId];
  const predicates = [`packet_id = ?${bindings.length}`];

  if (cursor !== undefined) {
    bindings.push(cursor.occurredAt, cursor.id);
    const occurred = bindings.length - 1;
    const id = bindings.length;
    predicates.push(`(occurred_at < ?${occurred} OR (occurred_at = ?${occurred} AND id < ?${id}))`);
  }
  if (itemId !== undefined) {
    bindings.push(itemId);
    predicates.push(`(item_id IS NULL OR item_id = ?${bindings.length})`);
  }

  bindings.push(limit);
  return database
    .prepare(
      `SELECT ${MOVEMENT_COLUMNS} FROM ${CUSTODY_MOVEMENT_TABLE} WHERE ${predicates.join(" AND ")} ORDER BY occurred_at DESC, id DESC LIMIT ?${bindings.length}`,
    )
    .bind(...bindings);
}

export async function readCustodyMovements(
  database: SqlDatabase,
  packetId: CustodyPacketId,
  limit: number,
  cursor?: { readonly occurredAt: string; readonly id: string },
  itemId?: CustodyItemId,
): Promise<CustodyMovementRow[]> {
  const { results } = await selectCustodyMovementsStatement(
    database,
    packetId,
    limit,
    cursor,
    itemId,
  ).all<CustodyMovementRow>();
  return results;
}
