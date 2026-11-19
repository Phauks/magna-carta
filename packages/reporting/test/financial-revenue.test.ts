import { newIdentifier } from "@magna-carta/identifiers/generate";
import { fromMinor, toMinor } from "@magna-carta/money/format";
import { sum, USD } from "@magna-carta/money/money";
import { describe, expect, it } from "vitest";
import { assembleInvoiceRegister } from "../src/financial/invoice-register.ts";
import { assemblePaymentsApplied } from "../src/financial/payments-applied.ts";
import { assembleRevenue, isCreditApplication } from "../src/financial/revenue.ts";
import { reportingFixture, seedMatter, type ReportingFixture } from "./support.ts";

// REVENUE. Billed is the Invoices report's billed figure and collected is the collection columns of
// the Payments Applied report, over the same period and knowledge instant; every breakdown (office,
// matter type, responsible attorney) adds up to the totals.

const COMPUTED_AT = "2026-08-05T15:00:00.000Z";
const JULY = { periodStart: "2026-07-01", periodEnd: "2026-07-31" };
const totalOf = (minors: readonly number[]): number =>
  minors.length === 0 ? 0 : toMinor(sum(minors.map((minor) => fromMinor(minor, USD))));

async function bill(
  fixture: ReportingFixture,
  client: string,
  matters: readonly { readonly matterId: string; readonly totalMinor: number }[],
  issueDate: string,
): Promise<string> {
  const invoiceId = newIdentifier("invoice");
  const at = `${issueDate}T09:00:00.000Z`;
  await fixture.database
    .prepare(
      "INSERT INTO invoice (id, client_entity_id, currency, status, invoice_number, number_scope_key, number_drawn_value, issue_date, due_date, finalized_at, created_at, updated_at) VALUES (?1, ?2, 'USD', 'final', ?3, '', 1, ?5, ?5, ?4, ?4, ?4)",
    )
    .bind(invoiceId, client, invoiceId.slice(-6), at, issueDate)
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

/** A payment or a write-off (each records its own posting), or a reversal of one. */
async function apply(
  fixture: ReportingFixture,
  application: {
    readonly invoiceId: string;
    readonly matterId: string;
    readonly kind: "payment" | "write_off" | "reversal";
    readonly amountMinor: number;
    readonly effectiveDate: string;
    readonly reverses?: string;
  },
): Promise<string> {
  const entryId = newIdentifier("ledgerEntry");
  const at = `${application.effectiveDate}T12:00:00.000Z`;
  await fixture.database
    .prepare(
      "INSERT INTO ledger_entry (id, description, effective_date, recorded_at) VALUES (?1, 'Application', ?2, ?3)",
    )
    .bind(entryId, application.effectiveDate, at)
    .run();
  const applicationId = newIdentifier("invoiceApplication");
  await fixture.database
    .prepare(
      "INSERT INTO invoice_application (id, invoice_id, matter_id, kind, amount_minor, currency, entry_id, effective_date, applied_at, reverses_application_id, reason) VALUES (?1, ?2, ?3, ?4, ?5, 'USD', ?6, ?7, ?8, ?9, ?10)",
    )
    .bind(
      applicationId,
      application.invoiceId,
      application.matterId,
      application.kind,
      application.amountMinor,
      entryId,
      application.effectiveDate,
      at,
      application.reverses ?? null,
      application.kind === "payment" ? null : "Recorded in error",
    )
    .run();
  return applicationId;
}

async function book() {
  const fixture = await reportingFixture();
  const at = "2026-02-01T09:00:00.000Z";
  const database = fixture.database;
  const carsonId = newIdentifier("location");
  await database.batch([
    database
      .prepare(
        "INSERT INTO location (id, name, status, created_at, updated_at) VALUES (?1, 'Carson City', 'active', ?2, ?2)",
      )
      .bind(carsonId, at),
    database
      .prepare(
        "INSERT INTO member (user_id, display_name, status, created_at) VALUES ('user_second_attorney', 'Second Attorney', 'active', ?1)",
      )
      .bind(at),
    database
      .prepare(
        "INSERT INTO matter_type (id, name, active, created_at, updated_at) VALUES ('matter_type_family', 'Family law', 1, ?1, ?1)",
      )
      .bind(at),
  ]);
  const alderOne = await seedMatter(fixture, "Alder one", "entity_alder", at);
  const alderTwo = await seedMatter(fixture, "Alder two", "entity_alder", at);
  const washoe = await seedMatter(fixture, "Washoe", "entity_washoe", at);
  await database
    .prepare(
      "UPDATE matter SET matter_type_id = 'matter_type_family', location_id = ?2 WHERE id = ?1",
    )
    .bind(alderOne, fixture.locationId)
    .run();
  await database
    .prepare(
      "UPDATE matter SET location_id = ?2, responsible_member_id = 'user_second_attorney' WHERE id = ?1",
    )
    .bind(washoe, carsonId)
    .run();

  const alderBill = await bill(
    fixture,
    "entity_alder",
    [
      { matterId: alderOne, totalMinor: 60_000 },
      { matterId: alderTwo, totalMinor: 20_000 },
    ],
    "2026-07-10",
  );
  const washoeBill = await bill(
    fixture,
    "entity_washoe",
    [{ matterId: washoe, totalMinor: 30_000 }],
    "2026-07-11",
  );
  // A June bill: not billed in July, but its July payment is collected in July.
  const juneBill = await bill(
    fixture,
    "entity_washoe",
    [{ matterId: washoe, totalMinor: 9_000 }],
    "2026-06-20",
  );

  await apply(fixture, {
    invoiceId: alderBill,
    matterId: alderOne,
    kind: "payment",
    amountMinor: 25_000,
    effectiveDate: "2026-07-12",
  });
  const mistaken = await apply(fixture, {
    invoiceId: alderBill,
    matterId: alderTwo,
    kind: "payment",
    amountMinor: 4_000,
    effectiveDate: "2026-07-13",
  });
  await apply(fixture, {
    invoiceId: alderBill,
    matterId: alderTwo,
    kind: "reversal",
    amountMinor: 4_000,
    effectiveDate: "2026-07-14",
    reverses: mistaken,
  });
  const writeOff = await apply(fixture, {
    invoiceId: washoeBill,
    matterId: washoe,
    kind: "write_off",
    amountMinor: 3_000,
    effectiveDate: "2026-07-15",
  });
  await apply(fixture, {
    invoiceId: washoeBill,
    matterId: washoe,
    kind: "reversal",
    amountMinor: 1_000,
    effectiveDate: "2026-07-16",
    reverses: writeOff,
  });
  await apply(fixture, {
    invoiceId: juneBill,
    matterId: washoe,
    kind: "payment",
    amountMinor: 9_000,
    effectiveDate: "2026-07-20",
  });
  // After the period: in no July figure.
  await apply(fixture, {
    invoiceId: washoeBill,
    matterId: washoe,
    kind: "payment",
    amountMinor: 5_000,
    effectiveDate: "2026-08-02",
  });
  return { fixture, alderOne, carsonId };
}

describe("the revenue report", () => {
  it("bills what Invoices bills and collects what Payments Applied collects", async () => {
    const { fixture } = await book();
    for (const knownAsOf of [null, "2026-07-14T23:00:00.000Z"]) {
      const input = { ...JULY, knownAsOf, locationId: null };
      const revenue = await assembleRevenue(fixture.database, input, { computedAt: COMPUTED_AT });
      const invoices = await assembleInvoiceRegister(fixture.database, input, {
        computedAt: COMPUTED_AT,
      });
      const applied = await assemblePaymentsApplied(fixture.database, input, {
        computedAt: COMPUTED_AT,
      });
      expect(revenue.totals.billedMinor).toBe(invoices.totals.billedMinor);
      // Collected is the payment, trust and client-credit columns with the reversals of those
      // kinds; credited is the rest. Together they are the Payments Applied total.
      const reversalsOf = (credit: boolean) =>
        totalOf(
          applied.entries
            .filter((entry) => entry.kind === "reversal" && isCreditApplication(entry) === credit)
            .map((entry) => entry.amountMinor),
        );
      expect(revenue.totals.collectedMinor).toBe(
        totalOf([
          applied.totals.paymentMinor,
          applied.totals.trustTransferMinor,
          applied.totals.clientCreditMinor,
          reversalsOf(false),
        ]),
      );
      expect(revenue.totals.creditedMinor).toBe(
        totalOf([applied.totals.creditNoteMinor, applied.totals.writeOffMinor, reversalsOf(true)]),
      );
      expect(totalOf([revenue.totals.collectedMinor, revenue.totals.creditedMinor])).toBe(
        applied.totals.totalMinor,
      );
      expect(revenue.reproducibility).toEqual(invoices.reproducibility);
    }
  });

  it("adds up by office, by matter type and by responsible attorney", async () => {
    const { fixture } = await book();
    const report = await assembleRevenue(
      fixture.database,
      { ...JULY, knownAsOf: null, locationId: null },
      { computedAt: COMPUTED_AT },
    );
    // Billed 110,000; collected 25,000 + 4,000 - 4,000 + 9,000; credited 3,000 - 1,000.
    expect(report.totals).toEqual({
      billedMinor: 110_000,
      collectedMinor: 34_000,
      creditedMinor: 2_000,
    });
    for (const rows of [report.offices, report.matterTypes, report.responsibleAttorneys]) {
      for (const field of ["billedMinor", "collectedMinor", "creditedMinor"] as const) {
        expect(totalOf(rows.map((row) => row.figures[field]))).toBe(report.totals[field]);
      }
    }
    expect(
      report.matterTypes.map((row) => [row.matterTypeName, row.matterCount, row.figures]),
    ).toEqual([
      ["Family law", 1, { billedMinor: 60_000, collectedMinor: 25_000, creditedMinor: 0 }],
      [null, 2, { billedMinor: 50_000, collectedMinor: 9_000, creditedMinor: 2_000 }],
    ]);
    expect(
      report.responsibleAttorneys.map((row) => [row.responsibleName, row.matterCount]),
    ).toEqual([
      ["Responsible Attorney", 2],
      ["Second Attorney", 1],
    ]);
    expect(report.offices.map((row) => row.locationName)).toEqual(["Reno", "Carson City", null]);
    expect(report.attributionStatement).toContain("not counted as collected");
  });

  it("narrows every figure to the chosen office", async () => {
    const { fixture, carsonId } = await book();
    const report = await assembleRevenue(
      fixture.database,
      { ...JULY, knownAsOf: null, locationId: carsonId },
      { computedAt: COMPUTED_AT },
    );
    expect(report.totals).toEqual({
      billedMinor: 30_000,
      collectedMinor: 9_000,
      creditedMinor: 2_000,
    });
    expect(report.responsibleAttorneys.map((row) => row.responsibleName)).toEqual([
      "Second Attorney",
    ]);
  });

  it("counts a reversal in the column of what it reverses", () => {
    expect(isCreditApplication({ kind: "payment", reversesKind: null })).toBe(false);
    expect(isCreditApplication({ kind: "trust_transfer", reversesKind: null })).toBe(false);
    expect(isCreditApplication({ kind: "client_credit", reversesKind: null })).toBe(false);
    expect(isCreditApplication({ kind: "credit_note", reversesKind: null })).toBe(true);
    expect(isCreditApplication({ kind: "write_off", reversesKind: null })).toBe(true);
    expect(isCreditApplication({ kind: "reversal", reversesKind: "payment" })).toBe(false);
    expect(isCreditApplication({ kind: "reversal", reversesKind: "write_off" })).toBe(true);
  });
});
