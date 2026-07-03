import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import { firmDatabaseFor } from "../../src/firm-database/firm-database-proxy.ts";

// Concurrency / idempotency verifier for the per-firm FirmDatabase Durable Object. The DO serializes
// commitBatch RPCs against one firm's SQLite storage, so two concurrent identical idempotent effects
// resolve to exactly one winner (its side-effect applied once) and one replayed loser (its whole
// batch rolled back). A distinct firmId addresses a distinct DO, so the same key in two firms is not
// deduplicated — the tenant boundary holds.
function proxyFor(name: string) {
  return firmDatabaseFor(env.FIRM_DATABASE, name);
}

describe("per-firm DO concurrency", () => {
  it("serializes two concurrent identical idempotent effects: exactly one executes, loser's whole batch rolls back", async () => {
    const database = proxyFor("concurrency_dedup");
    const effect = () =>
      Promise.resolve({
        // each run wants to publish one outbox message as its business side-effect
        write: {
          statements: [],
          outboxMessages: [{ topic: "concurrency.test", payload: { n: 1 } }],
        },
        responseCode: 201,
        responseBody: '{"ok":true}',
      });

    const run = () =>
      runIdempotentEffect({
        database,
        key: "concurrent-key",
        fingerprint: "fp",
        effect,
        now: () => "2026-06-25T00:00:00.000Z",
      });

    // Fire both before awaiting either: both reach commitBatch against the SAME DO.
    const [a, b] = await Promise.all([run(), run()]);
    const kinds = [a.kind, b.kind].sort();
    // One winner executes, one loser replays the winner's stored response.
    expect(kinds).toEqual(["executed", "replayed"]);

    // Loser's whole batch rolled back -> the side-effect (outbox row) applied EXACTLY once.
    const outbox = await database
      .prepare("SELECT count(*) AS c FROM outbox WHERE topic = ?1")
      .bind("concurrency.test")
      .all<{ c: number }>();
    expect(Number(outbox.results[0]?.c)).toBe(1);

    // Exactly one idempotency record.
    const idem = await database
      .prepare("SELECT count(*) AS c FROM idempotency_key WHERE key = ?1")
      .bind("concurrent-key")
      .all<{ c: number }>();
    expect(Number(idem.results[0]?.c)).toBe(1);

    // The replayed loser serves the winner's response, not an error.
    const replayed = a.kind === "replayed" ? a : b;
    expect(replayed).toMatchObject({ responseCode: 201, responseBody: '{"ok":true}' });
  });

  it("distinct firmIds address distinct DOs: same key in two firms both execute (no cross-firm dedup)", async () => {
    const firmA = proxyFor("concurrency_firm_a");
    const firmB = proxyFor("concurrency_firm_b");
    const mk = (database: ReturnType<typeof proxyFor>) =>
      runIdempotentEffect({
        database,
        key: "shared-key",
        fingerprint: "fp",
        effect: () =>
          Promise.resolve({
            write: { statements: [], outboxMessages: [] },
            responseCode: 200,
            responseBody: null,
          }),
        now: () => "2026-06-25T00:00:00.000Z",
      });
    const [ra, rb] = await Promise.all([mk(firmA), mk(firmB)]);
    expect(ra.kind).toBe("executed");
    expect(rb.kind).toBe("executed");
  });
});
