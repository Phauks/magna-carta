import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FirmId, MatterId, ShipmentId, UserId } from "@magna-carta/identifiers/types";
import {
  perFirmQueue,
  type PerFirmQueueMessage,
} from "../src/costs/recoverable-charge-consumer.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { applyPerFirmMigrations } from "./support/apply-per-firm-migrations.ts";

// The first per-firm queue consumer over real Miniflare bindings: a synthetic per-firm queue message
// (Miniflare cannot deliver real relay sends) for a shipment.purchased outbox row drives the producer
// adapter + the recoverable-charge mapping to one or more matter disbursements. The consumer is
// invoked directly with a fake MessageBatch, exactly as production's queue() branch would route it.

const SHIPPING_SERVICE_FEE_SETTING_KEY = "cost.recover_platform_fee.shipping_service_fee";
const TS = "2026-06-26T12:00:00.000Z";

let firmId: FirmId;
let matterId: MatterId;
const ACTOR = "user_costrecovery" as UserId;

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  await applyPerFirmMigrations(env.DB_FIRM_POOL_1);
  firmId = newIdentifier("firm");
  // The control-plane firm row: its database_identifier is the dev-pool binding name the two-hop
  // resolution walks message.firmId → database_identifier → bound D1.
  await env.DB_CONTROL.prepare(
    "INSERT INTO firm (id, name, database_identifier, bucket_name, status, created_at) VALUES (?1, ?2, 'DB_FIRM_POOL_1', ?3, 'active', ?4)",
  )
    .bind(firmId, "Cost Recovery Test Firm", "cost-recovery-test-bucket", TS)
    .run();
  await env.DB_FIRM_POOL_1.prepare(
    "INSERT INTO member (user_id, display_name, status, created_at) VALUES (?1, 'Cost Recovery Actor', 'active', ?2)",
  )
    .bind(ACTOR, TS)
    .run();
  matterId = newIdentifier("matter");
  await env.DB_FIRM_POOL_1.prepare(
    "INSERT INTO matter (id, title, status, responsible_member_id, created_at, updated_at) VALUES (?1, 'Cost Recovery Matter', 'open', ?2, ?3, ?3)",
  )
    .bind(matterId, ACTOR, TS)
    .run();
});

// Seeds a purchased shipment row. The adapter reads only matter_ref back from it (the amounts ride
// the queue payload), but the row carries the NOT-NULL columns so the insert is valid.
async function seedShipment(shipmentId: string, matterRef: string | null): Promise<void> {
  await env.DB_FIRM_POOL_1.prepare(
    "INSERT INTO shipment (id, matter_ref, status, from_address, to_address, parcel, options, postage_cost_minor, service_fee_minor, currency, created_at, updated_at) VALUES (?1, ?2, 'purchased', '{}', '{}', '{}', '{}', ?3, ?4, 'USD', ?5, ?5)",
  )
    .bind(shipmentId, matterRef, 1299, 150, TS)
    .run();
}

function purchasedMessage(
  shipmentId: string,
  amounts: { postageCostMinor: number; serviceFeeMinor: number },
): PerFirmQueueMessage {
  return {
    id: `outbox_${shipmentId}`,
    firmId,
    topic: "shipment.purchased",
    payload: JSON.stringify({
      shipmentId,
      postageCostMinor: amounts.postageCostMinor,
      serviceFeeMinor: amounts.serviceFeeMinor,
      currency: "USD",
    }),
    aggregateKey: null,
    seq: null,
  };
}

// A fake MessageBatch over the per-firm queue, capturing ack()/retry() so the test can assert the
// terminal disposition without a real queue.
function makeBatch(message: PerFirmQueueMessage) {
  const acks: string[] = [];
  const retries: string[] = [];
  const batch = {
    queue: "magna-carta-production-platform-jobs",
    messages: [
      {
        id: message.id,
        timestamp: new Date(),
        attempts: 1,
        body: message,
        ack: () => acks.push(message.id),
        retry: () => retries.push(message.id),
      },
    ],
  } as unknown as MessageBatch<PerFirmQueueMessage>;
  return { batch, acks, retries };
}

interface CostRow {
  recovery_category: string | null;
  disbursement_class: string;
  billable: number;
  recovery_ref: string | null;
  amount_minor: number;
  source: string;
  matter_id: string;
}

async function costRowsForShipment(shipmentId: string): Promise<CostRow[]> {
  const { results } = await env.DB_FIRM_POOL_1.prepare(
    "SELECT recovery_category, disbursement_class, billable, recovery_ref, amount_minor, source, matter_id FROM cost_entry WHERE recovery_ref LIKE ?1 ORDER BY recovery_ref",
  )
    .bind(`${shipmentId}:%`)
    .all<CostRow>();
  return results;
}

describe("perFirmQueue — shipment.purchased cost recovery", () => {
  it("posts exactly one postage recovery (policy off) and acks the message", async () => {
    const shipmentId = newIdentifier("shipment") as ShipmentId;
    await seedShipment(shipmentId, matterId);

    const { batch, acks, retries } = makeBatch(
      purchasedMessage(shipmentId, { postageCostMinor: 1299, serviceFeeMinor: 150 }),
    );
    await perFirmQueue(batch, env);

    const rows = await costRowsForShipment(shipmentId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      recovery_category: "postage",
      disbursement_class: "hard",
      billable: 1,
      recovery_ref: `${shipmentId}:postage`,
      amount_minor: 1299,
      source: "recovery",
      matter_id: matterId,
    });

    expect(acks).toEqual([`outbox_${shipmentId}`]);
    expect(retries).toEqual([]);
  });

  it("is idempotent on redelivery — the same message posts no second row", async () => {
    const shipmentId = newIdentifier("shipment") as ShipmentId;
    await seedShipment(shipmentId, matterId);
    const message = purchasedMessage(shipmentId, { postageCostMinor: 1299, serviceFeeMinor: 150 });

    await perFirmQueue(makeBatch(message).batch, env);
    const second = makeBatch(message);
    await perFirmQueue(second.batch, env);

    const rows = await costRowsForShipment(shipmentId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.recovery_ref).toBe(`${shipmentId}:postage`);
    // The redelivery is acked, never retried (the pre-check replays the stored response).
    expect(second.acks).toEqual([`outbox_${shipmentId}`]);
    expect(second.retries).toEqual([]);
  });

  it("posts no cost row for a shipment with a null matter_ref", async () => {
    const shipmentId = newIdentifier("shipment") as ShipmentId;
    await seedShipment(shipmentId, null);

    const { batch, acks, retries } = makeBatch(
      purchasedMessage(shipmentId, { postageCostMinor: 1299, serviceFeeMinor: 150 }),
    );
    await perFirmQueue(batch, env);

    expect(await costRowsForShipment(shipmentId)).toHaveLength(0);
    expect(acks).toEqual([`outbox_${shipmentId}`]);
    expect(retries).toEqual([]);
  });

  it("posts a second shipping_service_fee row when the firm's recovery policy is on", async () => {
    const shipmentId = newIdentifier("shipment") as ShipmentId;
    await seedShipment(shipmentId, matterId);
    // Turn the per-category platform-fee recovery policy on for this firm (canonical-JSON `true`).
    await env.DB_FIRM_POOL_1.prepare(
      "INSERT INTO setting (key, value, updated_at) VALUES (?1, 'true', ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
      .bind(SHIPPING_SERVICE_FEE_SETTING_KEY, TS)
      .run();

    try {
      const { batch, acks, retries } = makeBatch(
        purchasedMessage(shipmentId, { postageCostMinor: 1299, serviceFeeMinor: 150 }),
      );
      await perFirmQueue(batch, env);

      const rows = await costRowsForShipment(shipmentId);
      expect(rows).toHaveLength(2);
      expect(rows.map((r) => r.recovery_category)).toEqual(["postage", "shipping_service_fee"]);
      const serviceFee = rows.find((r) => r.recovery_category === "shipping_service_fee");
      expect(serviceFee).toMatchObject({
        recovery_ref: `${shipmentId}:shipping_service_fee`,
        disbursement_class: "hard",
        billable: 1,
        amount_minor: 150,
        source: "recovery",
      });
      expect(acks).toEqual([`outbox_${shipmentId}`]);
      expect(retries).toEqual([]);
    } finally {
      // Restore the default (off) so subsequent tests are order-independent.
      await env.DB_FIRM_POOL_1.prepare("DELETE FROM setting WHERE key = ?1")
        .bind(SHIPPING_SERVICE_FEE_SETTING_KEY)
        .run();
    }
  });

  it("acks and ignores an unknown topic without posting a cost row or throwing", async () => {
    const shipmentId = newIdentifier("shipment") as ShipmentId;
    await seedShipment(shipmentId, matterId);
    const message: PerFirmQueueMessage = {
      id: `outbox_${shipmentId}`,
      firmId,
      topic: "shipment.created",
      payload: JSON.stringify({ shipmentId }),
      aggregateKey: null,
      seq: null,
    };

    const { batch, acks, retries } = makeBatch(message);
    await expect(perFirmQueue(batch, env)).resolves.toBeUndefined();

    expect(await costRowsForShipment(shipmentId)).toHaveLength(0);
    expect(acks).toEqual([`outbox_${shipmentId}`]);
    expect(retries).toEqual([]);
  });
});
