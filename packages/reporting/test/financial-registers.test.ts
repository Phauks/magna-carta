import { readApplicationRegister, readInvoiceRegister } from "@magna-carta/billing/queries";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import { fromMinor, toMinor } from "@magna-carta/money/format";
import { sum, USD } from "@magna-carta/money/money";
import { describe, expect, it } from "vitest";
import { assembleInvoiceRegister } from "../src/financial/invoice-register.ts";
import { assemblePaymentsApplied } from "../src/financial/payments-applied.ts";
import { reportingFixture, seedMatter, type ReportingFixture } from "./support.ts";

// THE INVOICE AND PAYMENTS-APPLIED DECOMPOSITIONS. Billing owns the rows (and proves them against the
// real composers and the as-of aging in packages/billing/test/report-registers.test.ts); the reports
// add them into bills, clients and offices, and every roll-up must sum to the rows.

const COMPUTED_AT = "2026-08-05T15:00:00.000Z";
const JULY = { periodStart: "2026-07-01", periodEnd: "2026-07-31", knownAsOf: null };
const totalOf = (minors: readonly number[]): number =>
  minors.length === 0 ? 0 : toMinor(sum(minors.map((minor) => fromMinor(minor, USD))));

async function bill(
  fixture: ReportingFixture,
  client: string,
  matters: readonly { readonly matterId: string; readonly totalMinor: number }[],
): Promise<string> {
  const invoiceId = newIdentifier("invoice");
  const at = "2026-07-10T09:00:00.000Z";
  await fixture.database
    .prepare(
      "INSERT INTO invoice (id, client_entity_id, currency, status, invoice_number, number_scope_key, number_drawn_value, issue_date, due_date, finalized_at, created_at, updated_at) VALUES (?1, ?2, 'USD', 'final', ?3, '', 1, '2026-07-10', '2026-08-10', ?4, ?4, ?4)",
    )
    .bind(invoiceId, client, invoiceId.slice(-6), at)
    .run();
  for (const matter of matters) {
    await fixture.database
      .prepare(
        "INSERT INTO invoice_matter_balance (invoice_id, matter_id, total_minor, applied_minor, currency, created_at, updated_at) VALUES (?1, ?2, ?3, 0, 'USD', ?4, ?4)",
      )
      .bind(invoiceId, matter.matterId, matter.totalMinor, at)
      .run();
  }
  return invoiceId;
}

async function payment(
  fixture: ReportingFixture,
  invoiceId: string,
  matterId: string,
  amountMinor: number,
  effectiveDate: string,
): Promise<void> {
  // The posting a payment rides with. Only its header is needed: these reports read the application,
  // never the ledger lines behind it.
  const entryId = newIdentifier("ledgerEntry");
  await fixture.database
    .prepare(
      "INSERT INTO ledger_entry (id, description, effective_date, recorded_at) VALUES (?1, 'Payment', ?2, ?3)",
    )
    .bind(entryId, effectiveDate, `${effectiveDate}T12:00:00.000Z`)
    .run();
  await fixture.database
    .prepare(
      "INSERT INTO invoice_application (id, invoice_id, matter_id, kind, amount_minor, currency, entry_id, effective_date, applied_at) VALUES (?1, ?2, ?3, 'payment', ?4, 'USD', ?7, ?5, ?6)",
    )
    .bind(
      newIdentifier("invoiceApplication"),
      invoiceId,
      matterId,
      amountMinor,
      effectiveDate,
      `${effectiveDate}T12:00:00.000Z`,
      entryId,
    )
    .run();
}

async function book() {
  const fixture = await reportingFixture();
  const at = "2026-02-01T09:00:00.000Z";
  const alderOne = await seedMatter(fixture, "Alder one", "entity_alder", at);
  const alderTwo = await seedMatter(fixture, "Alder two", "entity_alder", at);
  const washoe = await seedMatter(fixture, "Washoe", "entity_washoe", at);
  // One Alder bill charges two matters; Washoe has one bill.
  const alderBill = await bill(fixture, "entity_alder", [
    { matterId: alderOne, totalMinor: 60_000 },
    { matterId: alderTwo, totalMinor: 20_000 },
  ]);
  const washoeBill = await bill(fixture, "entity_washoe", [
    { matterId: washoe, totalMinor: 30_000 },
  ]);
  await payment(fixture, alderBill, alderOne, 25_000, "2026-07-12");
  await payment(fixture, washoeBill, washoe, 30_000, "2026-07-20");
  // Applied after the period: in neither July report.
  await payment(fixture, alderBill, alderTwo, 5_000, "2026-08-02");
  return fixture;
}

describe("the invoices report", () => {
  it("rolls billing's rows into bills, clients and offices that sum to the totals", async () => {
    const fixture = await book();
    const report = await assembleInvoiceRegister(
      fixture.database,
      { ...JULY, locationId: null },
      { computedAt: COMPUTED_AT },
    );
    const { rows } = await readInvoiceRegister(fixture.database, {
      ...JULY,
      knownAsOf: COMPUTED_AT,
    });
    expect(report.totals).toEqual({
      invoiceCount: 2,
      billedMinor: totalOf(rows.map((row) => row.billedMinor)),
      creditedMinor: 0,
      appliedMinor: 55_000,
      unpaidMinor: 55_000,
    });
    const alder = report.clients.find((client) => client.clientEntityId === "entity_alder");
    expect(alder?.figures).toMatchObject({
      invoiceCount: 1,
      billedMinor: 80_000,
      unpaidMinor: 55_000,
    });
    expect(alder?.invoices[0]?.matters.map((matter) => matter.figures.billedMinor)).toEqual([
      60_000, 20_000,
    ]);
    expect(totalOf(report.offices.map((office) => office.figures.billedMinor))).toBe(110_000);
  });
});

describe("the payments applied report", () => {
  it("adds every application in the period by kind, office and client", async () => {
    const fixture = await book();
    const report = await assemblePaymentsApplied(
      fixture.database,
      { ...JULY, locationId: null },
      { computedAt: COMPUTED_AT },
    );
    const { rows } = await readApplicationRegister(fixture.database, {
      ...JULY,
      knownAsOf: COMPUTED_AT,
    });
    expect(report.entries).toHaveLength(rows.length);
    expect(report.totals).toMatchObject({
      entryCount: 2,
      paymentMinor: 55_000,
      trustTransferMinor: 0,
      totalMinor: totalOf(rows.map((row) => row.amountMinor)),
    });
    expect(totalOf(report.clients.map((client) => client.figures.totalMinor))).toBe(55_000);
    expect(report.entries.map((entry) => entry.effectiveDate)).toEqual([
      "2026-07-12",
      "2026-07-20",
    ]);
  });
});
