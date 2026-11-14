import { newIdentifier } from "@magna-carta/identifiers/generate";
import { describe, expect, it } from "vitest";
import { assembleTimekeeperProductivity } from "../src/productivity/timekeeper-productivity.ts";
import {
  AUTHORIZER,
  RECORDER,
  reportingFixture,
  seedMatter,
  type ReportingFixture,
} from "./support.ts";

// THE PRODUCTIVITY DECOMPOSITION. Timekeeping owns the grouped minute counts; every roll-up here must
// sum to the same total, and nothing here may carry money.

const COMPUTED_AT = "2026-08-05T15:00:00.000Z";

async function seedTime(
  fixture: ReportingFixture,
  input: {
    readonly matterId: string;
    readonly timekeeper: string;
    readonly minutes: number;
    readonly billable: boolean;
    readonly workDate?: string;
    readonly status?: string;
    readonly categoryId?: string;
  },
): Promise<void> {
  await fixture.database
    .prepare(
      `INSERT INTO time_entry (id, matter_id, timekeeper_user_id, work_date, duration_minutes, raw_duration_minutes, narrative, billable, non_billable_category_id, currency, rate_e4, amount_minor, status, source, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?5, 'Worked', ?6, ?7, 'USD', ?8, ?9, ?10, 'manual', ?11, ?11)`,
    )
    .bind(
      newIdentifier("timeEntry"),
      input.matterId,
      input.timekeeper,
      input.workDate ?? "2026-07-14",
      input.minutes,
      input.billable ? 1 : 0,
      input.categoryId ?? null,
      input.billable ? 4_000_000 : null,
      input.billable ? 10_000 : null,
      input.status ?? "submitted",
      COMPUTED_AT,
    )
    .run();
}

async function book() {
  const fixture = await reportingFixture();
  const training = newIdentifier("nonBillableCategory");
  await fixture.database
    .prepare(
      "INSERT INTO non_billable_category (id, name, created_at, updated_at) VALUES (?1, 'Training', ?2, ?2)",
    )
    .bind(training, COMPUTED_AT)
    .run();
  const alder = await seedMatter(fixture, "Alder", "entity_alder", "2026-02-01T09:00:00.000Z");
  const washoe = await seedMatter(fixture, "Washoe", "entity_washoe", "2026-02-01T09:00:00.000Z");
  await seedTime(fixture, { matterId: alder, timekeeper: RECORDER, minutes: 120, billable: true });
  await seedTime(fixture, { matterId: washoe, timekeeper: RECORDER, minutes: 60, billable: true });
  await seedTime(fixture, {
    matterId: alder,
    timekeeper: RECORDER,
    minutes: 60,
    billable: false,
    categoryId: training,
  });
  await seedTime(fixture, {
    matterId: washoe,
    timekeeper: AUTHORIZER,
    minutes: 30,
    billable: true,
  });
  // Voided, and outside the period: neither is time recorded in July.
  await seedTime(fixture, {
    matterId: alder,
    timekeeper: AUTHORIZER,
    minutes: 600,
    billable: true,
    status: "void",
  });
  await seedTime(fixture, {
    matterId: alder,
    timekeeper: AUTHORIZER,
    minutes: 600,
    billable: true,
    workDate: "2026-08-01",
  });
  return fixture;
}

describe("the timekeeper productivity report", () => {
  it("rolls the recorded minutes into timekeepers, offices, clients and task codes that each sum to the total", async () => {
    const fixture = await book();
    const report = await assembleTimekeeperProductivity(
      fixture.database,
      { periodStart: "2026-07-01", periodEnd: "2026-07-31", locationId: null },
      { computedAt: COMPUTED_AT },
    );
    expect(report.totals).toEqual({
      entryCount: 4,
      billableMinutes: 210,
      nonBillableMinutes: 60,
      totalMinutes: 270,
      billableShareBasisPoints: 7778,
    });
    const minutesOf = (
      groups: readonly { readonly figures: { readonly totalMinutes: number } }[],
    ) => groups.reduce((total, group) => total + group.figures.totalMinutes, 0);
    expect(minutesOf(report.timekeepers)).toBe(270);
    expect(minutesOf(report.offices)).toBe(270);
    expect(minutesOf(report.clients)).toBe(270);
    expect(minutesOf(report.taskCodes)).toBe(270);
    expect(report.nonBillableCategories).toEqual([
      { categoryId: expect.any(String), categoryName: "Training", minutes: 60 },
    ]);
    const recorder = report.timekeepers.find((row) => row.timekeeperUserId === RECORDER);
    expect(recorder?.matterCount).toBe(2);
    expect(JSON.stringify(report)).not.toMatch(/Minor/);
    expect(report.reproducible).toBe(false);
  });
});
