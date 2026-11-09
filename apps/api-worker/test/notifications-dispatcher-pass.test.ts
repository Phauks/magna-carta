import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FirmId, MatterId, UserId } from "@magna-carta/identifiers/types";
import { MATTER_CLOSED_TOPIC } from "@magna-carta/matters/topics";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import {
  perFirmQueue,
  type PerFirmQueueMessage,
} from "../src/background/costs/recoverable-charge-consumer.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";

// The SECOND, NON-EXCLUSIVE PASS on the per-firm bus, driven through the real queue consumer with a
// synthetic batch (Miniflare cannot deliver a real relay send).
//
// The properties under test are all about not breaking the bus for everybody else: an unrecognized
// topic stays acked, a topic with no owning handler still reaches the translator, and nothing the
// translator does can dead-letter a message.

const TS = "2026-08-07T02:00:00.000Z";
const RESPONSIBLE = "user_notifdispatch01" as UserId;

let firmId: FirmId;
let matterId: MatterId;
let firmDatabase: ReturnType<typeof firmDatabaseFor>;

// The retry case needs a database it can BREAK, so it gets its own firm rather than vandalizing the
// one every other test in this file reads. A per-firm Durable Object per firm id makes that free.
let brokenFirmId: FirmId;
let brokenMatterId: MatterId;

let acked: number;
let retried: number;

function batchOf(messages: PerFirmQueueMessage[]): MessageBatch<PerFirmQueueMessage> {
  return {
    queue: "per-firm",
    messages: messages.map((body, index) => ({
      id: `message-${index}`,
      timestamp: new Date(TS),
      body,
      attempts: 1,
      ack: () => {
        acked++;
      },
      retry: () => {
        retried++;
      },
    })),
    ackAll: () => undefined,
    retryAll: () => undefined,
  } as unknown as MessageBatch<PerFirmQueueMessage>;
}

function message(overrides: Partial<PerFirmQueueMessage>): PerFirmQueueMessage {
  return {
    id: newIdentifier("outbox"),
    firmId,
    topic: MATTER_CLOSED_TOPIC,
    payload: JSON.stringify({ matterId }),
    aggregateKey: null,
    seq: null,
    ...overrides,
  };
}

async function notificationCount(): Promise<number> {
  const { results } = await firmDatabase
    .prepare("SELECT COUNT(*) AS count FROM notification_event")
    .all<{ count: number }>();
  return results[0]?.count ?? 0;
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  firmId = newIdentifier("firm");
  firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, firmId);
  await env.DB_CONTROL.prepare(
    "INSERT INTO firm (id, name, bucket_name, status, created_at) VALUES (?1, ?2, ?3, 'active', ?4)",
  )
    .bind(firmId, "Notification Dispatch Firm", "notification-dispatch-bucket", TS)
    .run();

  await firmDatabase
    .prepare(
      "INSERT INTO member (user_id, display_name, status, opted_out_of_usage_analytics, created_at) VALUES (?1, ?2, 'active', 0, ?3)",
    )
    .bind(RESPONSIBLE, "Responsible Member", TS)
    .run();
  matterId = newIdentifier("matter");
  await firmDatabase
    .prepare(
      "INSERT INTO matter (id, title, status, responsible_member_id, e_billing, created_at, updated_at) VALUES (?1, ?2, 'open', ?3, 0, ?4, ?4)",
    )
    .bind(matterId, "Dispatch Matter", RESPONSIBLE, TS)
    .run();

  // The second firm, seeded identically and then deliberately broken by the retry test.
  brokenFirmId = newIdentifier("firm");
  const brokenDatabase = firmDatabaseFor(env.FIRM_DATABASE, brokenFirmId);
  await env.DB_CONTROL.prepare(
    "INSERT INTO firm (id, name, bucket_name, status, created_at) VALUES (?1, ?2, ?3, 'active', ?4)",
  )
    .bind(brokenFirmId, "Notification Dispatch Broken Firm", "notification-broken-bucket", TS)
    .run();
  await brokenDatabase
    .prepare(
      "INSERT INTO member (user_id, display_name, status, opted_out_of_usage_analytics, created_at) VALUES (?1, ?2, 'active', 0, ?3)",
    )
    .bind(RESPONSIBLE, "Responsible Member", TS)
    .run();
  brokenMatterId = newIdentifier("matter");
  await brokenDatabase
    .prepare(
      "INSERT INTO matter (id, title, status, responsible_member_id, e_billing, created_at, updated_at) VALUES (?1, ?2, 'open', ?3, 0, ?4, ?4)",
    )
    .bind(brokenMatterId, "Broken Dispatch Matter", RESPONSIBLE, TS)
    .run();
});

describe("the notification pass on the per-firm bus", () => {
  it("materializes from a topic that has NO owning handler", async () => {
    // matter.closed is on the bus and nothing in the dispatch table owns it. Before this pass, the
    // consumer counted it as an unhandled topic and moved on; now the translator sees it.
    acked = 0;
    retried = 0;
    const before = await notificationCount();
    await perFirmQueue(batchOf([message({})]), env);
    expect(acked).toBe(1);
    expect(retried).toBe(0);
    expect(await notificationCount()).toBe(before + 1);
  });

  it("acks and ignores a topic nothing subscribes to", async () => {
    // The ordinary case for most of the thirty topics the relay sweeps onto this one queue. It must
    // never throw: throwing would dead-letter or retry-storm a message nobody handles.
    acked = 0;
    retried = 0;
    const before = await notificationCount();
    await perFirmQueue(
      batchOf([
        message({ topic: "shipment.created", payload: JSON.stringify({ shipmentId: "x" }) }),
      ]),
      env,
    );
    expect(acked).toBe(1);
    expect(retried).toBe(0);
    expect(await notificationCount()).toBe(before);
  });

  it("acks rather than retries when the translator cannot make sense of a message", async () => {
    // A payload that will not parse is PERMANENTLY unprocessable: retrying can never make it valid,
    // and marching a permanent error to the dead-letter queue helps nobody. This is the case that
    // must ack even though no owning handler ran.
    acked = 0;
    retried = 0;
    const before = await notificationCount();
    await perFirmQueue(batchOf([message({ payload: "{not json" })]), env);
    expect(acked).toBe(1);
    expect(retried).toBe(0);
    expect(await notificationCount()).toBe(before);
  });

  it("RETRIES a transient translator fault when no owning handler committed for the message", async () => {
    // matter.closed has no owning handler, so nothing else committed for this message and a retry
    // costs exactly one redelivery — which buys back a notification a passing database fault would
    // otherwise have dropped silently. It cannot duplicate anything: the retry re-derives the same
    // dedupe key and the UNIQUE constraint makes the second attempt a no-op.
    //
    // The fault is simulated by removing a table the write needs, in a firm of this test's own, so
    // the database genuinely rejects the batch rather than the test mocking the rejection.
    const brokenDatabase = firmDatabaseFor(env.FIRM_DATABASE, brokenFirmId);
    await brokenDatabase.prepare("DROP TABLE notification_recipient").run();
    acked = 0;
    retried = 0;
    await perFirmQueue(
      batchOf([
        message({ firmId: brokenFirmId, payload: JSON.stringify({ matterId: brokenMatterId }) }),
      ]),
      env,
    );
    expect(retried).toBe(1);
    expect(acked).toBe(0);
  });

  it("acks when a subscribed topic names a matter that does not exist", async () => {
    acked = 0;
    retried = 0;
    const before = await notificationCount();
    await perFirmQueue(
      batchOf([message({ payload: JSON.stringify({ matterId: newIdentifier("matter") }) })]),
      env,
    );
    expect(acked).toBe(1);
    expect(retried).toBe(0);
    // No responsible member resolves, so no feed row and no event — an event nobody can see is a
    // row only the retention sweep would ever touch.
    expect(await notificationCount()).toBe(before);
  });

  it("writes exactly one event however many times the message is redelivered", async () => {
    acked = 0;
    const redelivered = message({});
    const before = await notificationCount();
    for (let attempt = 0; attempt < 3; attempt++) {
      await perFirmQueue(batchOf([redelivered]), env);
    }
    expect(acked).toBe(3);
    expect(await notificationCount()).toBe(before + 1);
  });
});
