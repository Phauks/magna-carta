import { newIdentifier } from "@magna-carta/identifiers/generate";
import { describe, expect, it } from "vitest";
import { assembleDailyTime } from "../src/productivity/daily-time.ts";
import { assembleTimekeeperProductivity } from "../src/productivity/timekeeper-productivity.ts";
import {
  AUTHORIZER,
  RECORDER,
  reportingFixture,
  seedMatter,
  type ReportingFixture,
} from "./support.ts";

// DAILY TIME. Timekeeping reads the same entries day by day as it reads for the productivity
// breakdown; the totals must equal Timekeeper Productivity's for the same period, and each day must
// carry exactly the time worked on it.

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

describe("the daily time report", () => {
  it("lists each day's time by timekeeper, and its totals equal Timekeeper Productivity's", async () => {
    const fixture = await reportingFixture();
    const alder = await seedMatter(fixture, "Alder", "entity_alder", "2026-02-01T09:00:00.000Z");
    await seedTime(fixture, alder, RECORDER, "2026-07-14", 90, true);
    await seedTime(fixture, alder, RECORDER, "2026-07-14", 30, false);
    await seedTime(fixture, alder, AUTHORIZER, "2026-07-14", 60, true);
    await seedTime(fixture, alder, AUTHORIZER, "2026-07-15", 120, true);
    await seedTime(fixture, alder, AUTHORIZER, "2026-07-15", 600, true, "void");
    await seedTime(fixture, alder, AUTHORIZER, "2026-08-02", 45, true);

    const options = { computedAt: COMPUTED_AT };
    const daily = await assembleDailyTime(fixture.database, { ...JULY, locationId: null }, options);
    const productivity = await assembleTimekeeperProductivity(
      fixture.database,
      { ...JULY, locationId: null },
      options,
    );

    expect(daily.totals).toEqual(productivity.totals);
    expect(daily.days.map((day) => [day.workDate, day.figures.totalMinutes])).toEqual([
      ["2026-07-14", 180],
      ["2026-07-15", 120],
    ]);
    expect(daily.days[0]?.timekeepers).toHaveLength(2);
    const authorizer = daily.timekeepers.find((entry) => entry.timekeeperUserId === AUTHORIZER);
    expect(authorizer).toMatchObject({ dayCount: 2, figures: { totalMinutes: 180 } });
  });
});
