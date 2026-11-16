import { newIdentifier } from "@magna-carta/identifiers/generate";
import { describe, expect, it } from "vitest";
import { assembleMatterProductivity } from "../src/productivity/matter-productivity.ts";
import { assembleTimekeeperProductivity } from "../src/productivity/timekeeper-productivity.ts";
import {
  AUTHORIZER,
  RECORDER,
  reportingFixture,
  seedMatter,
  type ReportingFixture,
} from "./support.ts";

// MATTER PRODUCTIVITY. The same breakdown Timekeeper Productivity adds up, turned so the matter is
// the row; the totals must equal that report's for the same period, and each matter must carry
// exactly the time recorded on it, by whom.

const COMPUTED_AT = "2026-08-05T15:00:00.000Z";
const JULY = { periodStart: "2026-07-01", periodEnd: "2026-07-31" };

async function seedTime(
  fixture: ReportingFixture,
  matterId: string,
  timekeeper: string,
  workDate: string,
  minutes: number,
  billable: boolean,
  status = "submitted",
) {
  await fixture.database
    .prepare(
      `INSERT INTO time_entry (id, matter_id, timekeeper_user_id, work_date, duration_minutes, raw_duration_minutes, narrative, billable, currency, rate_e4, amount_minor, status, source, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?5, 'Worked', ?6, 'USD', ?7, ?8, ?9, 'manual', ?10, ?10)`,
    )
    .bind(
      newIdentifier("timeEntry"),
      matterId,
      timekeeper,
      workDate,
      minutes,
      billable ? 1 : 0,
      billable ? 4_000_000 : null,
      billable ? 10_000 : null,
      status,
      COMPUTED_AT,
    )
    .run();
}

describe("the matter productivity report", () => {
  it("lists each matter's time by timekeeper, most first, and its totals equal Timekeeper Productivity's", async () => {
    const fixture = await reportingFixture();
    const at = "2026-02-01T09:00:00.000Z";
    const alder = await seedMatter(fixture, "Alder", "entity_alder", at);
    const washoe = await seedMatter(fixture, "Washoe", "entity_washoe", at);
    await fixture.database
      .prepare("UPDATE matter SET location_id = ?1 WHERE id = ?2")
      .bind(fixture.locationId, washoe)
      .run();
    await seedTime(fixture, alder, RECORDER, "2026-07-14", 90, true);
    await seedTime(fixture, alder, RECORDER, "2026-07-15", 30, false);
    await seedTime(fixture, alder, AUTHORIZER, "2026-07-14", 60, true);
    await seedTime(fixture, washoe, AUTHORIZER, "2026-07-15", 240, true);
    await seedTime(fixture, washoe, AUTHORIZER, "2026-07-15", 600, true, "void");
    await seedTime(fixture, washoe, AUTHORIZER, "2026-08-02", 45, true);

    const options = { computedAt: COMPUTED_AT };
    const report = await assembleMatterProductivity(
      fixture.database,
      { ...JULY, locationId: null },
      options,
    );
    const productivity = await assembleTimekeeperProductivity(
      fixture.database,
      { ...JULY, locationId: null },
      options,
    );

    expect(report.totals).toEqual(productivity.totals);
    expect(report.matters.map((matter) => [matter.matterId, matter.figures.totalMinutes])).toEqual([
      [washoe, 240],
      [alder, 180],
    ]);
    const alderRow = report.matters.find((matter) => matter.matterId === alder);
    expect(alderRow?.figures).toMatchObject({ billableMinutes: 150, nonBillableMinutes: 30 });
    expect(
      alderRow?.timekeepers.map((entry) => [entry.timekeeperUserId, entry.figures.totalMinutes]),
    ).toEqual([
      [RECORDER, 120],
      [AUTHORIZER, 60],
    ]);
  });

  it("narrows to one office without changing who may run it", async () => {
    const fixture = await reportingFixture();
    const at = "2026-02-01T09:00:00.000Z";
    const alder = await seedMatter(fixture, "Alder", "entity_alder", at);
    const washoe = await seedMatter(fixture, "Washoe", "entity_washoe", at);
    await fixture.database
      .prepare("UPDATE matter SET location_id = ?1 WHERE id = ?2")
      .bind(fixture.locationId, washoe)
      .run();
    await seedTime(fixture, alder, RECORDER, "2026-07-14", 90, true);
    await seedTime(fixture, washoe, AUTHORIZER, "2026-07-15", 240, true);
    const report = await assembleMatterProductivity(
      fixture.database,
      { ...JULY, locationId: fixture.locationId },
      { computedAt: COMPUTED_AT },
    );
    expect(report.matters.map((matter) => matter.matterId)).toEqual([washoe]);
    expect(report.totals.totalMinutes).toBe(240);
  });
});
