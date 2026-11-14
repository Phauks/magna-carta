import { readAccountsReceivableAgingAsOf } from "@magna-carta/billing/queries";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import { describe, expect, it } from "vitest";
import { assembleAccountsReceivableAging } from "../src/financial/accounts-receivable-aging.ts";
import { reportingFixture, seedMatter, type ReportingFixture } from "./support.ts";

// THE AGING DECOMPOSITION. Billing owns the firm-wide buckets; the report adds billing's breakdown rows
// into offices, clients and matters. These tests prove those additions equal billing's buckets, which
// is the condition a decomposition ships on. The as-of read's agreement with the live read is proved
// next to it, in packages/billing/test/aging-as-of.test.ts.

const COMPUTED_AT = "2026-08-05T15:00:00.000Z";

// A finalized bill written directly: this suite is about the decomposition, not about how a bill is
// finalized, which billing's own suites exercise through the composers.
async function seedBill(
  fixture: ReportingFixture,
  input: {
    readonly client: string;
    readonly matterIds: readonly string[];
    readonly totalMinor: number;
    readonly dueDate: string;
  },
): Promise<void> {
  const invoiceId = newIdentifier("invoice");
  const at = "2026-03-01T09:00:00.000Z";
  await fixture.database
    .prepare(
      "INSERT INTO invoice (id, client_entity_id, currency, status, invoice_number, number_scope_key, number_drawn_value, issue_date, due_date, finalized_at, created_at, updated_at) VALUES (?1, ?2, 'USD', 'final', ?3, '', 1, '2026-03-01', ?4, ?5, ?5, ?5)",
    )
    .bind(invoiceId, input.client, invoiceId.slice(-6), input.dueDate, at)
    .run();
  for (const matterId of input.matterIds) {
    await fixture.database
      .prepare(
        "INSERT INTO invoice_matter_balance (invoice_id, matter_id, total_minor, applied_minor, currency, created_at, updated_at) VALUES (?1, ?2, ?3, 0, 'USD', ?4, ?4)",
      )
      .bind(invoiceId, matterId, input.totalMinor, at)
      .run();
  }
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
  const alderLease = await seedMatter(
    fixture,
    "Alder lease",
    "entity_alder",
    "2026-02-01T09:00:00.000Z",
  );
  const washoe = await seedMatter(fixture, "Washoe", "entity_washoe", "2026-02-01T09:00:00.000Z");
  await fixture.database.batch([
    fixture.database
      .prepare("UPDATE matter SET location_id = ?1 WHERE id IN (?2, ?3)")
      .bind(fixture.locationId, alder, alderLease),
    fixture.database
      .prepare("UPDATE matter SET location_id = ?1 WHERE id = ?2")
      .bind(carson, washoe),
  ]);
  // One bill spanning two matters of the same client, so a per-client roll-up is exercised.
  await seedBill(fixture, {
    client: "entity_alder",
    matterIds: [alder, alderLease],
    totalMinor: 40_000,
    dueDate: "2026-07-20",
  });
  await seedBill(fixture, {
    client: "entity_alder",
    matterIds: [alder],
    totalMinor: 25_000,
    dueDate: "2026-09-01",
  });
  await seedBill(fixture, {
    client: "entity_washoe",
    matterIds: [washoe],
    totalMinor: 60_000,
    dueDate: "2026-04-01",
  });
  return { fixture, carson };
}

describe("the accounts-receivable aging report", () => {
  it("decomposes into offices, clients and matters that each sum to billing's buckets", async () => {
    const { fixture } = await book();
    const report = await assembleAccountsReceivableAging(
      fixture.database,
      { asOfDate: "2026-08-05", knownAsOf: null, locationId: null },
      { computedAt: COMPUTED_AT },
    );
    const owned = await readAccountsReceivableAgingAsOf(fixture.database, {
      asOfDate: "2026-08-05",
      knownAsOf: COMPUTED_AT,
    });
    const ownedFigures = owned.buckets.map((bucket) => bucket.unpaidMinor);
    expect(report.totals.unpaidMinor).toEqual(ownedFigures);

    const columnSums = (rows: readonly { readonly unpaidMinor: readonly number[] }[]) =>
      [0, 1, 2, 3, 4].map((index) =>
        rows.reduce((total, row) => total + (row.unpaidMinor[index] ?? 0), 0),
      );
    expect(columnSums(report.offices)).toEqual(ownedFigures);
    expect(columnSums(report.clients)).toEqual(ownedFigures);
    expect(columnSums(report.clients.flatMap((client) => client.matters))).toEqual(ownedFigures);
    expect(report.totals.invoiceCount).toEqual(owned.buckets.map((bucket) => bucket.invoiceCount));
    expect(report.totals.totalMinor).toBe(40_000 * 2 + 25_000 + 60_000);
  });

  it("narrows to one office without changing any of that office's figures", async () => {
    const { fixture, carson } = await book();
    const whole = await assembleAccountsReceivableAging(
      fixture.database,
      { asOfDate: "2026-08-05", knownAsOf: null, locationId: null },
      { computedAt: COMPUTED_AT },
    );
    const narrowed = await assembleAccountsReceivableAging(
      fixture.database,
      { asOfDate: "2026-08-05", knownAsOf: null, locationId: carson },
      { computedAt: COMPUTED_AT },
    );
    const carsonInWhole = whole.offices.find((office) => office.locationId === carson);
    expect(narrowed.offices).toEqual([carsonInWhole]);
    expect(narrowed.totals.unpaidMinor).toEqual(carsonInWhole?.unpaidMinor);
    // A bill can span offices, so a per-office bill count would count it twice; none is given.
    expect(narrowed.totals.invoiceCount).toBeNull();
  });

  it("states that a report without a knowledge instant is live, and one with it reproduces", async () => {
    const { fixture } = await book();
    const live = await assembleAccountsReceivableAging(
      fixture.database,
      { asOfDate: "2026-07-31", knownAsOf: null, locationId: null },
      { computedAt: COMPUTED_AT },
    );
    expect(live.reproducibility.reproducible).toBe(false);
    const pinned = await assembleAccountsReceivableAging(
      fixture.database,
      { asOfDate: "2026-07-31", knownAsOf: "2026-08-01T06:59:59.999Z", locationId: null },
      { computedAt: COMPUTED_AT },
    );
    expect(pinned.reproducibility).toMatchObject({
      reproducible: true,
      knownAsOf: "2026-08-01T06:59:59.999Z",
    });
  });
});
