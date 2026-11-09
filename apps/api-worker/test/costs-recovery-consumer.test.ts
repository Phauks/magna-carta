import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FirmId, MatterId, ShipmentId, UserId } from "@magna-carta/identifiers/types";
import {
  firmDatabaseFor as resolveFirmDatabaseProxy,
  type ProxyBatchDatabase,
} from "../src/firm-database/firm-database-proxy.ts";
import {
  perFirmQueue,
  type PerFirmQueueMessage,
} from "../src/background/costs/recoverable-charge-consumer.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";

// The first per-firm queue consumer over real Miniflare bindings: a synthetic per-firm queue message
// (Miniflare cannot deliver real relay sends) for a shipment.purchased outbox row drives the producer
// adapter + the recoverable-charge mapping to one or more matter disbursements. The consumer is
// invoked directly with a fake MessageBatch, exactly as production's queue() branch would route it.

const SHIPPING_SERVICE_FEE_SETTING_KEY = "cost.recover_platform_fee.shipping_service_fee";
const TS = "2026-06-26T12:00:00.000Z";

let firmId: FirmId;
let matterId: MatterId;
const ACTOR = "user_costrecovery" as UserId;

// The firm's per-firm database handle plus a `.first()` convenience over the proxy's `.all()` — the
// proxy mirrors the SqlDatabase the statement modules use (run/all), and these tests read single rows.
// The wrapper carries sql/bindings forward so a wrapped statement still flows correctly through
// commitEffectBatch's batch() (which reads s.sql/s.bindings off each statement).
type ProxyStatement = ReturnType<ProxyBatchDatabase["prepare"]>;
interface FirstStatement {
  readonly sql: string;
  readonly bindings: readonly unknown[];
  bind(...values: unknown[]): FirstStatement;
  run(): Promise<{ meta: { changes: number } }>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
}
function firmDatabaseFor(id: FirmId): { prepare(sql: string): FirstStatement; batch: ProxyBatch } {
  const proxy = resolveFirmDatabaseProxy(env.FIRM_DATABASE, id);
  const wrap = (statement: ProxyStatement): FirstStatement => ({
    sql: statement.sql,
    bindings: statement.bindings,
    bind: (...values: unknown[]) => wrap(statement.bind(...values)),
    run: () => statement.run(),
    all: <T>() => statement.all<T>(),
    first: async <T>() => ((await statement.all<T>()).results[0] ?? null) as T | null,
  });
  return {
    prepare: (sql: string) => wrap(proxy.prepare(sql)),
    batch: proxy.batch.bind(proxy),
  };
}
type ProxyBatch = ProxyBatchDatabase["batch"];
let firmDatabase: ReturnType<typeof firmDatabaseFor>;

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  firmId = newIdentifier("firm");
  firmDatabase = firmDatabaseFor(firmId);
  // The control-plane firm row. firmId addresses the firm's FirmDatabase Durable Object directly; the
  // DO self-migrates the per-firm lineage on first access, so no database_identifier is recorded — the
  // consumer resolves firmId → DO without the old database_identifier hop.
  await env.DB_CONTROL.prepare(
    "INSERT INTO firm (id, name, bucket_name, status, created_at) VALUES (?1, ?2, ?3, 'active', ?4)",
  )
    .bind(firmId, "Cost Recovery Test Firm", "cost-recovery-test-bucket", TS)
    .run();
  await firmDatabase
    .prepare(
      "INSERT INTO member (user_id, display_name, status, created_at) VALUES (?1, 'Cost Recovery Actor', 'active', ?2)",
    )
    .bind(ACTOR, TS)
    .run();
  matterId = newIdentifier("matter");
  await firmDatabase
    .prepare(
      "INSERT INTO matter (id, title, status, responsible_member_id, created_at, updated_at) VALUES (?1, 'Cost Recovery Matter', 'open', ?2, ?3, ?3)",
    )
    .bind(matterId, ACTOR, TS)
    .run();
});

// Seeds a purchased shipment row. The adapter reads only matter_ref back from it (the amounts ride
// the queue payload), but the row carries the NOT-NULL columns so the insert is valid.
async function seedShipment(shipmentId: string, matterRef: string | null): Promise<void> {
  await firmDatabase
    .prepare(
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
  const { results } = await firmDatabase
    .prepare(
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
    await firmDatabase
      .prepare(
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
      await firmDatabase
        .prepare("DELETE FROM setting WHERE key = ?1")
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

  it("acks and posts no cost row when the firm has no control-plane row (unresolvable firm)", async () => {
    // A firmId with no firm row: the two-hop resolution finds no database_identifier, so the dispatcher
    // returns without work. A retry cannot make the firm exist, so the message is acked, not retried.
    const unknownFirmId = newIdentifier("firm");
    const shipmentId = newIdentifier("shipment") as ShipmentId;
    const message: PerFirmQueueMessage = {
      id: `outbox_${shipmentId}`,
      firmId: unknownFirmId,
      topic: "shipment.purchased",
      payload: JSON.stringify({
        shipmentId,
        postageCostMinor: 1299,
        serviceFeeMinor: 150,
        currency: "USD",
      }),
      aggregateKey: null,
      seq: null,
    };

    const { batch, acks, retries } = makeBatch(message);
    await expect(perFirmQueue(batch, env)).resolves.toBeUndefined();

    expect(await costRowsForShipment(shipmentId)).toHaveLength(0);
    expect(acks).toEqual([`outbox_${shipmentId}`]);
    expect(retries).toEqual([]);
  });

  it("ack-drops a shipment.purchased whose shipment row is absent (no cost row, no throw)", async () => {
    // No seedShipment: the producer adapter reads no shipment row back and returns null, so the handler
    // drops the message rather than retry a row that will never appear.
    const shipmentId = newIdentifier("shipment") as ShipmentId;

    const { batch, acks, retries } = makeBatch(
      purchasedMessage(shipmentId, { postageCostMinor: 1299, serviceFeeMinor: 150 }),
    );
    await expect(perFirmQueue(batch, env)).resolves.toBeUndefined();

    expect(await costRowsForShipment(shipmentId)).toHaveLength(0);
    expect(acks).toEqual([`outbox_${shipmentId}`]);
    expect(retries).toEqual([]);
  });

  it("ack-drops a malformed shipment.purchased payload (unparseable or fractional amount), posting no cost row", async () => {
    // parseShipmentPurchasedPayload returns null for a payload that will not parse or whose shape is
    // structurally invalid (a fractional minor amount is a producer bug, never a transient fault). The
    // handler ack-drops it with the costs.recovery.malformed_payload counter rather than retry-storm a
    // permanent error toward the dead-letter queue.

    // (1) Unparseable payload — there is no shipment id to query, so assert the terminal disposition.
    const notJson = makeBatch({
      id: "outbox_notjson",
      firmId,
      topic: "shipment.purchased",
      payload: "not json",
      aggregateKey: null,
      seq: null,
    });
    await expect(perFirmQueue(notJson.batch, env)).resolves.toBeUndefined();
    expect(notJson.acks).toEqual(["outbox_notjson"]);
    expect(notJson.retries).toEqual([]);

    // (2) Well-formed JSON but a fractional postageCostMinor (integer-minor money is mandatory).
    const shipmentId = newIdentifier("shipment") as ShipmentId;
    await seedShipment(shipmentId, matterId);
    const fractional = makeBatch({
      id: `outbox_${shipmentId}`,
      firmId,
      topic: "shipment.purchased",
      payload: JSON.stringify({
        shipmentId,
        postageCostMinor: 12.5,
        serviceFeeMinor: 150,
        currency: "USD",
      }),
      aggregateKey: null,
      seq: null,
    });
    await perFirmQueue(fractional.batch, env);
    expect(await costRowsForShipment(shipmentId)).toHaveLength(0);
    expect(fractional.acks).toEqual([`outbox_${shipmentId}`]);
    expect(fractional.retries).toEqual([]);
  });

  it("acks a fingerprint-drift redelivery (producer re-emit with a changed amount), leaving the original row unchanged", async () => {
    // The producer re-emits the SAME line (same recoveryRef) with a DIFFERENT amount. The per-line
    // recoveryRef idempotency key still hits, but the stored fingerprint differs, so runIdempotentEffect
    // returns fingerprint-mismatch: the already-stored line stands, nothing overwrites it, and the message
    // is acked normally (re-applying an already-posted line is not a transient fault to retry).
    const shipmentId = newIdentifier("shipment") as ShipmentId;
    await seedShipment(shipmentId, matterId);

    await perFirmQueue(
      makeBatch(purchasedMessage(shipmentId, { postageCostMinor: 1299, serviceFeeMinor: 150 }))
        .batch,
      env,
    );

    const redelivery = makeBatch(
      purchasedMessage(shipmentId, { postageCostMinor: 1500, serviceFeeMinor: 150 }),
    );
    await perFirmQueue(redelivery.batch, env);

    const rows = await costRowsForShipment(shipmentId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.recovery_ref).toBe(`${shipmentId}:postage`);
    // Unchanged — the drifted re-emit did not overwrite the originally-posted amount.
    expect(rows[0]?.amount_minor).toBe(1299);
    expect(redelivery.acks).toEqual([`outbox_${shipmentId}`]);
    expect(redelivery.retries).toEqual([]);
  });

  it("redelivery after a partial commit posts the missing line without duplicating the first (the partial-commit invariant)", async () => {
    // The strong form — injecting a transient fault on the SECOND line only — cannot be done without
    // contorting the consumer's internals (both lines write the same table via the same path, so there is
    // no clean per-line fault seam). Instead this asserts the weaker-but-real redelivery property the
    // reviewers flagged: the first pass posts line 1 (postage) but NOT line 2 (service fee), and a
    // redelivery posts line 2 while line 1 is replayed via its idempotency key, never duplicated — exactly
    // the path a real "line 1 committed, line 2 threw a transient, message retried" sequence takes. Here the
    // per-category recovery policy stands in for the fault: OFF on the first pass (so the service-fee line is
    // absent) and ON for the redelivery (so it posts).
    const shipmentId = newIdentifier("shipment") as ShipmentId;
    await seedShipment(shipmentId, matterId);

    // First pass: policy off → only the postage line (line 1) posts.
    await perFirmQueue(
      makeBatch(purchasedMessage(shipmentId, { postageCostMinor: 1299, serviceFeeMinor: 150 }))
        .batch,
      env,
    );
    expect(await costRowsForShipment(shipmentId)).toHaveLength(1);

    // Turn the per-category platform-fee recovery policy on, then redeliver the identical message.
    await firmDatabase
      .prepare(
        "INSERT INTO setting (key, value, updated_at) VALUES (?1, 'true', ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      )
      .bind(SHIPPING_SERVICE_FEE_SETTING_KEY, TS)
      .run();

    try {
      const redelivery = makeBatch(
        purchasedMessage(shipmentId, { postageCostMinor: 1299, serviceFeeMinor: 150 }),
      );
      await perFirmQueue(redelivery.batch, env);

      const rows = await costRowsForShipment(shipmentId);
      // Both lines now exist exactly once: postage (replayed, not duplicated) + service fee (freshly posted).
      expect(rows).toHaveLength(2);
      expect(rows.map((r) => r.recovery_category)).toEqual(["postage", "shipping_service_fee"]);
      const postage = rows.find((r) => r.recovery_category === "postage");
      expect(postage?.amount_minor).toBe(1299);
      expect(redelivery.acks).toEqual([`outbox_${shipmentId}`]);
      expect(redelivery.retries).toEqual([]);
    } finally {
      await firmDatabase
        .prepare("DELETE FROM setting WHERE key = ?1")
        .bind(SHIPPING_SERVICE_FEE_SETTING_KEY)
        .run();
    }
  });

  it("captures the postage recovery on an e-billing matter as uncoded WIP, never dropping it", async () => {
    // The regression guard for the e-billing exemption: a system-recovered cost has no human at capture
    // time to supply a UTBMS code, so it must land as uncoded draft WIP rather than be dropped (which
    // would silently lose the fronted disbursement). Coding is re-enforced later at the submit/bill gate.
    const eBillingMatterId = newIdentifier("matter") as MatterId;
    await firmDatabase
      .prepare(
        "INSERT INTO matter (id, title, status, responsible_member_id, e_billing, created_at, updated_at) VALUES (?1, 'E-Billing Matter', 'open', ?2, 1, ?3, ?3)",
      )
      .bind(eBillingMatterId, ACTOR, TS)
      .run();
    const shipmentId = newIdentifier("shipment") as ShipmentId;
    await seedShipment(shipmentId, eBillingMatterId);

    const { batch, acks, retries } = makeBatch(
      purchasedMessage(shipmentId, { postageCostMinor: 1299, serviceFeeMinor: 150 }),
    );
    await perFirmQueue(batch, env);

    const { results } = await firmDatabase
      .prepare(
        "SELECT recovery_ref, amount_minor, utbms_expense_code_id, source FROM cost_entry WHERE recovery_ref = ?1",
      )
      .bind(`${shipmentId}:postage`)
      .all<{
        recovery_ref: string;
        amount_minor: number;
        utbms_expense_code_id: string | null;
        source: string;
      }>();
    expect(results).toHaveLength(1);
    expect(results[0]?.utbms_expense_code_id).toBeNull();
    expect(results[0]?.amount_minor).toBe(1299);
    expect(results[0]?.source).toBe("recovery");
    expect(acks).toEqual([`outbox_${shipmentId}`]);
    expect(retries).toEqual([]);
  });

  // The transient-fault test was dropped: it injected the fault via a firm whose database_identifier
  // pointed at a bound-but-unmigrated pool member, and the FirmDatabase Durable Object model removed
  // that injection seam (no pool bindings; the DO self-migrates on first access, so there is no
  // "unmigrated bound DB"). The partial-commit-redelivery test above already covers the idempotency
  // invariant that mattered, and the consumer's transient-rethrow→retry branch is unchanged.
});
