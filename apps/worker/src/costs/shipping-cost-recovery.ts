import type {
  RecoverableChargeEvent,
  RecoverableChargeLine,
} from "@magna-carta/costs/recoverable-charge";

// The shipping producer adapter for the generalized recoverable-charge seam. A purchased shipment
// fronts a third-party postage cost and may add a Magna-Carta-absorbed handling fee; this adapter
// turns that into the seam's neutral RecoverableChargeEvent so the cost-recovery consumer can map it
// into matter disbursements without knowing anything about shipping. Keeping the shipping-specific
// shape here (and the mapping pure in @magna-carta/costs) lets a future fee source — an e-signature
// send, an outbound message — plug into the same consumer with its own adapter.

// The shipment.purchased payload as it leaves the producer (shipment-service.recordPurchase) and
// arrives on the per-firm queue. The relay delivers the outbox row's canonical-JSON payload as a
// STRING; the consumer parses it into this shape before calling in here. The amounts are integer
// minor units in `currency`; they pass through to the captures unchanged (no float math).
export interface ShipmentPurchasedPayload {
  readonly shipmentId: string;
  readonly postageCostMinor: number;
  readonly serviceFeeMinor: number;
  readonly currency: string;
}

// Only the column this adapter needs from the shipment row: the matter the charge disburses to. The
// payload carries the amounts but NOT the matter link, so the matter is read back from the firm
// database by shipment id. matter_ref is nullable — a shipment may be firm-administrative, with
// nowhere to bill.
interface ShipmentMatterRow {
  readonly matter_ref: string | null;
}

// Builds the recoverable-charge event for a purchased shipment, reading the matter link back from the
// firm database. The two charged lines map to the seam's two recovery kinds:
//   - postage  → pass_through / "postage": a third-party disbursement the firm fronts and always bills.
//   - service  → platform_fee / "shipping_service_fee": an absorbed handling fee the firm passes on
//     only under its per-category policy.
// A zero-or-negative amount yields no line: there is nothing to recover, and captureCost rejects a
// non-positive amount — so an absent service fee simply produces no service-fee line rather than a
// poison capture. sourceRef and idempotencyKey are both the shipmentId, so the downstream per-line
// recoveryRef (`${shipmentId}:${category}`) is stable across queue redelivery — the idempotency floor.
//
// Returns null when no shipment row exists for the id: the message is permanently unprocessable (a
// producer/store drift, or a deleted shipment), so the consumer acks-and-drops it rather than
// retry-storming a row that will never appear. Uses `.all()` + results[0], never `.first()` (the
// node-sqlite test adapter has no `.first()`).
export async function buildShipmentRecoverableCharge(
  firmDatabase: D1Database,
  payload: ShipmentPurchasedPayload,
): Promise<RecoverableChargeEvent | null> {
  const { results } = await firmDatabase
    .prepare("SELECT matter_ref FROM shipment WHERE id = ?1")
    .bind(payload.shipmentId)
    .all<ShipmentMatterRow>();
  const row = results[0];
  if (row === undefined) return null;

  const lines: RecoverableChargeLine[] = [];
  if (payload.postageCostMinor > 0) {
    lines.push({
      category: "postage",
      amountMinor: payload.postageCostMinor,
      kind: "pass_through",
      description: "Postage",
    });
  }
  if (payload.serviceFeeMinor > 0) {
    lines.push({
      category: "shipping_service_fee",
      amountMinor: payload.serviceFeeMinor,
      kind: "platform_fee",
      description: "Shipping service fee",
    });
  }

  return {
    matterRef: row.matter_ref,
    currency: payload.currency,
    sourceRef: payload.shipmentId,
    idempotencyKey: payload.shipmentId,
    lines,
  };
}
