import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import type { UserId } from "@magna-carta/identifiers/types";
import { describe, expect, it } from "vitest";
import { commitEffectBatch, type BatchDatabase } from "../src/effect-batch.ts";
import { createShipmentDraft, recordPurchase } from "../src/shipment-service.ts";

const clock = { now: () => "2026-06-16T12:00:00.000Z" };
const now = () => clock.now();
const options = { clock, actorUserId: "user_a" as UserId };
const ADDR = JSON.stringify({
  name: "Jane",
  street1: "1 Main",
  city: "Reno",
  state: "NV",
  zip: "89501",
  country: "US",
});

function db(): BatchDatabase {
  return createMigratedNodeDatabase("per-firm").database;
}

describe("shipment service", () => {
  it("creates a draft shipment row", async () => {
    const database = db();
    const { shipmentId, effect } = await createShipmentDraft(
      database,
      {
        matterRef: null,
        fromAddress: ADDR,
        toAddress: ADDR,
        parcel: JSON.stringify({ weightOz: 8 }),
        options: "{}",
      },
      options,
    );
    await commitEffectBatch(database, effect, { now });
    const { results } = await database
      .prepare("SELECT status FROM shipment WHERE id = ?1")
      .bind(shipmentId)
      .all();
    expect(results[0]).toEqual({ status: "draft" });
  });

  it("records a purchase: shipment → purchased + a label row", async () => {
    const database = db();
    const draft = await createShipmentDraft(
      database,
      {
        matterRef: null,
        fromAddress: ADDR,
        toAddress: ADDR,
        parcel: JSON.stringify({ weightOz: 8 }),
        options: "{}",
      },
      options,
    );
    await commitEffectBatch(database, draft.effect, { now });
    const purchase = await recordPurchase(
      database,
      {
        shipmentId: draft.shipmentId,
        remoteShipmentId: "shp_1",
        carrier: "USPS",
        service: "Priority",
        trackingCode: "9400",
        labelFormat: "application/pdf",
        r2Key: `labels/${draft.shipmentId}.pdf`,
        postageCostMinor: 745,
        serviceFeeMinor: 5,
        currency: "USD",
      },
      options,
    );
    await commitEffectBatch(database, purchase.effect, { now });
    const { results } = await database
      .prepare(
        "SELECT status, tracking_code, postage_cost_minor, service_fee_minor FROM shipment WHERE id = ?1",
      )
      .bind(draft.shipmentId)
      .all();
    expect(results[0]).toEqual({
      status: "purchased",
      tracking_code: "9400",
      postage_cost_minor: 745,
      service_fee_minor: 5,
    });
    const labels = await database
      .prepare("SELECT cost_minor FROM shipment_label WHERE shipment_ref = ?1")
      .bind(draft.shipmentId)
      .all();
    expect(labels.results[0]).toEqual({ cost_minor: 745 });
  });
});
