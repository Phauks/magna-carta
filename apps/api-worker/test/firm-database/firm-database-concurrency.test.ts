import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
  commitEffectBatch,
  guarded,
  GuardedWriteRefusedError,
} from "@magna-carta/data-access/effect-batch";
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
    const kinds = [a.kind, b.kind].toSorted();
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

// A guarded write is enforced INSIDE the object's transaction, which is the only place it can be:
// the refusal has to take the audit row and the outbox message riding the same batch down with it.
// These drive the real RPC path — proxy marshals the guard, the object checks the row count, the
// typed outcome comes back and the proxy rethrows it — because every layer of that can drop a guard
// silently and the package-level tests run against a local SQLite adapter instead.
describe("guarded writes across the Durable Object RPC", () => {
  async function seedSetting(database: ReturnType<typeof proxyFor>, key: string, value: string) {
    await database
      .prepare("INSERT INTO setting (key, value, updated_at) VALUES (?1, ?2, ?3)")
      .bind(key, value, "2026-09-16T00:00:00.000Z")
      .run();
  }

  it("rolls the whole batch back when a guarded statement matches no row", async () => {
    const database = proxyFor("guarded_rollback");
    await seedSetting(database, "theme", "light");

    const stale = database
      .prepare("UPDATE setting SET value = 'sepia' WHERE key = ?1 AND value = ?2")
      .bind("theme", "a value it does not have");
    const audit = database
      .prepare("INSERT INTO outbox (id, topic, payload, created_at) VALUES (?1, ?2, ?3, ?4)")
      .bind("outbox_guarded_1", "guard.test", "{}", "2026-09-16T00:00:00.000Z");

    await expect(
      commitEffectBatch(
        database,
        { statements: [guarded(stale, "setting.value"), audit], outboxMessages: [] },
        { now: () => "2026-09-16T00:00:00.000Z" },
      ),
    ).rejects.toBeInstanceOf(GuardedWriteRefusedError);

    // Neither half landed: not the refused change, and not the record that would have described it.
    const { results } = await database
      .prepare("SELECT value FROM setting WHERE key = ?1")
      .bind("theme")
      .all<{ value: string }>();
    expect(results[0]?.value).toBe("light");
    const { results: outbox } = await database
      .prepare("SELECT count(*) AS c FROM outbox WHERE topic = ?1")
      .bind("guard.test")
      .all<{ c: number }>();
    expect(Number(outbox[0]?.c)).toBe(0);
  });

  it("commits normally when the guarded statement does match, so the guard costs nothing", async () => {
    const database = proxyFor("guarded_pass");
    await seedSetting(database, "theme", "light");

    const live = database
      .prepare("UPDATE setting SET value = 'sepia' WHERE key = ?1 AND value = ?2")
      .bind("theme", "light");
    await commitEffectBatch(
      database,
      { statements: [guarded(live, "setting.value")], outboxMessages: [] },
      { now: () => "2026-09-16T00:00:00.000Z" },
    );

    const { results } = await database
      .prepare("SELECT value FROM setting WHERE key = ?1")
      .bind("theme")
      .all<{ value: string }>();
    expect(results[0]?.value).toBe("sepia");
  });

  it("carries the guard's label back, so the caller knows which precondition failed", async () => {
    const database = proxyFor("guarded_label");
    await seedSetting(database, "theme", "light");
    const stale = database
      .prepare("UPDATE setting SET value = 'sepia' WHERE key = ?1 AND value = ?2")
      .bind("theme", "not-this");

    const caught = await commitEffectBatch(
      database,
      { statements: [guarded(stale, "a-label-the-caller-branches-on")], outboxMessages: [] },
      { now: () => "2026-09-16T00:00:00.000Z" },
    ).catch((error: unknown) => error);

    expect((caught as GuardedWriteRefusedError).guard).toBe("a-label-the-caller-branches-on");
  });
});
