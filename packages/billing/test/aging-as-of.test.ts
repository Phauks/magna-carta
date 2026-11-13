import type { InvoiceApplicationId } from "@magna-carta/identifiers/types";
import type { ClockPort } from "@magna-carta/ledger/types";
import type { InvoiceId, MatterId } from "@magna-carta/identifiers/types";
import { civilDateOf } from "@magna-carta/civil-time/civil-date";
import { fromMinor, toMinor } from "@magna-carta/money/format";
import { sum, USD } from "@magna-carta/money/money";
import { describe, expect, it } from "vitest";
import { composeApplicationReversal, composeInvoiceWriteOff } from "../src/credit-note.ts";
import { addClaimsToDraft, createInvoiceDraft } from "../src/draft.ts";
import { finalizeInvoice } from "../src/finalize.ts";
import {
  readAccountsReceivableAging,
  readAccountsReceivableAgingAsOf,
  type AccountsReceivableAgingAsOf,
} from "../src/queries.ts";
import {
  billingFixture,
  commit,
  mapAccountRoles,
  seedMatter,
  seedTimeEntry,
  type BillingFixture,
} from "./support.ts";

// THE AGREEMENT TEST for the as-of aging read. The live read owns the answer for today; this read
// answers it for a past date on two axes. At today's date and the present instant the two must agree
// bucket for bucket, and every breakdown must sum to the firm-wide buckets. Every row here is written
// by the real composers — finalize, write-off, reversal — so the applied figure the as-of read
// re-derives from `invoice_application` is tested against the running column those composers moved.

const ROLES = [
  "accounts_receivable",
  "fee_income",
  "fee_adjustments",
  "fee_write_off",
  "client_credit_liability",
] as const;

function clockAt(instant: string): { readonly clock: ClockPort } {
  return { clock: { now: () => instant, today: () => civilDateOf(Date.parse(instant)) } };
}

interface Bill {
  readonly invoiceId: InvoiceId;
  readonly matterId: MatterId;
}

async function finalizedBill(
  fixture: BillingFixture,
  input: {
    readonly client: string;
    readonly label: string;
    readonly amountMinor: number;
    readonly issueDate: string;
    readonly dueDate: string;
    readonly finalizedAt: string;
    readonly matterId?: MatterId;
  },
): Promise<Bill> {
  const options = clockAt(input.finalizedAt);
  const matterId = input.matterId ?? (await seedMatter(fixture, input.client, input.label));
  const timeEntryId = await seedTimeEntry(fixture, matterId, {
    amountMinor: input.amountMinor,
  });
  const draft = createInvoiceDraft(
    fixture.database,
    { clientEntityId: input.client, currency: "USD", createdBy: null },
    options,
  );
  await commit(fixture.database, draft.effect);
  const claimed = await addClaimsToDraft(
    fixture.database,
    draft.invoiceId,
    [{ sourceKind: "time_entry", sourceId: timeEntryId }],
    options,
  );
  await commit(fixture.database, claimed.effect);
  const finalized = await finalizeInvoice(
    fixture.database,
    {
      invoiceId: draft.invoiceId,
      issueDate: input.issueDate,
      dueDate: input.dueDate,
      finalizedBy: null,
    },
    options,
  );
  await commit(fixture.database, finalized.effect);
  return { invoiceId: draft.invoiceId, matterId };
}

async function writeOff(
  fixture: BillingFixture,
  bill: Bill,
  amountMinor: number,
  effectiveDate: string,
  recordedAt: string,
): Promise<InvoiceApplicationId> {
  const writtenOff = await composeInvoiceWriteOff(
    fixture.database,
    {
      invoiceId: bill.invoiceId,
      matterId: bill.matterId,
      amountMinor,
      reason: "Uncollectable",
      effectiveDate,
      writtenOffBy: null,
    },
    clockAt(recordedAt),
  );
  await commit(fixture.database, writtenOff.effect);
  return writtenOff.applicationId;
}

const totalOf = (minors: readonly number[]): number =>
  minors.length === 0 ? 0 : toMinor(sum(minors.map((minor) => fromMinor(minor, USD))));

function breakdownSums(aging: AccountsReceivableAgingAsOf): number[] {
  return [0, 1, 2, 3, 4].map((index) =>
    totalOf(
      aging.breakdown.filter((row) => row.bucketIndex === index).map((row) => row.unpaidMinor),
    ),
  );
}

const total = (buckets: readonly { readonly unpaidMinor: number }[]): number =>
  totalOf(buckets.map((bucket) => bucket.unpaidMinor));

// A book with bills in several buckets, two clients, a matter in a second office, a partial
// write-off, a write-off recorded late with a backdated effective date, and a reversed write-off.
async function book(): Promise<BillingFixture> {
  const fixture = await billingFixture();
  await mapAccountRoles(fixture, ROLES);

  const current = await finalizedBill(fixture, {
    client: "entity_alder",
    label: "Alder",
    amountMinor: 120_000,
    issueDate: "2026-07-20",
    dueDate: "2026-08-20",
    finalizedAt: "2026-07-20T16:00:00.000Z",
  });
  const late = await finalizedBill(fixture, {
    client: "entity_alder",
    label: "Alder lease",
    amountMinor: 80_000,
    issueDate: "2026-05-01",
    dueDate: "2026-05-31",
    finalizedAt: "2026-05-01T16:00:00.000Z",
  });
  const veryLate = await finalizedBill(fixture, {
    client: "entity_washoe",
    label: "Washoe",
    amountMinor: 50_000,
    issueDate: "2026-02-01",
    dueDate: "2026-03-01",
    finalizedAt: "2026-02-01T16:00:00.000Z",
  });
  // The Washoe matter is held at a second office, so the office roll-up is exercised.
  const secondOffice = "location_carson";
  await fixture.database.batch([
    fixture.database
      .prepare(
        "INSERT INTO location (id, name, status, created_at, updated_at) VALUES (?1, 'Carson City', 'active', ?2, ?2)",
      )
      .bind(secondOffice, "2026-01-01T00:00:00.000Z"),
    fixture.database
      .prepare("UPDATE matter SET location_id = ?1 WHERE id = ?2")
      .bind(secondOffice, veryLate.matterId),
  ]);

  // A partial write-off on time.
  await writeOff(fixture, late, 30_000, "2026-06-15", "2026-06-15T10:00:00.000Z");
  // A write-off recorded on 2 August and backdated into July: it moves July's answer only for a
  // reader who knows about it.
  await writeOff(fixture, current, 20_000, "2026-07-25", "2026-08-02T10:00:00.000Z");
  // A write-off, then its reversal: the bill is back to owing the whole amount.
  const reversed = await writeOff(
    fixture,
    veryLate,
    10_000,
    "2026-04-01",
    "2026-04-01T10:00:00.000Z",
  );
  const reversal = await composeApplicationReversal(
    fixture.database,
    {
      applicationId: reversed,
      reason: "Entered against the wrong bill",
      effectiveDate: "2026-04-10",
      reversedBy: null,
    },
    clockAt("2026-04-10T10:00:00.000Z"),
  );
  await commit(fixture.database, reversal.effect);
  return fixture;
}

describe("the accounts-receivable aging as of a date", () => {
  it("equals the live read bucket for bucket at today's date and the present instant", async () => {
    const fixture = await book();
    const live = await readAccountsReceivableAging(fixture.database, "2026-08-05");
    const asOf = await readAccountsReceivableAgingAsOf(fixture.database, {
      asOfDate: "2026-08-05",
      knownAsOf: "2026-08-05T15:00:00.000Z",
    });
    expect(asOf.buckets).toEqual(live);
    // 120,000 less a 20,000 write-off; 80,000 less 30,000; 50,000 written off and reversed.
    expect(total(live)).toBe(200_000);
  });

  it("decomposes into client, matter and office rows that sum to the firm-wide buckets", async () => {
    const fixture = await book();
    const asOf = await readAccountsReceivableAgingAsOf(fixture.database, {
      asOfDate: "2026-08-05",
      knownAsOf: "2026-08-05T15:00:00.000Z",
    });
    expect(asOf.breakdownTruncated).toBe(false);
    expect(breakdownSums(asOf)).toEqual(asOf.buckets.map((bucket) => bucket.unpaidMinor));
    const offices = new Set(asOf.breakdown.map((row) => row.locationName));
    expect(offices).toEqual(new Set([null, "Carson City"]));
  });

  it("does not let a write-off recorded later change the answer as it was known earlier", async () => {
    const fixture = await book();
    const knownAtMonthEnd = await readAccountsReceivableAgingAsOf(fixture.database, {
      asOfDate: "2026-07-31",
      knownAsOf: "2026-07-31T23:59:59.999Z",
    });
    const knownNow = await readAccountsReceivableAgingAsOf(fixture.database, {
      asOfDate: "2026-07-31",
      knownAsOf: "2026-08-05T15:00:00.000Z",
    });
    // Known at month end, the backdated 20,000 write-off had not been recorded.
    expect(total(knownAtMonthEnd.buckets)).toBe(220_000);
    // Known now, it reaches back into July.
    expect(total(knownNow.buckets)).toBe(200_000);
  });

  it("leaves out a bill not yet issued and an application not yet effective at the date", async () => {
    const fixture = await book();
    const inApril = await readAccountsReceivableAgingAsOf(fixture.database, {
      asOfDate: "2026-04-05",
      knownAsOf: "2026-08-05T15:00:00.000Z",
    });
    // Only the Washoe bill was issued by 5 April, and its write-off was in force (the reversal was
    // effective on the 10th): 50,000 less 10,000, 35 days past due.
    expect(inApril.buckets.map((bucket) => bucket.unpaidMinor)).toEqual([0, 0, 40_000, 0, 0]);
  });
});
