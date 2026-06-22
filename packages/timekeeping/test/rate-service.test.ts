import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import type { UserId } from "@magna-carta/identifiers/types";
import { describe, expect, it } from "vitest";
import { appendRate, createRateCard } from "../src/rate-service.ts";
import { RateValidationError } from "../src/rate-validation.ts";

const clock = { now: () => "2026-06-22T12:00:00.000Z" };
const options = { clock, actorUserId: "user_partner" as UserId };

function freshDatabase(): BatchDatabase {
  return createMigratedNodeDatabase("per-firm").database;
}

async function commit(database: BatchDatabase, effect: Parameters<typeof commitEffectBatch>[1]) {
  await commitEffectBatch(database, effect, { now: clock.now });
}

async function listRates(database: BatchDatabase, rateCardId: string) {
  const { results } = await database
    .prepare(
      "SELECT tier, scoped_id, rate_e4, currency, valid_from, valid_to FROM rate WHERE rate_card_id = ?1 ORDER BY valid_from",
    )
    .bind(rateCardId)
    .all<{
      tier: string;
      scoped_id: string | null;
      rate_e4: number;
      currency: string;
      valid_from: string;
      valid_to: string | null;
    }>();
  return results;
}

async function countAudit(database: BatchDatabase, event: string) {
  const { results } = await database
    .prepare("SELECT COUNT(*) AS c FROM audit_log WHERE event = ?1")
    .bind(event)
    .all<{ c: number }>();
  return results[0]?.c ?? 0;
}

describe("createRateCard", () => {
  it("inserts the card and an audit row", async () => {
    const database = freshDatabase();
    const { rateCardId, effect } = await createRateCard(database, { name: "Standard" }, options);
    await commit(database, effect);

    const { results } = await database
      .prepare("SELECT id, name, archived_at FROM rate_card WHERE id = ?1")
      .bind(rateCardId)
      .all<{ id: string; name: string; archived_at: string | null }>();
    expect(results[0]).toMatchObject({ id: rateCardId, name: "Standard", archived_at: null });
    expect(await countAudit(database, "rate_card.created")).toBe(1);
  });
});

describe("appendRate", () => {
  async function withCard(database: BatchDatabase) {
    const { rateCardId, effect } = await createRateCard(database, { name: "Standard" }, options);
    await commit(database, effect);
    return rateCardId;
  }

  it("inserts an open version and audits it", async () => {
    const database = freshDatabase();
    const rateCardId = await withCard(database);
    const { rateId, effect } = await appendRate(
      database,
      {
        rateCardId,
        tier: "timekeeper",
        scopedId: "user_associate",
        rateE4: 3_500_000,
        currency: "USD",
        validFrom: "2026-01-01",
      },
      options,
    );
    await commit(database, effect);

    const rows = await listRates(database, rateCardId);
    expect(rows).toEqual([
      {
        tier: "timekeeper",
        scoped_id: "user_associate",
        rate_e4: 3_500_000,
        currency: "USD",
        valid_from: "2026-01-01",
        valid_to: null,
      },
    ]);
    expect(rateId.startsWith("rate_")).toBe(true);
    expect(await countAudit(database, "rate.appended")).toBe(1);
  });

  it("closes the prior open row when a later version is appended", async () => {
    const database = freshDatabase();
    const rateCardId = await withCard(database);
    const scope = { rateCardId, tier: "timekeeper", scopedId: "user_associate", currency: "USD" } as const;

    await commit(database, (await appendRate(database, { ...scope, rateE4: 3_500_000, validFrom: "2026-01-01" }, options)).effect);
    await commit(database, (await appendRate(database, { ...scope, rateE4: 4_000_000, validFrom: "2026-07-01" }, options)).effect);

    const rows = await listRates(database, rateCardId);
    expect(rows).toEqual([
      {
        tier: "timekeeper",
        scoped_id: "user_associate",
        rate_e4: 3_500_000,
        currency: "USD",
        valid_from: "2026-01-01",
        valid_to: "2026-07-01", // the prior open row closed at the new valid_from
      },
      {
        tier: "timekeeper",
        scoped_id: "user_associate",
        rate_e4: 4_000_000,
        currency: "USD",
        valid_from: "2026-07-01",
        valid_to: null,
      },
    ]);
  });

  it("refuses a valid_from that lands inside an existing interval", async () => {
    const database = freshDatabase();
    const rateCardId = await withCard(database);
    const scope = { rateCardId, tier: "timekeeper", scopedId: "user_associate", currency: "USD" } as const;

    await commit(database, (await appendRate(database, { ...scope, rateE4: 3_500_000, validFrom: "2026-01-01" }, options)).effect);
    // The open row starts 2026-01-01; a new version dated earlier would overlap it.
    await expect(
      appendRate(database, { ...scope, rateE4: 4_000_000, validFrom: "2025-12-01" }, options),
    ).rejects.toBeInstanceOf(RateValidationError);
    await expect(
      appendRate(database, { ...scope, rateE4: 4_000_000, validFrom: "2025-12-01" }, options),
    ).rejects.toMatchObject({ code: "overlapping-valid-from" });
  });

  it("lets two non-overlapping versions for one scope coexist (the later closes the earlier)", async () => {
    const database = freshDatabase();
    const rateCardId = await withCard(database);
    const scope = { rateCardId, tier: "matter", scopedId: "matter_a", currency: "USD" } as const;

    await commit(database, (await appendRate(database, { ...scope, rateE4: 5_000_000, validFrom: "2026-01-01" }, options)).effect);
    await commit(database, (await appendRate(database, { ...scope, rateE4: 5_500_000, validFrom: "2026-06-01" }, options)).effect);

    const rows = await listRates(database, rateCardId);
    expect(rows.map((r) => r.valid_to)).toEqual(["2026-06-01", null]);
  });

  it("keeps separate scopes independent (a card-wide default and a timekeeper override both stay open)", async () => {
    const database = freshDatabase();
    const rateCardId = await withCard(database);

    await commit(database, (await appendRate(database, { rateCardId, tier: "role", scopedId: null, rateE4: 3_000_000, currency: "USD", validFrom: "2026-01-01" }, options)).effect);
    await commit(database, (await appendRate(database, { rateCardId, tier: "timekeeper", scopedId: "user_associate", rateE4: 3_500_000, currency: "USD", validFrom: "2026-01-01" }, options)).effect);

    const rows = await listRates(database, rateCardId);
    // Two distinct scopes -> two open rows, neither closes the other.
    expect(rows.filter((r) => r.valid_to === null)).toHaveLength(2);
  });
});

it("RateValidationError carries a stable code", () => {
  expect(new RateValidationError("overlapping-valid-from", "x").code).toBe("overlapping-valid-from");
});
