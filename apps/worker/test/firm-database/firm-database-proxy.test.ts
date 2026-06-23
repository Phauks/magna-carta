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
import { firmDatabaseProxy } from "../../src/firm-database/firm-database-proxy.ts";

const record = (key: string) => ({
  id: `idk_${key}` as IdempotencyRecordId,
  key,
  fingerprint: "fp",
  responseCode: 200,
  responseBody: null,
  createdAt: "2026-06-23T00:00:00.000Z",
});

function proxyFor(name: string) {
  return firmDatabaseProxy(env.FIRM_DATABASE.get(env.FIRM_DATABASE.idFromName(name)));
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
      (
        await purgeExpiredIdempotencyRecordsStatement(database, "2000-01-01T00:00:00.000Z").run()
      ).meta.changes,
    ).toBe(0);
    expect(
      (
        await purgeExpiredIdempotencyRecordsStatement(database, "2100-01-01T00:00:00.000Z").run()
      ).meta.changes,
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
    expect((await selectIdempotencyRecordStatement(database, "dupe").all()).results).toHaveLength(0);
  });
});
