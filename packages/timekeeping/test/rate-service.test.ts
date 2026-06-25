import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import type { MatterId, UserId } from "@magna-carta/identifiers/types";
import { describe, expect, it } from "vitest";
import { appendRate, createRateCard, reRateUnbilledDrafts } from "../src/rate-service.ts";
import { RateValidationError } from "../src/rate-validation.ts";
import { captureTimeEntry } from "../src/time-entry-service.ts";

const clock = { now: () => "2026-06-22T12:00:00.000Z" };
const TIMEKEEPER = "user_partner" as UserId;
const options = { clock, actorUserId: TIMEKEEPER };

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
    const scope = {
      rateCardId,
      tier: "timekeeper",
      scopedId: "user_associate",
      currency: "USD",
    } as const;

    await commit(
      database,
      (
        await appendRate(
          database,
          { ...scope, rateE4: 3_500_000, validFrom: "2026-01-01" },
          options,
        )
      ).effect,
    );
    await commit(
      database,
      (
        await appendRate(
          database,
          { ...scope, rateE4: 4_000_000, validFrom: "2026-07-01" },
          options,
        )
      ).effect,
    );

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
    const scope = {
      rateCardId,
      tier: "timekeeper",
      scopedId: "user_associate",
      currency: "USD",
    } as const;

    await commit(
      database,
      (
        await appendRate(
          database,
          { ...scope, rateE4: 3_500_000, validFrom: "2026-01-01" },
          options,
        )
      ).effect,
    );
    // The open row starts 2026-01-01; a new version dated earlier would overlap it.
    await expect(
      appendRate(database, { ...scope, rateE4: 4_000_000, validFrom: "2025-12-01" }, options),
    ).rejects.toBeInstanceOf(RateValidationError);
    await expect(
      appendRate(database, { ...scope, rateE4: 4_000_000, validFrom: "2025-12-01" }, options),
    ).rejects.toMatchObject({ code: "overlapping-valid-from" });
  });

  it("refuses a valid_from that lands strictly inside a closed interval between two existing versions", async () => {
    const database = freshDatabase();
    const rateCardId = await withCard(database);
    const scope = {
      rateCardId,
      tier: "timekeeper",
      scopedId: "user_associate",
      currency: "USD",
    } as const;

    // Establish two versions: [2026-01-01, 2026-07-01) closed + [2026-07-01, ∞) open.
    await commit(
      database,
      (
        await appendRate(
          database,
          { ...scope, rateE4: 3_500_000, validFrom: "2026-01-01" },
          options,
        )
      ).effect,
    );
    await commit(
      database,
      (
        await appendRate(
          database,
          { ...scope, rateE4: 4_000_000, validFrom: "2026-07-01" },
          options,
        )
      ).effect,
    );

    // 2026-04-15 lands inside the closed interval — must be refused.
    await expect(
      appendRate(database, { ...scope, rateE4: 4_500_000, validFrom: "2026-04-15" }, options),
    ).rejects.toBeInstanceOf(RateValidationError);
    await expect(
      appendRate(database, { ...scope, rateE4: 4_500_000, validFrom: "2026-04-15" }, options),
    ).rejects.toMatchObject({ code: "overlapping-valid-from" });
  });

  it("refuses a valid_from equal to an existing version's valid_from", async () => {
    const database = freshDatabase();
    const rateCardId = await withCard(database);
    const scope = {
      rateCardId,
      tier: "timekeeper",
      scopedId: "user_associate",
      currency: "USD",
    } as const;

    await commit(
      database,
      (
        await appendRate(
          database,
          { ...scope, rateE4: 3_500_000, validFrom: "2026-01-01" },
          options,
        )
      ).effect,
    );

    // Exact duplicate date must be refused (equal is not strictly after).
    await expect(
      appendRate(database, { ...scope, rateE4: 4_000_000, validFrom: "2026-01-01" }, options),
    ).rejects.toBeInstanceOf(RateValidationError);
    await expect(
      appendRate(database, { ...scope, rateE4: 4_000_000, validFrom: "2026-01-01" }, options),
    ).rejects.toMatchObject({ code: "overlapping-valid-from" });
  });

  it("lets two non-overlapping versions for one scope coexist (the later closes the earlier)", async () => {
    const database = freshDatabase();
    const rateCardId = await withCard(database);
    const scope = { rateCardId, tier: "matter", scopedId: "matter_a", currency: "USD" } as const;

    await commit(
      database,
      (
        await appendRate(
          database,
          { ...scope, rateE4: 5_000_000, validFrom: "2026-01-01" },
          options,
        )
      ).effect,
    );
    await commit(
      database,
      (
        await appendRate(
          database,
          { ...scope, rateE4: 5_500_000, validFrom: "2026-06-01" },
          options,
        )
      ).effect,
    );

    const rows = await listRates(database, rateCardId);
    expect(rows.map((r) => r.valid_to)).toEqual(["2026-06-01", null]);
  });

  it("keeps separate scopes independent (a card-wide default and a timekeeper override both stay open)", async () => {
    const database = freshDatabase();
    const rateCardId = await withCard(database);

    await commit(
      database,
      (
        await appendRate(
          database,
          {
            rateCardId,
            tier: "role",
            scopedId: null,
            rateE4: 3_000_000,
            currency: "USD",
            validFrom: "2026-01-01",
          },
          options,
        )
      ).effect,
    );
    await commit(
      database,
      (
        await appendRate(
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
        )
      ).effect,
    );

    const rows = await listRates(database, rateCardId);
    // Two distinct scopes -> two open rows, neither closes the other.
    expect(rows.filter((r) => r.valid_to === null)).toHaveLength(2);
  });
});

it("RateValidationError carries a stable code", () => {
  expect(new RateValidationError("overlapping-valid-from", "x").code).toBe(
    "overlapping-valid-from",
  );
});

async function seedMatter(database: BatchDatabase, matterId: string): Promise<void> {
  await database
    .prepare(
      "INSERT OR IGNORE INTO member (user_id, display_name, status, created_at) VALUES (?1, 'Partner', 'active', ?2)",
    )
    .bind(TIMEKEEPER, clock.now())
    .run();
  await database
    .prepare(
      "INSERT INTO matter (id, title, status, responsible_member_id, e_billing, created_at, updated_at) VALUES (?1, 'Smith v. Jones', 'open', ?2, 0, ?3, ?3)",
    )
    .bind(matterId, TIMEKEEPER, clock.now())
    .run();
}

async function countAudits(database: BatchDatabase, event: string): Promise<number> {
  const { results } = await database
    .prepare("SELECT COUNT(*) AS n FROM audit_log WHERE event = ?1")
    .bind(event)
    .all<{ n: number }>();
  return results[0]?.n ?? 0;
}

async function captureCardEntry(
  database: BatchDatabase,
  rateCardId: string,
  finalStatus: "draft" | "approved" | "billed",
): Promise<string> {
  const { timeEntryId, effect } = await captureTimeEntry(
    database,
    {
      matterId: "matter_1" as MatterId,
      timekeeperUserId: TIMEKEEPER,
      workDate: "2026-06-22",
      rawDurationMinutes: 60,
      durationMinutes: 60,
      narrative: "research",
      billable: true,
      currency: "USD",
      source: "manual",
      rate: {
        rateE4: 4500000,
        rateCardId,
        rateSource: "matter",
        currency: "USD",
        amountMinor: 45000,
      },
    },
    options,
  );
  await commitEffectBatch(database, effect, { now: clock.now });
  if (finalStatus === "approved") {
    await database
      .prepare("UPDATE time_entry SET status = 'approved' WHERE id = ?1")
      .bind(timeEntryId)
      .run();
  } else if (finalStatus === "billed") {
    await database
      .prepare("UPDATE time_entry SET status = 'billed', invoice_id = 'invoice_x' WHERE id = ?1")
      .bind(timeEntryId)
      .run();
  }
  return timeEntryId;
}

async function rateOf(database: BatchDatabase, id: string) {
  const { results } = await database
    .prepare("SELECT rate_e4, amount_minor FROM time_entry WHERE id = ?1")
    .bind(id)
    .all<{ rate_e4: number; amount_minor: number }>();
  return results[0];
}

describe("reRateUnbilledDrafts", () => {
  it("rewrites rate_e4/amount_minor on unbilled entries in range and leaves billed/void untouched", async () => {
    const database = freshDatabase();
    await seedMatter(database, "matter_1");

    // A card with a matter-tier rate of 450.0000/hr in force from the work date.
    const { rateCardId, effect: cardEffect } = await createRateCard(
      database,
      { name: "Standard" },
      options,
    );
    await commitEffectBatch(database, cardEffect, { now: clock.now });
    await commitEffectBatch(
      database,
      (
        await appendRate(
          database,
          {
            rateCardId,
            tier: "matter",
            scopedId: "matter_1",
            rateE4: 4500000,
            currency: "USD",
            validFrom: "2026-06-01",
          },
          options,
        )
      ).effect,
      { now: clock.now },
    );

    // Three entries on the card: a draft, an approved, and a billed — all 60 min, 2026-06-22.
    const draftId = await captureCardEntry(database, rateCardId, "draft");
    const approvedId = await captureCardEntry(database, rateCardId, "approved");
    const billedId = await captureCardEntry(database, rateCardId, "billed");

    // A retroactive correction: a new matter-tier version of 500.0000/hr effective 2026-06-15.
    await commitEffectBatch(
      database,
      (
        await appendRate(
          database,
          {
            rateCardId,
            tier: "matter",
            scopedId: "matter_1",
            rateE4: 5000000,
            currency: "USD",
            validFrom: "2026-06-15",
          },
          options,
        )
      ).effect,
      { now: clock.now },
    );

    const { count, effect } = await reRateUnbilledDrafts(
      database,
      { rateCardId, fromDate: "2026-06-01", toDate: "2026-07-01" },
      options,
    );
    await commitEffectBatch(database, effect, { now: clock.now });

    expect(count).toBe(2); // draft + approved; billed excluded
    // The draft + approved move to the 500.0000 rate; 60 min => 50000 minor.
    expect(await rateOf(database, draftId)).toMatchObject({
      rate_e4: 5000000,
      amount_minor: 50000,
    });
    expect(await rateOf(database, approvedId)).toMatchObject({
      rate_e4: 5000000,
      amount_minor: 50000,
    });
    // The billed entry's captured rate never moves.
    expect(await rateOf(database, billedId)).toMatchObject({
      rate_e4: 4500000,
      amount_minor: 45000,
    });
    expect(await countAudits(database, "time_entry.re_rated")).toBe(2);
  });
});
