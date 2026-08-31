import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
  insertCompletedIdempotencyRecordStatement,
  isIdempotencyKeyConflict,
  purgeExpiredIdempotencyRecordsStatement,
  selectIdempotencyRecordStatement,
} from "@magna-carta/data-access/idempotency-statements";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import type { IdempotencyRecordId } from "@magna-carta/identifiers/types";
import { firmDatabaseFor } from "../../src/firm-database/firm-database-proxy.ts";

const record = (key: string) => ({
  id: `idk_${key}` as IdempotencyRecordId,
  key,
  fingerprint: "fp",
  responseCode: 200,
  responseBody: null,
  createdAt: "2026-06-23T00:00:00.000Z",
});

function proxyFor(name: string) {
  return firmDatabaseFor(env.FIRM_DATABASE, name);
}

describe("firmDatabaseProxy", () => {
  it("runs an unmodified statement module with faithful meta.changes", async () => {
    const database = proxyFor("firm_proxy_changes");
    expect(
      (await insertCompletedIdempotencyRecordStatement(database, record("k")).run()).meta.changes,
    ).toBe(1);
    const found = await selectIdempotencyRecordStatement(database, "k").all<{ key: string }>();
    expect(found.results[0]?.key).toBe("k");
    expect(
      (await purgeExpiredIdempotencyRecordsStatement(database, "2000-01-01T00:00:00.000Z").run())
        .meta.changes,
    ).toBe(0);
    expect(
      (await purgeExpiredIdempotencyRecordsStatement(database, "2100-01-01T00:00:00.000Z").run())
        .meta.changes,
    ).toBe(1);
  });

  it("re-throws a UNIQUE conflict so isIdempotencyKeyConflict matches and rolls back", async () => {
    const database = proxyFor("firm_proxy_conflict");
    let caught: unknown;
    try {
      await commitEffectBatch(
        database,
        {
          statements: [
            insertCompletedIdempotencyRecordStatement(database, record("dupe")),
            insertCompletedIdempotencyRecordStatement(database, record("dupe")),
          ],
          outboxMessages: [],
        },
        { now: () => "2026-06-23T00:00:00.000Z" },
      );
    } catch (error) {
      caught = error;
    }
    expect(isIdempotencyKeyConflict(caught)).toBe(true);
    expect((await selectIdempotencyRecordStatement(database, "dupe").all()).results).toHaveLength(
      0,
    );
  });

  it("addresses the DO under the eu jurisdiction when given one", () => {
    const seen: string[] = [];
    const euSub = {
      idFromName: (name: string) => ({ name, jurisdiction: "eu" }) as unknown as DurableObjectId,
      get: (id: unknown) => ({ id }),
    };
    const namespace = {
      idFromName: (name: string) => ({ name }) as unknown as DurableObjectId,
      get: (id: unknown) => ({ id }),
      jurisdiction: (j: string) => {
        seen.push(j);
        return euSub;
      },
    };
    firmDatabaseFor(namespace as never, "firm_1", "eu");
    expect(seen).toEqual(["eu"]);
  });

  it("uses the bare namespace when no jurisdiction is given (unchanged for us firms)", () => {
    const namespace = {
      idFromName: (name: string) => ({ name }) as unknown as DurableObjectId,
      get: (id: unknown) => ({ id }),
      jurisdiction: () => {
        throw new Error("must not be called");
      },
    };
    expect(() => firmDatabaseFor(namespace as never, "firm_1")).not.toThrow();
  });
});

// A Durable Object RPC failure the runtime marks `retryable` (an object reset — every deploy — or a
// dropped connection) must be re-sent for a READ, and re-sent against a FRESH stub: a broken RPC
// stub stays broken, so retrying on the same one would fail the same way forever. Everything else —
// a deterministic error, an overloaded object, a write — must surface immediately.
describe("firmDatabaseProxy transient-failure retry", () => {
  // A namespace whose stubs answer runRead/runWrite from the given script, one stub per get().
  // Each entry is one stub's behavior; `getCalls` counts how many stubs were handed out.
  function scriptedNamespace(script: Array<() => Promise<{ results: unknown[] }>>) {
    let stubIndex = -1;
    const counters = { getCalls: 0, readCalls: 0, writeCalls: 0 };
    const namespace = {
      idFromName: (name: string) => ({ name }) as unknown as DurableObjectId,
      get: () => {
        counters.getCalls += 1;
        stubIndex += 1;
        const behave = script[Math.min(stubIndex, script.length - 1)];
        if (behave === undefined) throw new Error("scripted namespace exhausted");
        return {
          runRead: () => {
            counters.readCalls += 1;
            return behave();
          },
          runWrite: async () => {
            counters.writeCalls += 1;
            await behave();
            return { changes: 1 };
          },
        };
      },
    };
    return { namespace, counters };
  }

  function transientFailure(overloaded = false): () => Promise<never> {
    return () =>
      Promise.reject(
        Object.assign(new Error("Durable Object reset because its code was updated."), {
          retryable: true,
          ...(overloaded ? { overloaded: true } : {}),
        }),
      );
  }

  it("re-sends a read that failed with a retryable error, on a fresh stub, and answers the rows", async () => {
    const { namespace, counters } = scriptedNamespace([
      transientFailure(),
      () => Promise.resolve({ results: [{ answer: 42 }] }),
    ]);
    const database = firmDatabaseFor(namespace as never, "firm_retry_read");
    const { results } = await database.prepare("SELECT 1").all<{ answer: number }>();
    expect(results).toEqual([{ answer: 42 }]);
    // Two stubs: the one the proxy was built over (which failed) and the fresh one the retry took.
    expect(counters.getCalls).toBe(2);
    expect(counters.readCalls).toBe(2);
  });

  it("surfaces a deterministic read error immediately — no second attempt", async () => {
    const { namespace, counters } = scriptedNamespace([
      () => Promise.reject(new Error("no such table: nothing")),
    ]);
    const database = firmDatabaseFor(namespace as never, "firm_retry_sql_error");
    await expect(database.prepare("SELECT * FROM nothing").all()).rejects.toThrow(
      "no such table: nothing",
    );
    expect(counters.readCalls).toBe(1);
  });

  it("never re-sends into an overloaded object", async () => {
    const { namespace, counters } = scriptedNamespace([transientFailure(true)]);
    const database = firmDatabaseFor(namespace as never, "firm_retry_overloaded");
    await expect(database.prepare("SELECT 1").all()).rejects.toThrow("Durable Object reset");
    expect(counters.readCalls).toBe(1);
  });

  it("gives up after the retry budget and surfaces the transient failure", async () => {
    const { namespace, counters } = scriptedNamespace([transientFailure()]);
    const database = firmDatabaseFor(namespace as never, "firm_retry_exhausted");
    await expect(database.prepare("SELECT 1").all()).rejects.toThrow("Durable Object reset");
    // The first send plus the two budgeted retries, each on its own fresh stub.
    expect(counters.readCalls).toBe(3);
    expect(counters.getCalls).toBe(3);
  });

  it("never retries a write — a retryable failure on run() propagates on the first attempt", async () => {
    const { namespace, counters } = scriptedNamespace([transientFailure()]);
    const database = firmDatabaseFor(namespace as never, "firm_retry_write");
    await expect(database.prepare("UPDATE t SET c = 1").run()).rejects.toThrow(
      "Durable Object reset",
    );
    expect(counters.writeCalls).toBe(1);
  });
});
