import { newIdentifier } from "@magna-carta/identifiers/generate";
import { describe, expect, it } from "vitest";
import { readAccountsReceivableAging } from "../src/queries.ts";
import { billingFixture, clock, seedMatter, type BillingFixture } from "./support.ts";

const ACME = "directoryOrganization_acme";

// A finalized invoice with a due date and one matter balance, written directly: this suite is about
// what the aging read computes, not about how a bill gets there, and the finalize path is exercised
// exhaustively next door.
async function seedFinalizedInvoice(
  fixture: BillingFixture,
  dueDate: string,
  totalMinor: number,
  appliedMinor = 0,
): Promise<void> {
  const invoiceId = newIdentifier("invoice");
  const matterId = await seedMatter(fixture, ACME, "Acme");
  // A final invoice's paired CHECKs require its number, its draw, its issue date, and its
  // finalization instant to all be present together — the table refuses a half-finalized row.
  const invoiceNumber = invoiceId.slice(-5);
  await fixture.database
    .prepare(
      "INSERT INTO invoice (id, client_entity_id, currency, status, invoice_number, number_scope_key, number_drawn_value, issue_date, due_date, finalized_at, created_at, updated_at) VALUES (?1, ?2, 'USD', 'final', ?3, '', 1, '2026-01-02', ?4, ?5, ?5, ?5)",
    )
    .bind(invoiceId, ACME, invoiceNumber, dueDate, clock.now())
    .run();
  await fixture.database
    .prepare(
      "INSERT INTO invoice_matter_balance (invoice_id, matter_id, total_minor, applied_minor, currency, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, 'USD', ?5, ?5)",
    )
    .bind(invoiceId, matterId, totalMinor, appliedMinor, clock.now())
    .run();
}

describe("the accounts-receivable aging read", () => {
  // The bucketing happens in SQL and five rows come back. The obvious shape — every finalized
  // invoice plus a correlated unpaid-balance subquery per row, streamed into the Worker and added up
  // in JavaScript — reads the firm's whole billing history to produce five integers, and there is no
  // size at which that degrades gracefully. What is asserted here is the ANSWER; that it is computed
  // without reading paid invoices out of the database is the point of the shape.
  it("buckets by days past due, and a fully applied invoice is not carried out of the database", async () => {
    const fixture = await billingFixture();
    // As of 2026-08-05: not yet due, 20 days over, 45 days over, 75 days over, 200 days over.
    await seedFinalizedInvoice(fixture, "2026-09-01", 10_000);
    await seedFinalizedInvoice(fixture, "2026-07-16", 20_000);
    await seedFinalizedInvoice(fixture, "2026-06-21", 30_000);
    await seedFinalizedInvoice(fixture, "2026-05-22", 40_000);
    await seedFinalizedInvoice(fixture, "2026-01-17", 50_000);
    // Paid in full, and long overdue — it must not appear in any bucket.
    await seedFinalizedInvoice(fixture, "2026-01-17", 99_000, 99_000);

    const buckets = await readAccountsReceivableAging(fixture.database, "2026-08-05");
    expect(buckets).toEqual([
      { label: "current", invoiceCount: 1, unpaidMinor: 10_000 },
      { label: "1-30", invoiceCount: 1, unpaidMinor: 20_000 },
      { label: "31-60", invoiceCount: 1, unpaidMinor: 30_000 },
      { label: "61-90", invoiceCount: 1, unpaidMinor: 40_000 },
      { label: "90+", invoiceCount: 1, unpaidMinor: 50_000 },
    ]);
  });

  it("returns five zeroed buckets when the firm has issued nothing", async () => {
    const fixture = await billingFixture();
    const buckets = await readAccountsReceivableAging(fixture.database, "2026-08-05");
    expect(buckets.map((bucket) => bucket.label)).toEqual([
      "current",
      "1-30",
      "31-60",
      "61-90",
      "90+",
    ]);
    expect(buckets.every((bucket) => bucket.invoiceCount === 0 && bucket.unpaidMinor === 0)).toBe(
      true,
    );
  });

  it("sums several invoices into one bucket", async () => {
    const fixture = await billingFixture();
    await seedFinalizedInvoice(fixture, "2026-07-16", 20_000);
    await seedFinalizedInvoice(fixture, "2026-07-20", 5_000, 1_000);

    const buckets = await readAccountsReceivableAging(fixture.database, "2026-08-05");
    expect(buckets[1]).toEqual({ label: "1-30", invoiceCount: 2, unpaidMinor: 24_000 });
  });
});
