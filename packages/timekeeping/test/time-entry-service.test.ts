import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import type { MatterId, UserId } from "@magna-carta/identifiers/types";
import { describe, expect, it } from "vitest";
import { captureTimeEntry, type CaptureTimeEntryInput } from "../src/time-entry-service.ts";
import { TimeEntryValidationError } from "../src/time-entry-validation.ts";

const clock = { now: () => "2026-06-22T12:00:00.000Z" };
const TIMEKEEPER = "user_attorney" as UserId;
const options = { clock, actorUserId: TIMEKEEPER };

function freshDatabase(): BatchDatabase {
  return createMigratedNodeDatabase("per-firm").database;
}

// A matter the capture binds to; e_billing defaults to 0 (off) unless overridden here.
async function seedMatter(
  database: BatchDatabase,
  matterId: string,
  eBilling = 0,
): Promise<void> {
  await database
    .prepare("INSERT INTO member (user_id, display_name, status, created_at) VALUES (?1, 'Attorney', 'active', ?2)")
    .bind(TIMEKEEPER, clock.now())
    .run();
  await database
    .prepare(
      "INSERT INTO matter (id, title, status, responsible_member_id, e_billing, created_at, updated_at) VALUES (?1, 'Smith v. Jones', 'open', ?2, ?3, ?4, ?4)",
    )
    .bind(matterId, TIMEKEEPER, eBilling, clock.now())
    .run();
}

async function seedRateCard(database: BatchDatabase, id: string): Promise<void> {
  await database
    .prepare("INSERT INTO rate_card (id, name, created_at, updated_at) VALUES (?1, 'Standard', ?2, ?2)")
    .bind(id, clock.now())
    .run();
}

async function seedNonBillableCategory(database: BatchDatabase, id: string): Promise<void> {
  await database
    .prepare(
      "INSERT INTO non_billable_category (id, name, created_at, updated_at) VALUES (?1, 'Admin', ?2, ?2)",
    )
    .bind(id, clock.now())
    .run();
}

async function seedUtbms(database: BatchDatabase, id: string, codeSet: string, code: string): Promise<void> {
  await database
    .prepare(
      "INSERT INTO utbms_code (id, code_set, code, label, active) VALUES (?1, ?2, ?3, ?4, 1)",
    )
    .bind(id, codeSet, code, `${code} label`)
    .run();
}

const billableBase: Omit<CaptureTimeEntryInput, "rate"> = {
  matterId: "matter_1" as MatterId,
  timekeeperUserId: TIMEKEEPER,
  workDate: "2026-06-22",
  rawDurationMinutes: 28,
  durationMinutes: 30,
  narrative: "drafted demand letter",
  billable: true,
  currency: "USD",
  source: "manual",
};

async function readEntry(database: BatchDatabase, id: string) {
  const { results } = await database
    .prepare(
      "SELECT matter_id, timekeeper_user_id, work_date, duration_minutes, raw_duration_minutes, narrative, billable, non_billable_category_id, currency, rate_e4, rate_card_id, rate_source, amount_minor, utbms_task_code_id, status, source, live_run_id FROM time_entry WHERE id = ?1",
    )
    .bind(id)
    .all();
  return results[0] as Record<string, unknown> | undefined;
}

async function countAudits(database: BatchDatabase, event: string): Promise<number> {
  const { results } = await database
    .prepare("SELECT COUNT(*) AS n FROM audit_log WHERE event = ?1")
    .bind(event)
    .all<{ n: number }>();
  return results[0]?.n ?? 0;
}

describe("captureTimeEntry", () => {
  it("stores a billable entry with its frozen rate snapshot and an audit row", async () => {
    const database = freshDatabase();
    await seedMatter(database, "matter_1");
    await seedRateCard(database, "rateCard_std");
    const { timeEntryId, effect } = await captureTimeEntry(
      database,
      {
        ...billableBase,
        rate: {
          rateE4: 4500000,
          rateCardId: "rateCard_std",
          rateSource: "matter",
          currency: "USD",
          amountMinor: 2250000,
        },
      },
      options,
    );
    await commitEffectBatch(database, effect, { now: clock.now });

    const row = await readEntry(database, timeEntryId);
    expect(row).toMatchObject({
      matter_id: "matter_1",
      timekeeper_user_id: TIMEKEEPER,
      work_date: "2026-06-22",
      duration_minutes: 30,
      raw_duration_minutes: 28,
      narrative: "drafted demand letter",
      billable: 1,
      non_billable_category_id: null,
      currency: "USD",
      rate_e4: 4500000,
      rate_card_id: "rateCard_std",
      rate_source: "matter",
      amount_minor: 2250000,
      status: "draft",
      source: "manual",
    });
    expect(await countAudits(database, "time_entry.captured")).toBe(1);
  });

  it("leaves rate columns null and sets the category on a non-billable capture", async () => {
    const database = freshDatabase();
    await seedMatter(database, "matter_1");
    await seedNonBillableCategory(database, "nonBillableCategory_admin");
    const { timeEntryId, effect } = await captureTimeEntry(
      database,
      {
        ...billableBase,
        billable: false,
        nonBillableCategoryId: "nonBillableCategory_admin",
        rate: { noRate: true },
      },
      options,
    );
    await commitEffectBatch(database, effect, { now: clock.now });

    const row = await readEntry(database, timeEntryId);
    expect(row).toMatchObject({
      billable: 0,
      non_billable_category_id: "nonBillableCategory_admin",
      rate_e4: null,
      rate_card_id: null,
      rate_source: null,
      amount_minor: null, // paired-null with rate_e4 — both null for non-billable internal time
    });
  });

  it("carries the live_run_id through for a timer-sourced capture", async () => {
    const database = freshDatabase();
    await seedMatter(database, "matter_1");
    await seedRateCard(database, "rateCard_std");
    const { timeEntryId, effect } = await captureTimeEntry(
      database,
      {
        ...billableBase,
        source: "timer",
        liveRunId: "run_abc",
        rate: {
          rateE4: 4500000,
          rateCardId: "rateCard_std",
          rateSource: "matter",
          currency: "USD",
          amountMinor: 2250000,
        },
      },
      options,
    );
    await commitEffectBatch(database, effect, { now: clock.now });
    expect((await readEntry(database, timeEntryId))?.live_run_id).toBe("run_abc");
  });

  it("refuses a billable capture on an e_billing matter without a UTBMS task code", async () => {
    const database = freshDatabase();
    await seedMatter(database, "matter_1", 1);
    await expect(
      captureTimeEntry(
        database,
        {
          ...billableBase,
          rate: {
            rateE4: 4500000,
            rateCardId: "rateCard_std",
            rateSource: "matter",
            currency: "USD",
            amountMinor: 2250000,
          },
        },
        options,
      ),
    ).rejects.toMatchObject({ code: "utbms-required" });
  });

  it("accepts an e_billing capture once a UTBMS task code is supplied", async () => {
    const database = freshDatabase();
    await seedMatter(database, "matter_1", 1);
    await seedRateCard(database, "rateCard_std");
    await seedUtbms(database, "utbmsCode_l120", "task", "L120");
    const { timeEntryId, effect } = await captureTimeEntry(
      database,
      {
        ...billableBase,
        utbmsTaskCodeId: "utbmsCode_l120",
        rate: {
          rateE4: 4500000,
          rateCardId: "rateCard_std",
          rateSource: "matter",
          currency: "USD",
          amountMinor: 2250000,
        },
      },
      options,
    );
    await commitEffectBatch(database, effect, { now: clock.now });
    expect((await readEntry(database, timeEntryId))?.utbms_task_code_id).toBe("utbmsCode_l120");
  });
});

it("TimeEntryValidationError carries a stable code", () => {
  expect(new TimeEntryValidationError("utbms-required", "x").code).toBe("utbms-required");
});
