import { readWorkInProgressBreakdown } from "@magna-carta/billing/queries";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import { fromMinor, toMinor } from "@magna-carta/money/format";
import { sum, USD } from "@magna-carta/money/money";
import { describe, expect, it } from "vitest";
import { assembleWorkInProgress } from "../src/financial/work-in-progress.ts";
import {
  AUTHORIZER,
  RECORDER,
  reportingFixture,
  seedMatter,
  type ReportingFixture,
} from "./support.ts";

// THE WORK-IN-PROGRESS DECOMPOSITION. Billing owns the breakdown rows (and proves them against its
// per-matter read); the report adds them into offices, clients, matters and timekeepers. Each roll-up
// must sum to the same totals.

const COMPUTED_AT = "2026-08-05T15:00:00.000Z";

const totalOf = (minors: readonly number[]): number =>
  minors.length === 0 ? 0 : toMinor(sum(minors.map((minor) => fromMinor(minor, USD))));

async function seedTime(
  fixture: ReportingFixture,
  matterId: string,
  timekeeper: string,
  amountMinor: number,
  minutes: number,
): Promise<void> {
  await fixture.database
    .prepare(
      `INSERT INTO time_entry (id, matter_id, timekeeper_user_id, work_date, duration_minutes, raw_duration_minutes, narrative, billable, currency, rate_e4, amount_minor, status, source, created_at, updated_at)
       VALUES (?1, ?2, ?3, '2026-08-01', ?4, ?4, 'Drafted the motion', 1, 'USD', 4000000, ?5, 'draft', 'manual', ?6, ?6)`,
    )
    .bind(newIdentifier("timeEntry"), matterId, timekeeper, minutes, amountMinor, COMPUTED_AT)
    .run();
}

async function seedCost(
  fixture: ReportingFixture,
  matterId: string,
  amountMinor: number,
): Promise<void> {
  await fixture.database
    .prepare(
      `INSERT INTO cost_entry (id, matter_id, incurred_date, amount_minor, currency, disbursement_class, billable, description, status, source, created_at, updated_at)
       VALUES (?1, ?2, '2026-08-01', ?3, 'USD', 'hard', 1, 'Filing fee', 'draft', 'manual', ?4, ?4)`,
    )
    .bind(newIdentifier("costEntry"), matterId, amountMinor, COMPUTED_AT)
    .run();
}

async function book() {
  const fixture = await reportingFixture();
  const carson = newIdentifier("location");
  await fixture.database
    .prepare(
      "INSERT INTO location (id, name, status, created_at, updated_at) VALUES (?1, 'Carson City', 'active', ?2, ?2)",
    )
    .bind(carson, "2026-01-01T00:00:00.000Z")
    .run();
  const alder = await seedMatter(fixture, "Alder", "entity_alder", "2026-02-01T09:00:00.000Z");
  const washoe = await seedMatter(fixture, "Washoe", "entity_washoe", "2026-02-01T09:00:00.000Z");
  await fixture.database
    .prepare("UPDATE matter SET location_id = ?1 WHERE id = ?2")
    .bind(carson, washoe)
    .run();
  await seedTime(fixture, alder, RECORDER, 40_000, 60);
  await seedTime(fixture, alder, AUTHORIZER, 30_000, 45);
  await seedTime(fixture, washoe, AUTHORIZER, 10_000, 15);
  await seedCost(fixture, alder, 12_500);
  return { fixture, carson };
}

describe("the work-in-progress report", () => {
  it("rolls billing's rows into offices, clients, matters and timekeepers that each sum to the total", async () => {
    const { fixture } = await book();
    const report = await assembleWorkInProgress(
      fixture.database,
      { locationId: null },
      { computedAt: COMPUTED_AT },
    );
    const rows = (await readWorkInProgressBreakdown(fixture.database)).rows;
    expect(report.totals.totalMinor).toBe(totalOf(rows.map((row) => row.amountMinor)));
    expect(report.totals).toMatchObject({
      timeMinor: 80_000,
      costMinor: 12_500,
      onDraftMinor: 0,
      timeMinutes: 120,
    });

    const totalsOf = (groups: readonly { readonly figures: { readonly totalMinor: number } }[]) =>
      totalOf(groups.map((group) => group.figures.totalMinor));
    expect(totalsOf(report.offices)).toBe(report.totals.totalMinor);
    expect(totalsOf(report.clients)).toBe(report.totals.totalMinor);
    expect(totalsOf(report.clients.flatMap((client) => client.matters))).toBe(
      report.totals.totalMinor,
    );
    // Costs have no timekeeper, so the timekeepers sum to the time alone.
    expect(totalsOf(report.timekeepers)).toBe(report.totals.timeMinor);
    expect(report.reproducible).toBe(false);
    expect(report.statement).toContain(COMPUTED_AT);
  });

  it("narrows to one office", async () => {
    const { fixture, carson } = await book();
    const report = await assembleWorkInProgress(
      fixture.database,
      { locationId: carson },
      { computedAt: COMPUTED_AT },
    );
    expect(report.totals.totalMinor).toBe(10_000);
    expect(report.offices.map((office) => office.locationName)).toEqual(["Carson City"]);
  });
});
