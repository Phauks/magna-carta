import { newIdentifier } from "@magna-carta/identifiers/generate";
import { selectTrustClientLedgerTotalAsOfStatement } from "@magna-carta/trust/statements";
import { describe, expect, it } from "vitest";
import { assembleAccountsReceivableAging } from "../src/financial/accounts-receivable-aging.ts";
import { assembleMatterBalances } from "../src/financial/matter-balances.ts";
import { assembleWorkInProgress } from "../src/financial/work-in-progress.ts";
import { depositInto, reportingFixture, seedMatter, type ReportingFixture } from "./support.ts";

// THE MATTER-BALANCES DECOMPOSITION. Each column is moved from an answer another module owns: the
// unbilled column from the work-in-progress report, the owed column from the receivables aging, and
// the trust column from trust's per-leaf balance. Each column's total must equal its owner's total.

const COMPUTED_AT = "2026-08-05T15:00:00.000Z";

async function seedTime(fixture: ReportingFixture, matterId: string, amountMinor: number) {
  await fixture.database
    .prepare(
      `INSERT INTO time_entry (id, matter_id, timekeeper_user_id, work_date, duration_minutes, raw_duration_minutes, narrative, billable, currency, rate_e4, amount_minor, status, source, created_at, updated_at)
       VALUES (?1, ?2, 'user_recorder', '2026-08-01', 60, 60, 'Drafted the motion', 1, 'USD', 4000000, ?3, 'draft', 'manual', ?4, ?4)`,
    )
    .bind(newIdentifier("timeEntry"), matterId, amountMinor, COMPUTED_AT)
    .run();
}

async function seedBill(
  fixture: ReportingFixture,
  client: string,
  matterId: string,
  totalMinor: number,
) {
  const invoiceId = newIdentifier("invoice");
  const at = "2026-07-10T09:00:00.000Z";
  await fixture.database
    .prepare(
      "INSERT INTO invoice (id, client_entity_id, currency, status, invoice_number, number_scope_key, number_drawn_value, issue_date, due_date, finalized_at, created_at, updated_at) VALUES (?1, ?2, 'USD', 'final', ?3, '', 1, '2026-07-10', '2026-08-10', ?4, ?4, ?4)",
    )
    .bind(invoiceId, client, invoiceId.slice(-6), at)
    .run();
  await fixture.database
    .prepare(
      "INSERT INTO invoice_matter_balance (invoice_id, matter_id, total_minor, applied_minor, currency, created_at, updated_at) VALUES (?1, ?2, ?3, 0, 'USD', ?4, ?4)",
    )
    .bind(invoiceId, matterId, totalMinor, at)
    .run();
}

async function book() {
  const fixture = await reportingFixture();
  const at = "2026-02-01T09:00:00.000Z";
  const alder = await seedMatter(fixture, "Alder", "entity_alder", at);
  const alderEstate = await seedMatter(fixture, "Alder estate", "entity_alder", at);
  const washoe = await seedMatter(fixture, "Washoe", "entity_washoe", at);
  await fixture.database
    .prepare("UPDATE matter SET location_id = ?1 WHERE id = ?2")
    .bind(fixture.locationId, washoe)
    .run();
  // Alder has all three; the estate only trust money; Washoe only unbilled work.
  await seedTime(fixture, alder, 400_00);
  await seedBill(fixture, "entity_alder", alder, 600_00);
  await depositInto(fixture, {
    matterId: alder,
    label: "Alder",
    amountMinor: 800_00,
    effectiveDate: "2026-07-01",
    recordedAt: "2026-07-01T10:00:00.000Z",
  });
  await depositInto(fixture, {
    matterId: alderEstate,
    label: "Alder estate",
    amountMinor: 150_00,
    effectiveDate: "2026-07-02",
    recordedAt: "2026-07-02T10:00:00.000Z",
  });
  await seedTime(fixture, washoe, 200_00);
  return { fixture, alder, alderEstate, washoe };
}

describe("the matter balances report", () => {
  it("puts each owner's figure on its matter, and each column totals to its owner's total", async () => {
    const { fixture, alder, alderEstate, washoe } = await book();
    const options = { computedAt: COMPUTED_AT };
    const report = await assembleMatterBalances(fixture.database, { locationId: null }, options);

    const workInProgress = await assembleWorkInProgress(
      fixture.database,
      { locationId: null },
      options,
    );
    const aging = await assembleAccountsReceivableAging(
      fixture.database,
      { asOfDate: "2026-08-05", knownAsOf: COMPUTED_AT, locationId: null },
      options,
    );
    const { results } = await selectTrustClientLedgerTotalAsOfStatement(
      fixture.database,
      fixture.trustAccountId,
      "2026-08-05",
    ).all<{ total_minor: number }>();

    expect(report.asOfDate).toBe("2026-08-05");
    expect(report.reproducible).toBe(false);
    expect(report.totals).toEqual({
      unbilledMinor: workInProgress.totals.totalMinor,
      owedMinor: aging.totals.totalMinor,
      trustMinor: results[0]?.total_minor,
    });
    expect(report.totals).toEqual({ unbilledMinor: 600_00, owedMinor: 600_00, trustMinor: 950_00 });

    const figuresOf = (matterId: string) =>
      report.clients
        .flatMap((client) => client.matters)
        .find((matter) => matter.matterId === matterId)?.figures;
    expect(figuresOf(alder)).toEqual({
      unbilledMinor: 400_00,
      owedMinor: 600_00,
      trustMinor: 800_00,
    });
    expect(figuresOf(alderEstate)).toEqual({ unbilledMinor: 0, owedMinor: 0, trustMinor: 150_00 });
    expect(figuresOf(washoe)).toEqual({ unbilledMinor: 200_00, owedMinor: 0, trustMinor: 0 });

    const alderClient = report.clients.find((client) => client.clientEntityId === "entity_alder");
    expect(alderClient?.matters).toHaveLength(2);
    expect(alderClient?.figures).toEqual({
      unbilledMinor: 400_00,
      owedMinor: 600_00,
      trustMinor: 950_00,
    });
    expect(report.offices).toHaveLength(2);
  });

  it("narrows to one office without changing who may run it", async () => {
    const { fixture, washoe } = await book();
    const report = await assembleMatterBalances(
      fixture.database,
      { locationId: fixture.locationId },
      { computedAt: COMPUTED_AT },
    );
    expect(
      report.clients.flatMap((client) => client.matters.map((matter) => matter.matterId)),
    ).toEqual([washoe]);
    expect(report.totals).toEqual({ unbilledMinor: 200_00, owedMinor: 0, trustMinor: 0 });
    expect(report.offices).toEqual([
      { locationId: fixture.locationId, locationName: "Reno", figures: report.totals },
    ]);
  });
});
