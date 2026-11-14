import { newIdentifier } from "@magna-carta/identifiers/generate";
import { describe, expect, it } from "vitest";
import {
  assembleAgedExpenses,
  assembleAgedWorkInProgress,
} from "../src/financial/aged-work-in-progress.ts";
import { assembleWorkInProgress } from "../src/financial/work-in-progress.ts";
import { reportingFixture, seedMatter, type ReportingFixture } from "./support.ts";

// AGED WORK IN PROGRESS. Billing reads the same unbilled entries as the work-in-progress breakdown,
// bucketed by age; the buckets must add up to the Work in Progress report's own total, and each entry
// must land in the bucket its date puts it in.

const COMPUTED_AT = "2026-08-05T15:00:00.000Z";

async function seedTime(
  fixture: ReportingFixture,
  matterId: string,
  workDate: string,
  amountMinor: number,
  status = "draft",
) {
  await fixture.database
    .prepare(
      `INSERT INTO time_entry (id, matter_id, timekeeper_user_id, work_date, duration_minutes, raw_duration_minutes, narrative, billable, currency, rate_e4, amount_minor, status, source, created_at, updated_at)
       VALUES (?1, ?2, 'user_recorder', ?3, 60, 60, 'Drafted the motion', 1, 'USD', 4000000, ?4, ?5, 'manual', ?6, ?6)`,
    )
    .bind(newIdentifier("timeEntry"), matterId, workDate, amountMinor, status, COMPUTED_AT)
    .run();
}

async function seedCost(
  fixture: ReportingFixture,
  matterId: string,
  incurredDate: string,
  amountMinor: number,
) {
  await fixture.database
    .prepare(
      `INSERT INTO cost_entry (id, matter_id, incurred_date, amount_minor, currency, disbursement_class, billable, description, status, source, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, 'USD', 'hard', 1, 'Filing fee', 'draft', 'manual', ?5, ?5)`,
    )
    .bind(newIdentifier("costEntry"), matterId, incurredDate, amountMinor, COMPUTED_AT)
    .run();
}

describe("the aged work in progress report", () => {
  it("places each unbilled entry by its age, and the buckets add up to Work in Progress", async () => {
    const fixture = await reportingFixture();
    const at = "2026-02-01T09:00:00.000Z";
    const alder = await seedMatter(fixture, "Alder", "entity_alder", at);
    const washoe = await seedMatter(fixture, "Washoe", "entity_washoe", at);
    await seedTime(fixture, alder, "2026-08-01", 100_00); // 4 days
    await seedTime(fixture, alder, "2026-06-20", 200_00); // 46 days
    await seedCost(fixture, alder, "2026-05-20", 30_00); // 77 days
    await seedTime(fixture, washoe, "2026-03-01", 400_00); // 157 days
    await seedTime(fixture, washoe, "2026-03-01", 999_00, "billed"); // billed: not counted

    const options = { computedAt: COMPUTED_AT };
    const report = await assembleAgedWorkInProgress(
      fixture.database,
      { locationId: null },
      options,
    );
    const workInProgress = await assembleWorkInProgress(
      fixture.database,
      { locationId: null },
      options,
    );

    expect(report.asOfDate).toBe("2026-08-05");
    expect(report.totals).toEqual({
      unbilledMinor: [100_00, 200_00, 30_00, 400_00],
      totalMinor: workInProgress.totals.totalMinor,
    });
    const alderClient = report.clients.find((client) => client.clientEntityId === "entity_alder");
    expect(alderClient?.figures.unbilledMinor).toEqual([100_00, 200_00, 30_00, 0]);
    expect(alderClient?.matters[0]?.matterId).toBe(alder);
    expect(report.offices).toHaveLength(1);
    expect(report.offices[0]?.figures).toEqual(report.totals);
  });

  it("ages the costs alone as Aged Expenses, totalling the costs in Work in Progress", async () => {
    const fixture = await reportingFixture();
    const at = "2026-02-01T09:00:00.000Z";
    const alder = await seedMatter(fixture, "Alder", "entity_alder", at);
    await seedTime(fixture, alder, "2026-08-01", 100_00);
    await seedCost(fixture, alder, "2026-08-02", 15_00); // 3 days
    await seedCost(fixture, alder, "2026-05-20", 30_00); // 77 days

    const options = { computedAt: COMPUTED_AT };
    const report = await assembleAgedExpenses(fixture.database, { locationId: null }, options);
    const workInProgress = await assembleWorkInProgress(
      fixture.database,
      { locationId: null },
      options,
    );

    expect(report.totals).toEqual({
      unbilledMinor: [15_00, 0, 30_00, 0],
      totalMinor: workInProgress.totals.costMinor,
    });
    expect(report.statement).toMatch(/unbilled costs/);
  });
});
