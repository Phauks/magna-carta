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
      `SELECT id, matter_ref, status, from_address, to_address, parcel, options, remote_shipment_id, carrier, service, tracking_code, label_ref, postage_cost_minor, service_fee_minor, currency FROM ${SHIPMENT_TABLE} WHERE id = ?1`,
    )
    .bind(id);
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
      `UPDATE ${SHIPMENT_TABLE} SET status = 'purchased', remote_shipment_id = ?2, carrier = ?3, service = ?4, tracking_code = ?5, label_ref = ?6, postage_cost_minor = ?7, service_fee_minor = ?8, currency = ?9, updated_at = ?10 WHERE id = ?1`,
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

export function markShipmentRefundedStatement(
  database: SqlDatabase,
  id: ShipmentId,
  updatedAt: string,
): SqlStatement {
  return database
    .prepare(`UPDATE ${SHIPMENT_TABLE} SET status = 'refunded', updated_at = ?2 WHERE id = ?1`)
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
