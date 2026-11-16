import type {
  ClientCreditId,
  InvoiceApplicationId,
  InvoiceId,
  MatterId,
} from "@magna-carta/identifiers/types";
import { fromMinor, toMinor } from "@magna-carta/money/format";
import { add, subtract, sum, USD } from "@magna-carta/money/money";
import { describe, expect, it } from "vitest";
import { applyTrustFundsToInvoices } from "../src/apply-trust-funds.ts";
import {
  applyClientCreditToInvoice,
  composeApplicationReversal,
  composeInvoiceWriteOff,
  issueCreditNote,
} from "../src/credit-note.ts";
import { addClaimsToDraft, createInvoiceDraft } from "../src/draft.ts";
import { finalizeInvoice } from "../src/finalize.ts";
import {
  readAccountsReceivableAgingAsOf,
  readApplicationRegister,
  readClientUnpaidInvoicesAsOf,
  readInvoiceRegister,
} from "../src/queries.ts";
import {
  billingFixture,
  commit,
  depositToMatterTrustLeaf,
  mapAccountRoles,
  options,
  seedMatter,
  seedTimeEntry,
  seedTrustAccount,
  type BillingFixture,
} from "./support.ts";

// ONE CLIENT'S ACCOUNT OVER A PERIOD, taken over billing's own reads: the registers narrowed to the
// client, and the client's unpaid bills as of a date. Every row is written by the real composers, and
// every application kind that has a write path today is exercised: a transfer from trust, a credit
// note, a client credit, a write-off, and the reversal of the two kinds a reversal may unwind here.
// A payment has no write path yet, so it cannot be composed; it moves the as-of aging exactly as a
// write-off does (every non-reversal kind subtracts), which is the property the identity rests on.
//
// The identity a statement of account prints — what was owed the day before the period, plus what
// was billed in it, less what was applied in it (a reversal adding back), equals what was owed at its
// end — is proved here over billing's rows, not assumed.

const ACME = "directoryOrganization_acme";
const BORDEN = "directoryOrganization_borden";
const KNOWN_AS_OF = "2026-09-05T00:00:00.000Z";
const AUGUST = { periodStart: "2026-08-01", periodEnd: "2026-08-31", knownAsOf: KNOWN_AS_OF };

const ROLES = [
  "accounts_receivable",
  "fee_income",
  "fee_adjustments",
  "fee_write_off",
  "client_credit_liability",
  "operating_bank",
] as const;

// Each record is written on the day it takes effect: the ledger refuses an effective date after today.
const on = (date: string) => ({
  clock: { now: () => `${date}T12:00:00.000Z`, today: () => date },
});

const usdOf = (minor: number) => fromMinor(minor, USD);
const totalOf = (minors: readonly number[]): number =>
  minors.length === 0 ? 0 : toMinor(sum(minors.map((minor) => fromMinor(minor, USD))));

async function finalizedBill(
  fixture: BillingFixture,
  client: string,
  amountMinor: number,
  dates: { readonly issueDate: string; readonly dueDate: string },
  matterId?: MatterId,
): Promise<{ readonly invoiceId: InvoiceId; readonly matterId: MatterId }> {
  const billed = matterId ?? (await seedMatter(fixture, client, client));
  const timeEntryId = await seedTimeEntry(fixture, billed, { amountMinor });
  const draft = createInvoiceDraft(
    fixture.database,
    { clientEntityId: client, currency: "USD", createdBy: fixture.memberUserId },
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
    { invoiceId: draft.invoiceId, ...dates, finalizedBy: fixture.memberUserId },
    on(dates.issueDate),
  );
  await commit(fixture.database, finalized.effect);
  return { invoiceId: draft.invoiceId, matterId: billed };
}

async function writeOff(
  fixture: BillingFixture,
  bill: { readonly invoiceId: InvoiceId; readonly matterId: MatterId },
  amountMinor: number,
  effectiveDate: string,
): Promise<InvoiceApplicationId> {
  const composed = await composeInvoiceWriteOff(
    fixture.database,
    { ...bill, amountMinor, reason: "Agreed discount", effectiveDate, writtenOffBy: null },
    on(effectiveDate),
  );
  await commit(fixture.database, composed.effect);
  return composed.applicationId;
}

async function reverse(
  fixture: BillingFixture,
  applicationId: InvoiceApplicationId,
  effectiveDate: string,
): Promise<void> {
  const composed = await composeApplicationReversal(
    fixture.database,
    { applicationId, reason: "Recorded in error", effectiveDate, reversedBy: null },
    on(effectiveDate),
  );
  await commit(fixture.database, composed.effect);
}

async function book() {
  const fixture = await billingFixture();
  await mapAccountRoles(fixture, [...ROLES]);

  // Owed before August: bill A less a July write-off. Bill C is written off whole in July.
  const billA = await finalizedBill(fixture, ACME, 100_000, {
    issueDate: "2026-07-10",
    dueDate: "2026-08-09",
  });
  await writeOff(fixture, billA, 10_000, "2026-07-20");
  const billC = await finalizedBill(fixture, ACME, 30_000, {
    issueDate: "2026-07-15",
    dueDate: "2026-08-14",
  });
  await writeOff(fixture, billC, 30_000, "2026-07-25");

  // Billed in August.
  const billB = await finalizedBill(fixture, ACME, 50_000, {
    issueDate: "2026-08-03",
    dueDate: "2026-09-02",
  });
  // Another client's bill and payment-in-kind, which ACME's statement must never show.
  const borden = await finalizedBill(fixture, BORDEN, 70_000, {
    issueDate: "2026-08-04",
    dueDate: "2026-09-03",
  });
  await writeOff(fixture, borden, 7_000, "2026-08-04");

  // Applied in August: a transfer from trust on A.
  const trustAccountId = await seedTrustAccount(fixture);
  await depositToMatterTrustLeaf(fixture, trustAccountId, billA.matterId, 20_000);
  const transfer = await applyTrustFundsToInvoices(
    fixture.database,
    {
      trustAccountId,
      matterId: billA.matterId,
      applications: [{ invoiceId: billA.invoiceId, amountMinor: 20_000 }],
      currency: "USD",
      effectiveDate: "2026-08-05",
      trustDescription: "Earned fees transferred to operating",
      operatingDescription: "Earned fees received from trust",
      appliedBy: fixture.memberUserId,
    },
    options,
  );
  await commit(fixture.database, transfer.effect);

  // A credit note on A, which the bill absorbs.
  const noteOnA = await issueCreditNote(
    fixture.database,
    {
      invoiceId: billA.invoiceId,
      reason: "Duplicated research time",
      effectiveDate: "2026-08-04",
      lines: [
        {
          matterId: billA.matterId,
          kind: "adjustment",
          description: "Duplicated research time",
          amountMinor: 15_000,
        },
      ],
      issuedBy: null,
    },
    on("2026-08-04"),
  );
  await commit(fixture.database, noteOnA.effect);

  // A write-off on B, reversed.
  await reverse(fixture, await writeOff(fixture, billB, 5_000, "2026-08-06"), "2026-08-08");

  // A credit note on C, already written off whole, which opens a client credit instead of applying;
  // the credit is then set against B and the setting-off reversed.
  const noteOnC = await issueCreditNote(
    fixture.database,
    {
      invoiceId: billC.invoiceId,
      reason: "Charged at the wrong rate",
      effectiveDate: "2026-08-09",
      lines: [
        {
          matterId: billC.matterId,
          kind: "adjustment",
          description: "Charged at the wrong rate",
          amountMinor: 10_000,
        },
      ],
      issuedBy: null,
    },
    on("2026-08-09"),
  );
  await commit(fixture.database, noteOnC.effect);
  const clientCreditId = noteOnC.matters[0]?.clientCreditId as ClientCreditId;
  const setOff = await applyClientCreditToInvoice(
    fixture.database,
    {
      clientCreditId,
      invoiceId: billB.invoiceId,
      matterId: billB.matterId,
      amountMinor: 8_000,
      effectiveDate: "2026-08-10",
      appliedBy: null,
    },
    on("2026-08-10"),
  );
  await commit(fixture.database, setOff.effect);
  await reverse(fixture, setOff.applicationId, "2026-08-12");

  // Applied after the period: in no August figure.
  await writeOff(fixture, billB, 1_000, "2026-09-02");
  return { fixture, billA, billB, billC };
}

describe("a client's account over a period", () => {
  it("narrows both registers to the client in SQL", async () => {
    const { fixture } = await book();
    const bills = await readInvoiceRegister(fixture.database, { ...AUGUST, clientEntityId: ACME });
    expect(bills.rows.map((row) => [row.clientEntityId, row.billedMinor])).toEqual([
      [ACME, 50_000],
    ]);
    const applications = await readApplicationRegister(fixture.database, {
      ...AUGUST,
      clientEntityId: ACME,
    });
    expect(applications.rows.map((row) => [row.kind, row.reversesKind, row.amountMinor])).toEqual([
      ["credit_note", null, 15_000],
      ["trust_transfer", null, 20_000],
      ["write_off", null, 5_000],
      ["reversal", "write_off", -5_000],
      ["client_credit", null, 8_000],
      ["reversal", "client_credit", -8_000],
    ]);
    // Absent, the firm: Borden's bill and write-off come back too.
    const firm = await readApplicationRegister(fixture.database, AUGUST);
    expect(firm.rows).toHaveLength(applications.rows.length + 1);
  });

  it("lists the client's unpaid bills as the as-of aging counts them", async () => {
    const { fixture, billA, billB } = await book();
    const unpaid = await readClientUnpaidInvoicesAsOf(fixture.database, {
      asOfDate: "2026-08-31",
      knownAsOf: KNOWN_AS_OF,
      clientEntityId: ACME,
    });
    expect(unpaid.rows.map((row) => [row.invoiceId, row.unpaidMinor])).toEqual([
      [billA.invoiceId, 55_000],
      [billB.invoiceId, 50_000],
    ]);
    const aging = await readAccountsReceivableAgingAsOf(fixture.database, {
      asOfDate: "2026-08-31",
      knownAsOf: KNOWN_AS_OF,
    });
    const acmeInAging = aging.breakdown.filter((row) => row.clientEntityId === ACME);
    expect(totalOf(unpaid.rows.map((row) => row.unpaidMinor))).toBe(
      totalOf(acmeInAging.map((row) => row.unpaidMinor)),
    );
  });

  it("holds opening plus billed less applied equal to closing, over every kind", async () => {
    const { fixture } = await book();
    const unpaidAt = async (asOfDate: string) =>
      totalOf(
        (
          await readClientUnpaidInvoicesAsOf(fixture.database, {
            asOfDate,
            knownAsOf: KNOWN_AS_OF,
            clientEntityId: ACME,
          })
        ).rows.map((row) => row.unpaidMinor),
      );
    const opening = await unpaidAt("2026-07-31");
    const closing = await unpaidAt("2026-08-31");
    const billed = totalOf(
      (await readInvoiceRegister(fixture.database, { ...AUGUST, clientEntityId: ACME })).rows.map(
        (row) => row.billedMinor,
      ),
    );
    const applied = totalOf(
      (
        await readApplicationRegister(fixture.database, { ...AUGUST, clientEntityId: ACME })
      ).rows.map((row) => row.amountMinor),
    );
    expect([opening, billed, applied, closing]).toEqual([90_000, 50_000, 35_000, 105_000]);
    expect(toMinor(subtract(add(usdOf(opening), usdOf(billed)), usdOf(applied)))).toBe(closing);
  });
});
