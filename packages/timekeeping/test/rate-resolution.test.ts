import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import type { UserId } from "@magna-carta/identifiers/types";
import { describe, expect, it } from "vitest";
import { appendRate, createRateCard } from "../src/rate-service.ts";
import { resolveRate, type RateResolutionContext } from "../src/rate-resolution.ts";

const clock = { now: () => "2026-06-22T12:00:00.000Z" };
const options = { clock, actorUserId: "user_partner" as UserId };

function freshDatabase(): BatchDatabase {
  return createMigratedNodeDatabase("per-firm").database;
}

async function commit(database: BatchDatabase, effect: Parameters<typeof commitEffectBatch>[1]) {
  await commitEffectBatch(database, effect, { now: clock.now });
}

async function makeCard(database: BatchDatabase): Promise<string> {
  const { rateCardId, effect } = await createRateCard(database, { name: "Standard" }, options);
  await commit(database, effect);
  return rateCardId;
}

async function seedRate(
  database: BatchDatabase,
  input: Parameters<typeof appendRate>[1],
): Promise<void> {
  await commit(database, (await appendRate(database, input, options)).effect);
}

const baseContext = (rateCardId: string): RateResolutionContext => ({
  matterId: "matter_a",
  clientId: "client_x",
  timekeeperUserId: "user_associate",
  roleId: "role_associate",
  workDate: "2026-06-22",
  rateCardId,
});

describe("resolveRate precedence", () => {
  it("resolves the card default (role tier, scoped_id null) when no more-specific row exists", async () => {
    const database = freshDatabase();
    const rateCardId = await makeCard(database);
    await seedRate(database, { rateCardId, tier: "role", scopedId: null, rateE4: 3_000_000, currency: "USD", validFrom: "2026-01-01" });

    expect(await resolveRate(database, baseContext(rateCardId))).toEqual({
      rateE4: 3_000_000,
      rateCardId,
      rateSource: "card_default",
      currency: "USD",
    });
  });

  it("the role tier (scoped to roleId) wins over the card default", async () => {
    const database = freshDatabase();
    const rateCardId = await makeCard(database);
    await seedRate(database, { rateCardId, tier: "role", scopedId: null, rateE4: 3_000_000, currency: "USD", validFrom: "2026-01-01" });
    await seedRate(database, { rateCardId, tier: "role", scopedId: "role_associate", rateE4: 3_200_000, currency: "USD", validFrom: "2026-01-01" });

    expect((await resolveRate(database, baseContext(rateCardId)) as { rateSource: string; rateE4: number })).toMatchObject({
      rateSource: "role",
      rateE4: 3_200_000,
    });
  });

  it("the timekeeper tier wins over role", async () => {
    const database = freshDatabase();
    const rateCardId = await makeCard(database);
    await seedRate(database, { rateCardId, tier: "role", scopedId: "role_associate", rateE4: 3_200_000, currency: "USD", validFrom: "2026-01-01" });
    await seedRate(database, { rateCardId, tier: "timekeeper", scopedId: "user_associate", rateE4: 3_500_000, currency: "USD", validFrom: "2026-01-01" });

    expect((await resolveRate(database, baseContext(rateCardId)) as { rateSource: string }).rateSource).toBe("timekeeper");
  });

  it("the client tier wins over timekeeper", async () => {
    const database = freshDatabase();
    const rateCardId = await makeCard(database);
    await seedRate(database, { rateCardId, tier: "timekeeper", scopedId: "user_associate", rateE4: 3_500_000, currency: "USD", validFrom: "2026-01-01" });
    await seedRate(database, { rateCardId, tier: "client", scopedId: "client_x", rateE4: 4_000_000, currency: "USD", validFrom: "2026-01-01" });

    expect((await resolveRate(database, baseContext(rateCardId)) as { rateSource: string }).rateSource).toBe("client");
  });

  it("the matter tier wins over client", async () => {
    const database = freshDatabase();
    const rateCardId = await makeCard(database);
    await seedRate(database, { rateCardId, tier: "client", scopedId: "client_x", rateE4: 4_000_000, currency: "USD", validFrom: "2026-01-01" });
    await seedRate(database, { rateCardId, tier: "matter", scopedId: "matter_a", rateE4: 4_500_000, currency: "USD", validFrom: "2026-01-01" });

    expect((await resolveRate(database, baseContext(rateCardId)) as { rateSource: string; rateE4: number })).toMatchObject({
      rateSource: "matter",
      rateE4: 4_500_000,
    });
  });

  it("a per-entry override beats every stored tier and reaches no row", async () => {
    const database = freshDatabase();
    const rateCardId = await makeCard(database);
    await seedRate(database, { rateCardId, tier: "matter", scopedId: "matter_a", rateE4: 4_500_000, currency: "USD", validFrom: "2026-01-01" });

    expect(await resolveRate(database, { ...baseContext(rateCardId), overrideE4: 9_000_000 })).toEqual({
      rateE4: 9_000_000,
      rateCardId,
      rateSource: "override",
      currency: "USD",
    });
  });
});

describe("resolveRate effective-dating", () => {
  it("picks the version whose [valid_from, valid_to) contains work_date; valid_to is exclusive", async () => {
    const database = freshDatabase();
    const rateCardId = await makeCard(database);
    const scope = { rateCardId, tier: "timekeeper", scopedId: "user_associate", currency: "USD" } as const;
    await seedRate(database, { ...scope, rateE4: 3_500_000, validFrom: "2026-01-01" });
    await seedRate(database, { ...scope, rateE4: 4_000_000, validFrom: "2026-07-01" }); // closes the first at 2026-07-01

    const onJune = await resolveRate(database, { ...baseContext(rateCardId), workDate: "2026-06-30" });
    const onJuly = await resolveRate(database, { ...baseContext(rateCardId), workDate: "2026-07-01" });
    expect((onJune as { rateE4: number }).rateE4).toBe(3_500_000);
    // valid_to (2026-07-01) is exclusive on the first row and inclusive valid_from on the second.
    expect((onJuly as { rateE4: number }).rateE4).toBe(4_000_000);
  });

  it("returns the no-rate result when no version is in force on work_date", async () => {
    const database = freshDatabase();
    const rateCardId = await makeCard(database);
    await seedRate(database, { rateCardId, tier: "timekeeper", scopedId: "user_associate", rateE4: 3_500_000, currency: "USD", validFrom: "2026-07-01" });

    // work_date precedes the only version's valid_from.
    expect(await resolveRate(database, { ...baseContext(rateCardId), workDate: "2026-06-01" })).toEqual({ noRate: true });
  });
});

describe("resolveRate no-rate path", () => {
  it("a non-billable context (no card chosen, no override) is the no-rate result", async () => {
    const database = freshDatabase();
    const { rateCardId } = baseContext("rateCard_unused");
    void rateCardId;
    expect(await resolveRate(database, { matterId: "matter_a", clientId: null, timekeeperUserId: "user_associate", roleId: null, workDate: "2026-06-22" })).toEqual({ noRate: true });
  });

  it("a flat-fee matter still resolves the standard rate (a null rate means non-billable, never flat-fee)", async () => {
    const database = freshDatabase();
    const rateCardId = await makeCard(database);
    await seedRate(database, { rateCardId, tier: "role", scopedId: null, rateE4: 3_000_000, currency: "USD", validFrom: "2026-01-01" });

    // The matter being flat-fee is a billing concern; resolution still returns the standard rate so
    // realization can be reported.
    expect((await resolveRate(database, baseContext(rateCardId)) as { noRate?: true }).noRate).toBeUndefined();
  });
});
