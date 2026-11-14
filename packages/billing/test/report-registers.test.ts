import type { InvoiceApplicationId, InvoiceId, MatterId } from "@magna-carta/identifiers/types";
import type { ClockPort } from "@magna-carta/ledger/types";
import { civilDateOf } from "@magna-carta/civil-time/civil-date";
import { fromMinor, toMinor } from "@magna-carta/money/format";
import { subtract, USD } from "@magna-carta/money/money";
import { describe, expect, it } from "vitest";
import { composeApplicationReversal, composeInvoiceWriteOff } from "../src/credit-note.ts";
import { addClaimsToDraft, createInvoiceDraft } from "../src/draft.ts";
import { finalizeInvoice } from "../src/finalize.ts";
import {
  readAccountsReceivableAgingAsOf,
  readApplicationRegister,
  readInvoiceRegister,
} from "../src/queries.ts";
import {
  billingFixture,
  commit,
  mapAccountRoles,
  seedMatter,
  seedTimeEntry,
  type BillingFixture,
} from "./support.ts";

// THE TWO REGISTERS behind the Invoices and Payments Applied reports. Every row is written by the
// real composers (finalize, write-off, reversal), and the register's unpaid share is checked against
// the as-of aging read, which owns "what was unpaid at a date".

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

async function finalizedBill(
  fixture: BillingFixture,
  client: string,
  label: string,
  amountMinor: number,
  issueDate: string,
): Promise<{ readonly invoiceId: InvoiceId; readonly matterId: MatterId }> {
  const options = clockAt(`${issueDate}T09:00:00.000Z`);
  const matterId = await seedMatter(fixture, client, label);
  const timeEntryId = await seedTimeEntry(fixture, matterId, { amountMinor });
  const draft = createInvoiceDraft(
    fixture.database,
    { clientEntityId: client, currency: "USD", createdBy: null },
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
    { invoiceId: draft.invoiceId, issueDate, dueDate: issueDate, finalizedBy: null },
    options,
  );
  await commit(fixture.database, finalized.effect);
  return { invoiceId: draft.invoiceId, matterId };
}

async function book() {
  const fixture = await billingFixture();
  await mapAccountRoles(fixture, ROLES);
  const alder = await finalizedBill(fixture, "entity_alder", "Alder", 100_000, "2026-07-10");
  await finalizedBill(fixture, "entity_washoe", "Washoe", 40_000, "2026-07-20");
  // A bill issued after the period, which neither register's July may show.
  await finalizedBill(fixture, "entity_alder", "Alder later", 9_000, "2026-08-02");

  const writtenOff = await composeInvoiceWriteOff(
    fixture.database,
    {
      invoiceId: alder.invoiceId,
      matterId: alder.matterId,
      amountMinor: 10_000,
      reason: "Agreed discount",
      effectiveDate: "2026-07-15",
      writtenOffBy: null,
    },
    clockAt("2026-07-15T10:00:00.000Z"),
  );
  await commit(fixture.database, writtenOff.effect);
  const second = await composeInvoiceWriteOff(
    fixture.database,
    {
      invoiceId: alder.invoiceId,
      matterId: alder.matterId,
      amountMinor: 5_000,
      reason: "Entered twice",
      effectiveDate: "2026-07-16",
      writtenOffBy: null,
    },
    clockAt("2026-07-16T10:00:00.000Z"),
  );
  await commit(fixture.database, second.effect);
  const reversal = await composeApplicationReversal(
    fixture.database,
    {
      applicationId: second.applicationId as InvoiceApplicationId,
      reason: "Entered twice",
      effectiveDate: "2026-07-17",
      reversedBy: null,
    },
    clockAt("2026-07-17T10:00:00.000Z"),
  );
  await commit(fixture.database, reversal.effect);
  return { fixture, alder };
}

const JULY = { periodStart: "2026-07-01", periodEnd: "2026-07-31" };

describe("the invoice register", () => {
  it("lists the bills issued in the period with what was credited against them", async () => {
    const { fixture, alder } = await book();
    const register = await readInvoiceRegister(fixture.database, {
      ...JULY,
      knownAsOf: "2026-08-05T00:00:00.000Z",
    });
    expect(register.truncated).toBe(false);
    expect(register.rows.map((row) => row.billedMinor)).toEqual([100_000, 40_000]);
    const alderRow = register.rows.find((row) => row.invoiceId === alder.invoiceId);
    // Written off 10,000 and 5,000, the 5,000 then reversed: 10,000 credited, nothing applied.
    expect(alderRow).toMatchObject({ creditedMinor: 10_000, appliedMinor: 0 });
  });

  it("leaves out what was recorded after the knowledge instant", async () => {
    const { fixture, alder } = await book();
    const register = await readInvoiceRegister(fixture.database, {
      ...JULY,
      knownAsOf: "2026-07-15T12:00:00.000Z",
    });
    expect(register.rows.map((row) => row.invoiceId)).toEqual([alder.invoiceId]);
    expect(register.rows[0]).toMatchObject({ creditedMinor: 10_000 });
  });

  it("agrees with the as-of aging on what was unpaid at the period's end", async () => {
    const { fixture } = await book();
    const knownAsOf = "2026-08-05T00:00:00.000Z";
    const register = await readInvoiceRegister(fixture.database, { ...JULY, knownAsOf });
    const aging = await readAccountsReceivableAgingAsOf(fixture.database, {
      asOfDate: "2026-07-31",
      knownAsOf,
    });
    for (const row of register.rows) {
      const usd = (minor: number) => fromMinor(minor, USD);
      const unpaid = toMinor(
        subtract(subtract(usd(row.billedMinor), usd(row.creditedMinor)), usd(row.appliedMinor)),
      );
      const agingRow = aging.breakdown.find((candidate) => candidate.matterId === row.matterId);
      expect(agingRow?.unpaidMinor ?? 0).toBe(unpaid);
    }
  });
});

describe("the application register", () => {
  it("prints a reversal as its own negative row naming what it reverses", async () => {
    const { fixture } = await book();
    const register = await readApplicationRegister(fixture.database, {
      ...JULY,
      knownAsOf: "2026-08-05T00:00:00.000Z",
    });
    expect(
      register.rows.map((row) => [row.kind, row.reversesKind, row.amountMinor, row.effectiveDate]),
    ).toEqual([
      ["write_off", null, 10_000, "2026-07-15"],
      ["write_off", null, 5_000, "2026-07-16"],
      ["reversal", "write_off", -5_000, "2026-07-17"],
    ]);
    expect(register.rows[2]?.reason).toBe("Entered twice");
  });
});
