import { readRealizationBreakdown } from "@magna-carta/billing/queries";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import { fromMinor, toMinor } from "@magna-carta/money/format";
import { sum, USD } from "@magna-carta/money/money";
import { describe, expect, it } from "vitest";
import { assembleRealization } from "../src/financial/realization.ts";
import { RECORDER, reportingFixture, seedMatter } from "./support.ts";

// THE REALIZATION DECOMPOSITION. Billing owns the per-matter legs (and proves them on both axes in
// packages/billing/test/aging-as-of.test.ts); the report adds them into offices, clients and matters.

const COMPUTED_AT = "2026-08-05T15:00:00.000Z";
const totalOf = (minors: readonly number[]): number =>
  minors.length === 0 ? 0 : toMinor(sum(minors.map((minor) => fromMinor(minor, USD))));

async function book() {
  const fixture = await reportingFixture();
  const alder = await seedMatter(fixture, "Alder", "entity_alder", "2026-02-01T09:00:00.000Z");
  const washoe = await seedMatter(fixture, "Washoe", "entity_washoe", "2026-02-01T09:00:00.000Z");
  // Each matter's time is valued 5,000 above what was billed for it.
  for (const [matterId, client, totalMinor, standardValueMinor] of [
    [alder, "entity_alder", 70_000, 75_000],
    [washoe, "entity_washoe", 30_000, 35_000],
  ] as const) {
    const invoiceId = newIdentifier("invoice");
    await fixture.database
      .prepare(
        "INSERT INTO invoice (id, client_entity_id, currency, status, invoice_number, number_scope_key, number_drawn_value, issue_date, due_date, finalized_at, created_at, updated_at) VALUES (?1, ?2, 'USD', 'final', ?3, '', 1, '2026-07-10', '2026-08-10', ?4, ?4, ?4)",
      )
      .bind(invoiceId, client, invoiceId.slice(-6), "2026-07-10T09:00:00.000Z")
      .run();
    await fixture.database
      .prepare(
        "INSERT INTO invoice_matter_balance (invoice_id, matter_id, total_minor, applied_minor, currency, created_at, updated_at) VALUES (?1, ?2, ?3, 0, 'USD', ?4, ?4)",
      )
      .bind(invoiceId, matterId, totalMinor, "2026-07-10T09:00:00.000Z")
      .run();
    await fixture.database
      .prepare(
        `INSERT INTO time_entry (id, matter_id, timekeeper_user_id, work_date, duration_minutes, raw_duration_minutes, narrative, billable, currency, rate_e4, amount_minor, status, source, created_at, updated_at)
         VALUES (?1, ?2, ?3, '2026-07-02', 60, 60, 'Drafted the motion', 1, 'USD', 4000000, ?4, 'billed', 'manual', ?5, ?5)`,
      )
      .bind(newIdentifier("timeEntry"), matterId, RECORDER, standardValueMinor, COMPUTED_AT)
      .run();
  }
  return fixture;
}

describe("the realization report", () => {
  it("rolls billing's per-matter legs into offices and clients that sum to the totals", async () => {
    const fixture = await book();
    const report = await assembleRealization(
      fixture.database,
      { periodStart: "2026-07-01", periodEnd: "2026-07-31", knownAsOf: null, locationId: null },
      { computedAt: COMPUTED_AT },
    );
    const { rows } = await readRealizationBreakdown(fixture.database, {
      periodStart: "2026-07-01",
      periodEnd: "2026-07-31",
      knownAsOf: COMPUTED_AT,
    });
    expect(report.totals).toEqual({
      standardValueMinor: totalOf(rows.map((row) => row.standardValueMinor)),
      billedMinor: totalOf(rows.map((row) => row.billedMinor)),
      creditedMinor: totalOf(rows.map((row) => row.creditedMinor)),
      appliedMinor: totalOf(rows.map((row) => row.appliedMinor)),
    });
    expect(report.totals).toMatchObject({ standardValueMinor: 110_000, billedMinor: 100_000 });
    expect(totalOf(report.offices.map((office) => office.figures.billedMinor))).toBe(100_000);
    expect(totalOf(report.clients.map((client) => client.figures.billedMinor))).toBe(100_000);
    expect(
      totalOf(
        report.clients
          .flatMap((client) => client.matters)
          .map((matter) => matter.figures.standardValueMinor),
      ),
    ).toBe(110_000);
    expect(report.standardValueIsLive).toBe(true);
    expect(report.standardValueStatement).toContain(COMPUTED_AT);
  });
});
