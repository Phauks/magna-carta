import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import type { UserId } from "@magna-carta/identifiers/types";
import { describe, expect, it } from "vitest";
import { readMyDay } from "../src/my-day.ts";

const TIMEKEEPER = "user_attorney" as UserId;

function freshDatabase(): BatchDatabase {
  return createMigratedNodeDatabase("per-firm").database;
}

async function seedMatter(database: BatchDatabase, id: string): Promise<void> {
  await database
    .prepare(
      "INSERT INTO matter (id, title, description, status, matter_type_id, location_id, responsible_member_id, client_display_name, client_code, matter_number, numbered_at, opened_at, closed_at, created_at, updated_at) VALUES (?1, 'M', NULL, 'open', NULL, NULL, ?2, NULL, NULL, NULL, NULL, NULL, NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')",
    )
    .bind(id, TIMEKEEPER)
    .run();
}

interface SeedEntry {
  id: string;
  workDate: string;
  durationMinutes: number;
  billable: 0 | 1;
  status?: string;
}

async function seedEntry(database: BatchDatabase, entry: SeedEntry): Promise<void> {
  await database
    .prepare(
      "INSERT INTO time_entry (id, matter_id, timekeeper_user_id, work_date, duration_minutes, raw_duration_minutes, narrative, billable, non_billable_category_id, currency, rate_e4, rate_card_id, rate_source, amount_minor, utbms_task_code_id, utbms_activity_code_id, status, source, live_run_id, invoice_id, created_at, updated_at, created_by) VALUES (?1, 'matter_a', ?2, ?3, ?4, ?4, 'work', ?5, NULL, 'USD', NULL, NULL, NULL, NULL, NULL, NULL, ?6, 'manual', NULL, NULL, '2026-06-22T00:00:00.000Z', '2026-06-22T00:00:00.000Z', ?2)",
    )
    .bind(entry.id, TIMEKEEPER, entry.workDate, entry.durationMinutes, entry.billable, entry.status ?? "draft")
    .run();
}

async function seedMember(database: BatchDatabase): Promise<void> {
  await database
    .prepare("INSERT INTO member (user_id, display_name, status, created_at) VALUES (?1, 'Attorney', 'active', '2026-01-01T00:00:00.000Z')")
    .bind(TIMEKEEPER)
    .run();
}

async function setup(): Promise<BatchDatabase> {
  const database = freshDatabase();
  await seedMember(database);
  await seedMatter(database, "matter_a");
  return database;
}

describe("readMyDay", () => {
  it("totals billable and non-billable minutes for the work date, excluding void", async () => {
    const database = await setup();
    await seedEntry(database, { id: "timeEntry_1", workDate: "2026-06-22", durationMinutes: 120, billable: 1 });
    await seedEntry(database, { id: "timeEntry_2", workDate: "2026-06-22", durationMinutes: 90, billable: 1 });
    await seedEntry(database, { id: "timeEntry_3", workDate: "2026-06-22", durationMinutes: 30, billable: 0 });
    // A void entry never counts toward the day's totals.
    await seedEntry(database, {
      id: "timeEntry_void",
      workDate: "2026-06-22",
      durationMinutes: 60,
      billable: 1,
      status: "void",
    });
    // A different day must not bleed in.
    await seedEntry(database, { id: "timeEntry_other", workDate: "2026-06-21", durationMinutes: 240, billable: 1 });

    const view = await readMyDay(database, {
      timekeeperUserId: TIMEKEEPER,
      workDate: "2026-06-22",
      targets: { targetDailyMinutes: 480 },
    });
    expect(view).toEqual({
      billableMinutes: 210,
      nonBillableMinutes: 30,
      targetDailyMinutes: 480,
      shortfallMinutes: 270, // 480 - 210 billable
      unloggedDay: false,
    });
  });

  it("reports an un-logged day with a null shortfall when no target is set", async () => {
    const database = await setup();
    const view = await readMyDay(database, {
      timekeeperUserId: TIMEKEEPER,
      workDate: "2026-06-22",
      targets: { targetDailyMinutes: null },
    });
    expect(view).toEqual({
      billableMinutes: 0,
      nonBillableMinutes: 0,
      targetDailyMinutes: null,
      shortfallMinutes: null,
      unloggedDay: true,
    });
  });

  it("clamps the shortfall to zero once the billable target is met", async () => {
    const database = await setup();
    await seedEntry(database, { id: "timeEntry_1", workDate: "2026-06-22", durationMinutes: 540, billable: 1 });
    const view = await readMyDay(database, {
      timekeeperUserId: TIMEKEEPER,
      workDate: "2026-06-22",
      targets: { targetDailyMinutes: 480 },
    });
    expect(view.shortfallMinutes).toBe(0);
    expect(view.unloggedDay).toBe(false);
  });
});
