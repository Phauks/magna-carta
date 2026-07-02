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
    stub.onAll("FROM outbox", [pendingRow("outbox_a"), pendingRow("outbox_b")]);
    const published: string[] = [];
    const report = await sweepOutbox({
      database: stub.database,
      publish: (row) => {
        published.push(row.id);
        return Promise.resolve();
      },
      now: NOW,
    });
    expect(published).toEqual(["outbox_a", "outbox_b"]);
    expect(report).toEqual({ dispatched: 2, failed: 0, deadLettered: 0 });
    const updates = stub.executed.filter((entry) => entry.sql.includes("'dispatched'"));
    expect(updates).toHaveLength(2);
    expect(updates[0]?.bindings).toEqual([NOW(), "outbox_a"]);
  });

  it("a publish failure leaves the row pending with attempts incremented; later rows still process", async () => {
    const stub = stubD1();
    stub.onAll("FROM outbox", [pendingRow("outbox_bad"), pendingRow("outbox_good")]);
    const report = await sweepOutbox({
      database: stub.database,
      publish: (row) =>
        row.id === "outbox_bad"
          ? Promise.reject(new Error("queue unavailable"))
          : Promise.resolve(),
      now: NOW,
    });
    expect(report).toEqual({ dispatched: 1, failed: 1, deadLettered: 0 });
    const attemptBump = stub.executed.find((entry) =>
      entry.sql.includes("attempts = attempts + 1"),
    );
    expect(attemptBump?.bindings).toEqual(["outbox_bad"]);
    expect(stub.executed.some((entry) => entry.sql.includes("'failed'"))).toBe(false);
  });

  it("reaching maxAttempts dead-letters exactly once and marks the row failed", async () => {
    const stub = stubD1();
    stub.onAll("FROM outbox", [pendingRow("outbox_dead", 4)]); // attempts=4, maxAttempts=5 -> this failure is final
    const deadLetter = vi.fn((_row: OutboxRow, _error: Error) => Promise.resolve());
    const report = await sweepOutbox({
      database: stub.database,
      publish: () => Promise.reject(new Error("still down")),
      deadLetter,
      maxAttempts: 5,
      now: NOW,
    });
    expect(report).toEqual({ dispatched: 0, failed: 1, deadLettered: 1 });
    expect(deadLetter).toHaveBeenCalledTimes(1);
    expect(deadLetter.mock.calls[0]?.[0]).toMatchObject({ id: "outbox_dead" });
    const failedUpdate = stub.executed.find((entry) => entry.sql.includes("'failed'"));
    expect(failedUpdate?.bindings).toEqual(["outbox_dead"]);
  });

  it("an empty sweep publishes nothing and returns zeros", async () => {
    const stub = stubD1();
    stub.onAll("FROM outbox", []);
    const publish = vi.fn(() => Promise.resolve());
    const report = await sweepOutbox({ database: stub.database, publish, now: NOW });
    expect(report).toEqual({ dispatched: 0, failed: 0, deadLettered: 0 });
    expect(publish).not.toHaveBeenCalled();
  });

  it("status updates are guarded: only a still-pending row can be marked (concurrent-sweep safety)", async () => {
    const stub = stubD1();
    stub.onAll("FROM outbox", [pendingRow("outbox_raced")]);
    await sweepOutbox({ database: stub.database, publish: () => Promise.resolve(), now: NOW });
    const dispatchUpdate = stub.executed.find((entry) => entry.sql.includes("'dispatched'"));
    // Without the guard, a concurrent sweep that already marked the row 'failed' would be silently
    // flipped back to 'dispatched' — a lost message.
    expect(dispatchUpdate?.sql).toContain("status = 'pending'");
  });

  it("a concurrently-claimed row is not double-counted as dispatched (zero changes)", async () => {
    const stub = stubD1();
    stub.onAll("FROM outbox", [pendingRow("outbox_claimed")]);
    stub.onRunChanges("'dispatched'", 0); // another sweep already marked it
    const report = await sweepOutbox({
      database: stub.database,
      publish: () => Promise.resolve(),
      now: NOW,
    });
    expect(report.dispatched).toBe(0);
  });

  it("dead-letters at most once: a zero-changes failed update means another sweep already did", async () => {
    const stub = stubD1();
    stub.onAll("FROM outbox", [pendingRow("outbox_dead", 4)]);
    stub.onRunChanges("'failed'", 0); // the concurrent sweep won the failed-update race
    const deadLetter = vi.fn((_row: OutboxRow, _error: Error) => Promise.resolve());
    const report = await sweepOutbox({
      database: stub.database,
      publish: () => Promise.reject(new Error("still down")),
      deadLetter,
      maxAttempts: 5,
      now: NOW,
    });
    expect(deadLetter).not.toHaveBeenCalled();
    expect(report.deadLettered).toBe(0);
  });

  it("respects batchSize in the select", async () => {
    const stub = stubD1();
    stub.onAll("FROM outbox", []);
    await sweepOutbox({
      database: stub.database,
      publish: () => Promise.resolve(),
      batchSize: 7,
      now: NOW,
    });
    const select = stub.executed.find((entry) => entry.sql.includes("FROM outbox"));
    expect(select?.bindings).toEqual([7]);
  });
});
