import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import type { MatterId, UserId } from "@magna-carta/identifiers/types";
import { describe, expect, it } from "vitest";
import {
  listTimeEntriesForTimekeeperDay,
  listUnbilledByMatter,
  listWeeklyGrid,
} from "../src/queries.ts";

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
  matterId: string;
  workDate: string;
  durationMinutes: number;
  status: string;
  amountMinor: number | null;
  createdAt: string;
}

async function seedEntry(database: BatchDatabase, entry: SeedEntry): Promise<void> {
  await database
    .prepare(
      "INSERT INTO time_entry (id, matter_id, timekeeper_user_id, work_date, duration_minutes, raw_duration_minutes, narrative, billable, non_billable_category_id, currency, rate_e4, rate_card_id, rate_source, amount_minor, utbms_task_code_id, utbms_activity_code_id, status, source, live_run_id, invoice_id, created_at, updated_at, created_by) VALUES (?1, ?2, ?3, ?4, ?5, ?5, 'work', 1, NULL, 'USD', 30000, 'rateCard_a', 'matter', ?6, NULL, NULL, ?7, 'manual', NULL, NULL, ?8, ?8, ?3)",
    )
    .bind(
      entry.id,
      entry.matterId,
      TIMEKEEPER,
      entry.workDate,
      entry.durationMinutes,
      entry.amountMinor,
      entry.status,
      entry.createdAt,
    )
    .run();
}

async function seedMember(database: BatchDatabase): Promise<void> {
  await database
    .prepare(
      "INSERT INTO member (user_id, display_name, status, created_at) VALUES (?1, 'Attorney', 'active', '2026-01-01T00:00:00.000Z')",
    )
    .bind(TIMEKEEPER)
    .run();
}

async function seedRateCard(database: BatchDatabase, id: string): Promise<void> {
  await database
    .prepare(
      "INSERT INTO rate_card (id, name, created_at, updated_at) VALUES (?1, 'Standard', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')",
    )
    .bind(id)
    .run();
}

async function setup(): Promise<BatchDatabase> {
  const database = freshDatabase();
  await seedMember(database);
  await seedRateCard(database, "rateCard_a");
  await seedMatter(database, "matter_a");
  await seedMatter(database, "matter_b");
  return database;
}

const day = (n: number) => `2026-06-${String(n).padStart(2, "0")}`;
const at = (n: number) => `2026-06-${String(n).padStart(2, "0")}T12:00:00.000Z`;

describe("listTimeEntriesForTimekeeperDay", () => {
  it("returns the timekeeper's entries for the work date, newest first", async () => {
    const database = await setup();
    await seedEntry(database, {
      id: "timeEntry_1",
      matterId: "matter_a",
      workDate: day(22),
      durationMinutes: 60,
      status: "draft",
      amountMinor: 30000,
      createdAt: at(22),
    });
    await seedEntry(database, {
      id: "timeEntry_2",
      matterId: "matter_b",
      workDate: day(22),
      durationMinutes: 30,
      status: "draft",
      amountMinor: 15000,
      createdAt: at(21),
    });
    await seedEntry(database, {
      id: "timeEntry_other",
      matterId: "matter_a",
      workDate: day(21),
      durationMinutes: 90,
      status: "draft",
      amountMinor: 45000,
      createdAt: at(20),
    });
    const { data } = await listTimeEntriesForTimekeeperDay(database, {
      timekeeperUserId: TIMEKEEPER,
      workDate: day(22),
    });
    expect(data.map((row) => row.id)).toEqual(["timeEntry_1", "timeEntry_2"]);
    expect(data[0]).toMatchObject({
      matterId: "matter_a",
      durationMinutes: 60,
      amountMinor: 30000,
    });
  });
});

describe("listWeeklyGrid", () => {
  it("returns the timekeeper's entries across the week window, oldest day first", async () => {
    const database = await setup();
    await seedEntry(database, {
      id: "timeEntry_mon",
      matterId: "matter_a",
      workDate: day(22),
      durationMinutes: 60,
      status: "draft",
      amountMinor: 30000,
      createdAt: at(22),
    });
    await seedEntry(database, {
      id: "timeEntry_tue",
      matterId: "matter_a",
      workDate: day(23),
      durationMinutes: 120,
      status: "draft",
      amountMinor: 60000,
      createdAt: at(23),
    });
    // Outside the window — excluded.
    await seedEntry(database, {
      id: "timeEntry_prev",
      matterId: "matter_a",
      workDate: day(21),
      durationMinutes: 30,
      status: "draft",
      amountMinor: 15000,
      createdAt: at(21),
    });
    const rows = await listWeeklyGrid(database, {
      timekeeperUserId: TIMEKEEPER,
      fromDate: day(22),
      toDate: day(28),
    });
    expect(rows.map((row) => row.id)).toEqual(["timeEntry_mon", "timeEntry_tue"]);
    expect(rows.map((row) => row.workDate)).toEqual([day(22), day(23)]);
  });
});

describe("listUnbilledByMatter", () => {
  it("sums unbilled minutes and amount per matter, excluding billed and void", async () => {
    const database = await setup();
    await seedEntry(database, {
      id: "timeEntry_1",
      matterId: "matter_a",
      workDate: day(22),
      durationMinutes: 60,
      status: "draft",
      amountMinor: 30000,
      createdAt: at(22),
    });
    await seedEntry(database, {
      id: "timeEntry_2",
      matterId: "matter_a",
      workDate: day(22),
      durationMinutes: 30,
      status: "approved",
      amountMinor: 15000,
      createdAt: at(22),
    });
    // Billed and void must not appear in unbilled WIP.
    await seedEntry(database, {
      id: "timeEntry_billed",
      matterId: "matter_a",
      workDate: day(22),
      durationMinutes: 120,
      status: "billed",
      amountMinor: 60000,
      createdAt: at(22),
    });
    await seedEntry(database, {
      id: "timeEntry_void",
      matterId: "matter_a",
      workDate: day(22),
      durationMinutes: 45,
      status: "void",
      amountMinor: 22500,
      createdAt: at(22),
    });
    const rows = await listUnbilledByMatter(database, { matterId: "matter_a" as MatterId });
    expect(rows).toEqual([
      { matterId: "matter_a", unbilledMinutes: 90, unbilledAmountMinor: 45000, entryCount: 2 },
    ]);
  });
});
