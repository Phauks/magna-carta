import { describe, expect, it, vi } from "vitest";
import { sweepOutbox, type OutboxRow } from "../src/outbox-relay.ts";
import { stubD1 } from "./support/stub-d1.ts";

const NOW = () => "2026-06-09T00:00:00.000Z";

function pendingRow(id: string, attempts = 0): OutboxRow {
  return {
    id,
    topic: "payment.capture",
    payload: '{"x":1}',
    aggregate_key: null,
    seq: null,
    attempts,
  };
}

describe("sweepOutbox", () => {
  it("publishes every pending row, then marks it dispatched (publish-first = at-least-once)", async () => {
    const stub = stubD1();
    stub.onAll("FROM outbox", [pendingRow("obx_a"), pendingRow("obx_b")]);
    const published: string[] = [];
    const report = await sweepOutbox({
      database: stub.database,
      publish: (row) => {
        published.push(row.id);
        return Promise.resolve();
      },
      now: NOW,
    });
    expect(published).toEqual(["obx_a", "obx_b"]);
    expect(report).toEqual({ dispatched: 2, failed: 0, deadLettered: 0 });
    const updates = stub.executed.filter((entry) => entry.sql.includes("'dispatched'"));
    expect(updates).toHaveLength(2);
    expect(updates[0]?.bindings).toEqual([NOW(), "obx_a"]);
  });

  it("a publish failure leaves the row pending with attempts incremented; later rows still process", async () => {
    const stub = stubD1();
    stub.onAll("FROM outbox", [pendingRow("obx_bad"), pendingRow("obx_good")]);
    const report = await sweepOutbox({
      database: stub.database,
      publish: (row) =>
        row.id === "obx_bad" ? Promise.reject(new Error("queue unavailable")) : Promise.resolve(),
      now: NOW,
    });
    expect(report).toEqual({ dispatched: 1, failed: 1, deadLettered: 0 });
    const attemptBump = stub.executed.find((entry) => entry.sql.includes("attempts = attempts + 1"));
    expect(attemptBump?.bindings).toEqual(["obx_bad"]);
    expect(stub.executed.some((entry) => entry.sql.includes("'failed'"))).toBe(false);
  });

  it("reaching maxAttempts dead-letters exactly once and marks the row failed", async () => {
    const stub = stubD1();
    stub.onAll("FROM outbox", [pendingRow("obx_dead", 4)]); // attempts=4, maxAttempts=5 -> this failure is final
    const deadLetter = vi.fn(() => Promise.resolve());
    const report = await sweepOutbox({
      database: stub.database,
      publish: () => Promise.reject(new Error("still down")),
      deadLetter,
      maxAttempts: 5,
      now: NOW,
    });
    expect(report).toEqual({ dispatched: 0, failed: 1, deadLettered: 1 });
    expect(deadLetter).toHaveBeenCalledTimes(1);
    expect(deadLetter.mock.calls[0]?.[0]).toMatchObject({ id: "obx_dead" });
    const failedUpdate = stub.executed.find((entry) => entry.sql.includes("'failed'"));
    expect(failedUpdate?.bindings).toEqual(["obx_dead"]);
  });

  it("an empty sweep publishes nothing and returns zeros", async () => {
    const stub = stubD1();
    stub.onAll("FROM outbox", []);
    const publish = vi.fn(() => Promise.resolve());
    const report = await sweepOutbox({ database: stub.database, publish, now: NOW });
    expect(report).toEqual({ dispatched: 0, failed: 0, deadLettered: 0 });
    expect(publish).not.toHaveBeenCalled();
  });

  it("respects batchSize in the select", async () => {
    const stub = stubD1();
    stub.onAll("FROM outbox", []);
    await sweepOutbox({ database: stub.database, publish: () => Promise.resolve(), batchSize: 7, now: NOW });
    const select = stub.executed.find((entry) => entry.sql.includes("FROM outbox"));
    expect(select?.bindings).toEqual([7]);
  });
});
