import { describe, expect, it, vi } from "vitest";
import { runIdempotentEffect } from "../src/run-idempotent-effect.ts";
import { stubD1 } from "./support/stub-d1.ts";

const FINGERPRINT = "f".repeat(64);
const NOW = () => "2026-06-09T00:00:00.000Z";

function effectReturning(code: number, body: string) {
  return vi.fn(async (database: ReturnType<typeof stubD1>["database"]) => ({
    write: {
      statements: [database.prepare("UPDATE ledger SET balance_minor = 100")],
      outboxMessages: [{ topic: "payment.capture", payload: { id: "x" } }],
    },
    responseCode: code,
    responseBody: body,
  }));
}

describe("runIdempotentEffect", () => {
  it("fresh key: executes, commits one batch containing the completed record, returns executed", async () => {
    const stub = stubD1();
    stub.onAll("FROM idempotency_key", []); // pre-check: no record
    const effect = effectReturning(201, '{"id":"inv_x"}');
    const result = await runIdempotentEffect({
      database: stub.database,
      key: "client-key-1",
      fingerprint: FINGERPRINT,
      effect: () => effect(stub.database),
      now: NOW,
    });
    expect(result).toEqual({ kind: "executed", responseCode: 201, responseBody: '{"id":"inv_x"}' });
    expect(effect).toHaveBeenCalledTimes(1);
    expect(stub.batches).toHaveLength(1);
    const sqls = (stub.batches[0] ?? []).map((statement) => statement.sql);
    expect(sqls[0]).toContain("INSERT INTO idempotency_key");
    expect(sqls.some((sql) => sql.includes("UPDATE ledger"))).toBe(true);
    expect(sqls.some((sql) => sql.includes("INSERT INTO outbox"))).toBe(true);
  });

  it("pre-check replay short-circuits: the effect never runs, the stored failure replays as-is", async () => {
    const stub = stubD1();
    stub.onAll("FROM idempotency_key", [
      {
        key: "client-key-1",
        fingerprint: FINGERPRINT,
        status: "completed",
        response_code: 500,
        response_body: '{"error":"stored failure"}',
      },
    ]);
    const effect = effectReturning(201, "{}");
    const result = await runIdempotentEffect({
      database: stub.database,
      key: "client-key-1",
      fingerprint: FINGERPRINT,
      effect: () => effect(stub.database),
      now: NOW,
    });
    expect(result).toEqual({
      kind: "replayed",
      responseCode: 500,
      responseBody: '{"error":"stored failure"}',
    });
    expect(effect).not.toHaveBeenCalled();
    expect(stub.batches).toHaveLength(0);
  });

  it("pre-check in_progress -> in-progress; different fingerprint -> fingerprint-mismatch", async () => {
    const stub = stubD1();
    stub.onAll("FROM idempotency_key", [
      {
        key: "client-key-1",
        fingerprint: FINGERPRINT,
        status: "in_progress",
        response_code: null,
        response_body: null,
      },
    ]);
    const base = {
      database: stub.database,
      key: "client-key-1",
      effect: () => effectReturning(201, "{}")(stub.database),
      now: NOW,
    };
    expect(await runIdempotentEffect({ ...base, fingerprint: FINGERPRINT })).toEqual({
      kind: "in-progress",
    });
    expect(await runIdempotentEffect({ ...base, fingerprint: "0".repeat(64) })).toEqual({
      kind: "fingerprint-mismatch",
    });
  });

  it("concurrent-duplicate race: the loser's batch rolls back and the winner's response replays", async () => {
    const stub = stubD1();
    const winnerRecord = {
      key: "client-key-1",
      fingerprint: FINGERPRINT,
      status: "completed",
      response_code: 201,
      response_body: '{"id":"inv_winner"}',
    };
    // Pre-check sees nothing (we lost the race after the SELECT); the batch then hits UNIQUE;
    // the re-read returns the winner's record.
    let preCheckCalls = 0;
    stub.onAll("FROM idempotency_key", () => (++preCheckCalls === 1 ? [] : [winnerRecord]));
    stub.failBatchWith(new Error("D1_ERROR: UNIQUE constraint failed: idempotency_key.key"));
    const effect = effectReturning(201, '{"id":"inv_loser"}');
    const result = await runIdempotentEffect({
      database: stub.database,
      key: "client-key-1",
      fingerprint: FINGERPRINT,
      effect: () => effect(stub.database),
      now: NOW,
    });
    expect(result).toEqual({
      kind: "replayed",
      responseCode: 201,
      responseBody: '{"id":"inv_winner"}',
    });
    expect(effect).toHaveBeenCalledTimes(1); // ran speculatively, committed nothing
    expect(stub.batches).toHaveLength(0); // the failed batch recorded nothing
  });

  it("a non-conflict batch error propagates un-swallowed", async () => {
    const stub = stubD1();
    stub.onAll("FROM idempotency_key", []);
    stub.failBatchWith(new Error("D1_ERROR: no such table: ledger"));
    await expect(
      runIdempotentEffect({
        database: stub.database,
        key: "client-key-1",
        fingerprint: FINGERPRINT,
        effect: () => effectReturning(201, "{}")(stub.database),
        now: NOW,
      }),
    ).rejects.toThrow(/no such table/);
  });

  it("a thrown effect propagates with nothing committed and no record — same-key retry re-executes", async () => {
    const stub = stubD1();
    stub.onAll("FROM idempotency_key", []);
    const explosion = new Error("handler exploded");
    await expect(
      runIdempotentEffect({
        database: stub.database,
        key: "client-key-1",
        fingerprint: FINGERPRINT,
        effect: () => Promise.reject(explosion),
        now: NOW,
      }),
    ).rejects.toBe(explosion);
    expect(stub.batches).toHaveLength(0); // nothing committed, no record stored
    // The retry re-executes (there is no stored failure to replay — none was produced).
    const retry = await runIdempotentEffect({
      database: stub.database,
      key: "client-key-1",
      fingerprint: FINGERPRINT,
      effect: () => effectReturning(201, "{}")(stub.database),
      now: NOW,
    });
    expect(retry.kind).toBe("executed");
  });

  it("no key (optional route without header): executes with NO idempotency SQL at all", async () => {
    const stub = stubD1();
    const effect = effectReturning(200, "{}");
    const result = await runIdempotentEffect({
      database: stub.database,
      key: undefined,
      fingerprint: FINGERPRINT,
      effect: () => effect(stub.database),
      now: NOW,
    });
    expect(result.kind).toBe("executed");
    expect(stub.executed.some((entry) => entry.sql.includes("idempotency_key"))).toBe(false);
  });
});
