import type {
  MatterId,
  ShipmentId,
  ShipmentLabelId,
  TrackingEventId,
} from "@magna-carta/identifiers/types";
import type { SqlDatabase, SqlStatement } from "./idempotency-statements.ts";

export const SHIPMENT_TABLE = "shipment";
export const SHIPMENT_LABEL_TABLE = "shipment_label";
export const TRACKING_EVENT_TABLE = "tracking_event";

export interface InsertShipmentRow {
  readonly id: ShipmentId;
  readonly matterRef: MatterId | null;
  readonly fromAddress: string; // JSON
  readonly toAddress: string; // JSON
  readonly parcel: string; // JSON
  readonly options: string; // JSON
  readonly createdAt: string;
}

export function insertShipmentDraftStatement(
  database: SqlDatabase,
  row: InsertShipmentRow,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${SHIPMENT_TABLE} (id, matter_ref, status, from_address, to_address, parcel, options, created_at, updated_at) VALUES (?1, ?2, 'draft', ?3, ?4, ?5, ?6, ?7, ?7)`,
    )
    .bind(
      row.id,
      row.matterRef,
      row.fromAddress,
      row.toAddress,
      row.parcel,
      row.options,
      row.createdAt,
    );
}

export function selectShipmentStatement(database: SqlDatabase, id: ShipmentId): SqlStatement {
  return database
    .prepare(
      `SELECT id, matter_ref, status, from_address, to_address, parcel, options, remote_shipment_id, purchase_claim_key, carrier, service, tracking_code, label_ref, postage_cost_minor, service_fee_minor, currency FROM ${SHIPMENT_TABLE} WHERE id = ?1`,
    )
    .bind(id);
}

// Record the carrier-side shipment a rate quote was taken against. Guarded on the pre-purchase
// statuses so re-rating can never reset a shipment whose label is already bought or in flight —
// and so the id a later purchase is checked against is one THIS server persisted, not one the
// client supplied.
// fitness:unguarded-write — a repeat is meant to be a no-op — zero rows means the state it moves to was already reached
export function markShipmentRatedStatement(
  database: SqlDatabase,
  id: ShipmentId,
  remoteShipmentId: string,
  updatedAt: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${SHIPMENT_TABLE} SET status = 'rated', remote_shipment_id = ?2, updated_at = ?3 WHERE id = ?1 AND status IN ('draft', 'rated')`,
    )
    .bind(id, remoteShipmentId, updatedAt);
}

// Take the exclusive right to buy a label for this shipment. The carrier API offers no idempotency
// key, so this claim is the ONLY thing standing between a retried or concurrent purchase and a
// second real charge: the guard admits exactly one winner out of any number of simultaneous
// attempts, and refuses outright once a label exists. meta.changes === 1 means the claim is held;
// 0 means the shipment is already purchasing, purchased, or refunded.
//
// The claim is deliberately NOT re-entrant for the same key. Two requests carrying one idempotency
// key can both pass the advisory idempotency pre-check (no record exists until the effect commits),
// so a same-key re-claim would let both reach the carrier. Recovery from a stuck claim goes through
// releaseShipmentPurchaseClaimStatement, which only the holder can call and only when the carrier
// definitively rejected the buy.
// fitness:unguarded-write — the caller runs this on its own and branches on the affected-row count, so a refusal is already surfaced there
export function claimShipmentPurchaseStatement(
  database: SqlDatabase,
  id: ShipmentId,
  claimKey: string,
  updatedAt: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${SHIPMENT_TABLE} SET status = 'purchasing', purchase_claim_key = ?2, updated_at = ?3 WHERE id = ?1 AND status IN ('draft', 'rated')`,
    )
    .bind(id, claimKey, updatedAt);
}

// Hand the claim back after a buy the carrier definitively refused (nothing was charged, so a fresh
// attempt is safe). Guarded on the claim key: a request that does not hold the claim cannot release
// another request's in-flight purchase. An INDETERMINATE failure — a network drop, a carrier 5xx,
// or any failure after the buy returned — must NOT be released: the label may exist and be billed,
// and the shipment stays `purchasing` until it is refunded or reconciled.
// fitness:unguarded-write — the claim-key predicate decides whose purchase this is, and the caller owns what losing it means
export function releaseShipmentPurchaseClaimStatement(
  database: SqlDatabase,
  id: ShipmentId,
  claimKey: string,
  updatedAt: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${SHIPMENT_TABLE} SET status = 'rated', purchase_claim_key = NULL, updated_at = ?3 WHERE id = ?1 AND status = 'purchasing' AND purchase_claim_key = ?2`,
    )
    .bind(id, claimKey, updatedAt);
}

export interface PurchaseUpdate {
  readonly remoteShipmentId: string;
  readonly carrier: string;
  readonly service: string;
  readonly trackingCode: string;
  readonly labelRef: ShipmentLabelId;
  readonly postageCostMinor: number;
  readonly serviceFeeMinor: number;
  readonly currency: string;
}

export function markShipmentPurchasedStatement(
  database: SqlDatabase,
  id: ShipmentId,
  update: PurchaseUpdate,
  updatedAt: string,
): SqlStatement {
  return database
    .prepare(
      // Clears the purchase claim in the same statement that records the purchase: the claim's whole
      // job was to hold the shipment while money was in flight, and it ends when the label lands.
      `UPDATE ${SHIPMENT_TABLE} SET status = 'purchased', purchase_claim_key = NULL, remote_shipment_id = ?2, carrier = ?3, service = ?4, tracking_code = ?5, label_ref = ?6, postage_cost_minor = ?7, service_fee_minor = ?8, currency = ?9, updated_at = ?10 WHERE id = ?1`,
    )
    .bind(
      id,
      update.remoteShipmentId,
      update.carrier,
      update.service,
      update.trackingCode,
      update.labelRef,
      update.postageCostMinor,
      update.serviceFeeMinor,
      update.currency,
      updatedAt,
    );
}

// Also releases any purchase claim: a refund is the reconciliation that ends an in-flight purchase
// whose outcome was never confirmed, so the shipment must not stay claimed afterwards.
export function markShipmentRefundedStatement(
  database: SqlDatabase,
  id: ShipmentId,
  updatedAt: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${SHIPMENT_TABLE} SET status = 'refunded', purchase_claim_key = NULL, updated_at = ?2 WHERE id = ?1`,
    )
    .bind(id, updatedAt);
}

export interface InsertLabelRow {
  readonly id: ShipmentLabelId;
  readonly shipmentRef: ShipmentId;
  readonly format: string;
  readonly r2Key: string;
  readonly trackingCode: string;
  readonly costMinor: number;
  readonly currency: string;
  readonly createdAt: string;
}

export function insertLabelStatement(database: SqlDatabase, row: InsertLabelRow): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${SHIPMENT_LABEL_TABLE} (id, shipment_ref, format, r2_key, tracking_code, cost_minor, currency, voided, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, ?8)`,
    )
    .bind(
      row.id,
      row.shipmentRef,
      row.format,
      row.r2Key,
      row.trackingCode,
      row.costMinor,
      row.currency,
      row.createdAt,
    );
}

// The label rows for a shipment, newest first. Scoped to the caller's own firm database, so the row
// existing at all is the proof that this firm owns the label — which is what makes the stored r2_key
// safe to read bytes with. A shipment id from another firm simply finds nothing here.
export function selectShipmentLabelsStatement(
  database: SqlDatabase,
  shipmentRef: ShipmentId,
): SqlStatement {
  return database
    .prepare(
      `SELECT id, format, r2_key, voided, created_at FROM ${SHIPMENT_LABEL_TABLE} WHERE shipment_ref = ?1 ORDER BY created_at DESC`,
    )
    .bind(shipmentRef);
}

export interface InsertTrackingEventRow {
  readonly id: TrackingEventId;
  readonly shipmentRef: ShipmentId;
  readonly remoteId: string;
  readonly status: string;
  readonly occurredAt: string | null;
  readonly location: string | null;
  readonly message: string | null;
  readonly createdAt: string;
}

// INSERT OR IGNORE: the (shipment_ref, remote_id) unique index makes a re-pulled event a no-op.
export function insertTrackingEventStatement(
  database: SqlDatabase,
  row: InsertTrackingEventRow,
): SqlStatement {
  return database
    .prepare(
      `INSERT OR IGNORE INTO ${TRACKING_EVENT_TABLE} (id, shipment_ref, remote_id, status, occurred_at, location, message, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
    )
    .bind(
      row.id,
      row.shipmentRef,
      row.remoteId,
      row.status,
      row.occurredAt,
      row.location,
      row.message,
      row.createdAt,
    );
}

export function listTrackingEventsStatement(
  database: SqlDatabase,
  shipmentRef: ShipmentId,
): SqlStatement {
  return database
    .prepare(
      `SELECT remote_id, status, occurred_at, location, message FROM ${TRACKING_EVENT_TABLE} WHERE shipment_ref = ?1 ORDER BY occurred_at`,
    )
    .bind(shipmentRef);
}

// The firm's shipments, newest first, for the register. Keyset pagination on (created_at, id) rather
// than an offset: a register is read while shipments are being created, and an offset would skip or
// repeat rows as the page moves under the reader. The id breaks ties so two shipments created in the
// same millisecond cannot straddle a page boundary and lose one.
//
// The projection is what a register row shows plus what its window opens with — deliberately not
// SELECT *, so the addresses and the options blob (the largest columns, and the ones holding a
// recipient's details) are read only when one shipment is actually opened.
export function listShipmentsStatement(
  database: SqlDatabase,
  options: { readonly limit: number; readonly cursor: ShipmentListCursor | null },
): SqlStatement {
  const projection = `id, matter_ref, status, to_address, carrier, service, tracking_code, postage_cost_minor, service_fee_minor, currency, created_at`;
  if (options.cursor === null) {
    return database
      .prepare(
        `SELECT ${projection} FROM ${SHIPMENT_TABLE} ORDER BY created_at DESC, id DESC LIMIT ?1`,
      )
      .bind(options.limit);
  }
  return database
    .prepare(
      `SELECT ${projection} FROM ${SHIPMENT_TABLE} WHERE (created_at < ?1) OR (created_at = ?1 AND id < ?2) ORDER BY created_at DESC, id DESC LIMIT ?3`,
    )
    .bind(options.cursor.createdAt, options.cursor.id, options.limit);
}

export interface ShipmentListCursor {
  readonly createdAt: string;
  readonly id: string;
}
