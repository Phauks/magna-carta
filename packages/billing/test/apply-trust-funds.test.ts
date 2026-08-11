import type { InvoiceId, MatterId, TrustAccountId } from "@magna-carta/identifiers/types";
import { describe, expect, it } from "vitest";
import { applyTrustFundsToInvoices } from "../src/apply-trust-funds.ts";
import { BillingValidationError } from "../src/billing-validation.ts";
import { composeInvoiceApplication } from "../src/application.ts";
import { addClaimsToDraft, createInvoiceDraft } from "../src/draft.ts";
import {
  invoiceMatterBalancesDisagreeingWithApplicationsStatement,
  accountsReceivableTieOutStatement,
  trustApplicationsWithoutExactlyOneReceivableCreditStatement,
} from "../src/fitness.ts";
import { MAXIMUM_INVOICES_PER_TRUST_APPLICATION } from "../src/earned-fee.ts";
import { finalizeInvoice } from "../src/finalize.ts";
import { readInvoiceApplications, readInvoiceMatterBalances } from "../src/statements.ts";
import {
  billingFixture,
  commit,
  depositToMatterTrustLeaf,
  expectRefusal,
  mapAccountRoles,
  options,
  readOneRow,
  seedMatter,
  seedTimeEntry,
  seedTrustAccount,
  type BillingFixture,
} from "./support.ts";

const ACME = "directoryOrganization_acme";
const BORDEN = "directoryOrganization_borden";

const FINALIZE_DATES = { issueDate: "2026-08-05", dueDate: "2026-09-04" } as const;

// The roles a transfer out of trust resolves: the receivable it pays down and the firm's own bank the
// money lands in. Nothing else — a fee-only bill is not made to map a hard-cost account.
const APPLY_ROLES = ["accounts_receivable", "fee_income", "operating_bank"] as const;

interface FinalizedBill {
  readonly invoiceId: InvoiceId;
  readonly matterId: MatterId;
  readonly totalMinor: number;
}

// A finalized, fee-only invoice for one matter, at a stated amount to the penny.
async function finalizedBill(
  fixture: BillingFixture,
  clientEntityId: string,
  amountMinor: number,
  matterId?: MatterId,
): Promise<FinalizedBill> {
  const billedMatterId = matterId ?? (await seedMatter(fixture, clientEntityId, "Acme"));
  const timeEntryId = await seedTimeEntry(fixture, billedMatterId, { amountMinor });
  const draft = createInvoiceDraft(
    fixture.database,
    { clientEntityId, currency: "USD", createdBy: fixture.memberUserId },
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
    { invoiceId: draft.invoiceId, ...FINALIZE_DATES, finalizedBy: fixture.memberUserId },
    options,
  );
  await commit(fixture.database, finalized.effect);
  expect(finalized.totalMinor).toBe(amountMinor);
  return { invoiceId: draft.invoiceId, matterId: billedMatterId, totalMinor: amountMinor };
}

interface FundedMatter {
  readonly fixture: BillingFixture;
  readonly trustAccountId: TrustAccountId;
  readonly bill: FinalizedBill;
}

// A firm with its roles mapped, a finalized bill, and the client's money sitting in trust against
// that matter.
async function fundedMatter(
  billMinor: number,
  trustMinor: number,
  clientEntityId = ACME,
): Promise<FundedMatter> {
  const fixture = await billingFixture();
  await mapAccountRoles(fixture, [...APPLY_ROLES]);
  const bill = await finalizedBill(fixture, clientEntityId, billMinor);
  const trustAccountId = await seedTrustAccount(fixture);
  await depositToMatterTrustLeaf(fixture, trustAccountId, bill.matterId, trustMinor);
  return { fixture, trustAccountId, bill };
}

function applyInput(
  funded: FundedMatter,
  applications: readonly { invoiceId: InvoiceId; amountMinor: number }[],
) {
  return {
    trustAccountId: funded.trustAccountId,
    matterId: funded.bill.matterId,
    applications,
    currency: "USD",
    effectiveDate: "2026-08-05",
    trustDescription: "Earned fees transferred to operating",
    operatingDescription: "Earned fees received from trust",
    appliedBy: funded.fixture.memberUserId,
  } as const;
}

async function readAccountBalanceMinor(
  fixture: BillingFixture,
  accountId: string,
): Promise<number> {
  const row = await readOneRow<{ balance_minor: number }>(
    fixture.database,
    "SELECT balance_minor FROM account_balance WHERE account_id = ?1",
    accountId,
  );
  return row?.balance_minor ?? 0;
}

describe("applying trust funds — the earned-fee precondition, satisfied", () => {
  it("moves the money, records the application, and leaves the invoice paid", async () => {
    const funded = await fundedMatter(500_00, 800_00);
    const { fixture, bill } = funded;

    const applied = await applyTrustFundsToInvoices(
      fixture.database,
      applyInput(funded, [{ invoiceId: bill.invoiceId, amountMinor: 500_00 }]),
      options,
    );
    await commit(fixture.database, applied.effect);

    expect(applied.totalMinor).toBe(500_00);
    expect(applied.applicationIds).toHaveLength(1);

    // The bill is paid in full: applied equals total, so nothing further can ever be applied to it —
    // the bounds CHECK sees to that.
    const [balance] = await readInvoiceMatterBalances(fixture.database, bill.invoiceId);
    expect(balance?.totalMinor).toBe(500_00);
    expect(balance?.appliedMinor).toBe(500_00);

    const [application] = await readInvoiceApplications(fixture.database, bill.invoiceId);
    expect(application?.kind).toBe("trust_transfer");
    expect(application?.amountMinor).toBe(500_00);
    expect(application?.trustTransferId).toBe(applied.transferId);

    // The client's trust ledger really went down, and the firm's bank really went up.
    const transfer = await readOneRow<{ amount_minor: number; authorized_by: string }>(
      fixture.database,
      "SELECT amount_minor, authorized_by FROM trust_transfer WHERE id = ?1",
      applied.transferId,
    );
    expect(transfer?.amount_minor).toBe(500_00);
    // Who let the money go is recorded on the transfer, not inferred from the request later.
    expect(transfer?.authorized_by).toBe(fixture.memberUserId);
    expect(await readAccountBalanceMinor(fixture, fixture.operatingBankAccountId)).toBe(500_00);
  });

  // ----------------------------------------------------------------------------------------------
  // THE DEDICATED TEST. A trust application composes NO ledger entry of its own, because trust's
  // transfer already credited accounts receivable on its operating leg. A second credit here would
  // leave the ledger balanced, every entry valid, and nothing failing — while the receivable control
  // account drifted below the invoice subledger by the total of every trust-funded fee, forever.
  // ----------------------------------------------------------------------------------------------
  it("credits accounts receivable exactly once, so the subledger still equals the control account", async () => {
    const funded = await fundedMatter(500_00, 800_00);
    const { fixture, bill } = funded;

    // Before: the finalize posting debited the receivable by the whole bill, and the subledger says
    // the whole bill is unpaid. They agree.
    expect(await readAccountBalanceMinor(fixture, fixture.accountsReceivableAccountId)).toBe(
      500_00,
    );

    const applied = await applyTrustFundsToInvoices(
      fixture.database,
      applyInput(funded, [{ invoiceId: bill.invoiceId, amountMinor: 200_00 }]),
      options,
    );
    await commit(fixture.database, applied.effect);

    // After: the receivable is down by exactly the amount applied — once, not twice. A double credit
    // would read 100_00 here while the subledger read 300_00.
    expect(await readAccountBalanceMinor(fixture, fixture.accountsReceivableAccountId)).toBe(
      300_00,
    );
    const [balance] = await readInvoiceMatterBalances(fixture.database, bill.invoiceId);
    expect(balance!.totalMinor - balance!.appliedMinor).toBe(300_00);

    // And the relationship itself, re-proved over the whole table rather than over these two numbers:
    // the sum of unpaid balances must equal the accounts-receivable control account.
    const tieOut = await accountsReceivableTieOutStatement(fixture.database).all();
    expect(tieOut.results).toEqual([]);

    // Exactly one receivable credit per trust application, counted over stored ledger lines.
    const doubleCredits = await trustApplicationsWithoutExactlyOneReceivableCreditStatement(
      fixture.database,
    ).all();
    expect(doubleCredits.results).toEqual([]);

    // And every balance row's applied figure is the sum of the applications that produced it.
    const drift = await invoiceMatterBalancesDisagreeingWithApplicationsStatement(
      fixture.database,
    ).all();
    expect(drift.results).toEqual([]);
  });

  it("applies partially, to the penny, and leaves exactly the remainder", async () => {
    // Deliberately not a round split: 6,500 against a 2,000 evergreen replenishment, twice.
    const funded = await fundedMatter(6_500_00, 6_500_00);
    const { fixture, bill } = funded;

    const first = await applyTrustFundsToInvoices(
      fixture.database,
      applyInput(funded, [{ invoiceId: bill.invoiceId, amountMinor: 2_000_00 }]),
      options,
    );
    await commit(fixture.database, first.effect);

    let [balance] = await readInvoiceMatterBalances(fixture.database, bill.invoiceId);
    expect(balance?.appliedMinor).toBe(2_000_00);
    expect(balance!.totalMinor - balance!.appliedMinor).toBe(4_500_00);

    // A second, odd-numbered replenishment. Integer minor units throughout, so the remainder is
    // exact rather than an approximation that happens to round well.
    const second = await applyTrustFundsToInvoices(
      fixture.database,
      applyInput(funded, [{ invoiceId: bill.invoiceId, amountMinor: 1_333_33 }]),
      options,
    );
    await commit(fixture.database, second.effect);

    [balance] = await readInvoiceMatterBalances(fixture.database, bill.invoiceId);
    expect(balance?.appliedMinor).toBe(3_333_33);
    expect(balance!.totalMinor - balance!.appliedMinor).toBe(3_166_67);

    // Two applications, two transfers, one invoice, nothing about the invoice itself changed.
    // Compared as a SET rather than a sequence: the read orders by (applied_at, id), and this
    // fixture's clock is frozen, so both rows carry the same instant and the tie-break falls to a
    // generated identifier. Asserting an order the read does not promise is how a suite acquires an
    // intermittent failure that looks like a real one.
    const applications = await readInvoiceApplications(fixture.database, bill.invoiceId);
    expect(applications.map((application) => application.amountMinor).toSorted()).toEqual(
      [2_000_00, 1_333_33].toSorted(),
    );
    expect(new Set(applications.map((application) => application.trustTransferId)).size).toBe(2);

    expect((await accountsReceivableTieOutStatement(fixture.database).all()).results).toEqual([]);
  });

  it("spreads one transfer across two of the same client's invoices", async () => {
    const funded = await fundedMatter(500_00, 900_00);
    const { fixture, bill } = funded;
    // A second bill on the SAME matter, so one transfer out of that matter's leaf settles both.
    const secondBill = await finalizedBill(fixture, ACME, 300_00, bill.matterId);

    const applied = await applyTrustFundsToInvoices(
      fixture.database,
      applyInput(funded, [
        { invoiceId: bill.invoiceId, amountMinor: 500_00 },
        { invoiceId: secondBill.invoiceId, amountMinor: 300_00 },
      ]),
      options,
    );
    await commit(fixture.database, applied.effect);

    expect(applied.totalMinor).toBe(800_00);
    expect(applied.applicationIds).toHaveLength(2);
    // One transfer, two applications — each naming the same transfer.
    for (const invoiceId of [bill.invoiceId, secondBill.invoiceId]) {
      const [application] = await readInvoiceApplications(fixture.database, invoiceId);
      expect(application?.trustTransferId).toBe(applied.transferId);
    }
    expect((await accountsReceivableTieOutStatement(fixture.database).all()).results).toEqual([]);
  });
});

describe("applying trust funds — what it refuses, and why", () => {
  it("refuses a transfer against a draft invoice", async () => {
    const fixture = await billingFixture();
    await mapAccountRoles(fixture, [...APPLY_ROLES]);
    const matterId = await seedMatter(fixture, ACME, "Acme");
    const timeEntryId = await seedTimeEntry(fixture, matterId, { amountMinor: 500_00 });
    const draft = createInvoiceDraft(
      fixture.database,
      { clientEntityId: ACME, currency: "USD", createdBy: fixture.memberUserId },
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

    const trustAccountId = await seedTrustAccount(fixture);
    await depositToMatterTrustLeaf(fixture, trustAccountId, matterId, 800_00);

    // A draft asserts nothing to anybody, has no number, and locks no work. Taking a fee against one
    // is taking a fee against a bill the client has never been charged.
    await expect(
      applyTrustFundsToInvoices(
        fixture.database,
        {
          trustAccountId,
          matterId,
          applications: [{ invoiceId: draft.invoiceId, amountMinor: 500_00 }],
          currency: "USD",
          effectiveDate: "2026-08-05",
          trustDescription: "Earned fees",
          operatingDescription: "Earned fees",
          appliedBy: fixture.memberUserId,
        },
        options,
      ),
    ).rejects.toThrow(expect.objectContaining({ code: "earned-fee-invoice-not-final" }) as Error);

    // And nothing moved: no transfer row, no application, no ledger entry.
    const transfers = await fixture.database.prepare("SELECT id FROM trust_transfer").all();
    expect(transfers.results).toEqual([]);
  });

  it("refuses paying one client's bill out of another client's trust ledger", async () => {
    const funded = await fundedMatter(500_00, 800_00);
    const { fixture } = funded;
    // A bill for a DIFFERENT client, and the money in Acme's ledger.
    const bordenBill = await finalizedBill(fixture, BORDEN, 400_00);

    await expect(
      applyTrustFundsToInvoices(
        fixture.database,
        applyInput(funded, [{ invoiceId: bordenBill.invoiceId, amountMinor: 400_00 }]),
        options,
      ),
    ).rejects.toThrow(
      expect.objectContaining({ code: "earned-fee-invoice-client-mismatch" }) as Error,
    );
  });

  it("refuses an amount above the matter's own unpaid balance", async () => {
    const funded = await fundedMatter(500_00, 900_00);
    // The client has 900 in trust and owes 500. The ceiling is the BILL, not the money.
    await expect(
      applyTrustFundsToInvoices(
        funded.fixture.database,
        applyInput(funded, [{ invoiceId: funded.bill.invoiceId, amountMinor: 600_00 }]),
        options,
      ),
    ).rejects.toThrow(
      expect.objectContaining({ code: "earned-fee-exceeds-unpaid-balance" }) as Error,
    );
  });

  it("refuses an invoice that bills a different matter", async () => {
    const funded = await fundedMatter(500_00, 800_00);
    const { fixture } = funded;
    // Same client, second matter, its own bill — and the money is in the FIRST matter's leaf.
    const otherMatterId = await seedMatter(fixture, ACME, "Acme second");
    const otherBill = await finalizedBill(fixture, ACME, 250_00, otherMatterId);

    await expect(
      applyTrustFundsToInvoices(
        fixture.database,
        applyInput(funded, [{ invoiceId: otherBill.invoiceId, amountMinor: 250_00 }]),
        options,
      ),
    ).rejects.toThrow(
      expect.objectContaining({ code: "earned-fee-invoice-does-not-bill-matter" }) as Error,
    );
  });

  it("refuses a transfer that names no invoice at all", async () => {
    const funded = await fundedMatter(500_00, 800_00);
    await expect(
      applyTrustFundsToInvoices(funded.fixture.database, applyInput(funded, []), options),
    ).rejects.toThrow(expect.objectContaining({ code: "earned-fee-no-applications" }) as Error);
  });

  it("refuses more invoices than one batch should carry", async () => {
    const funded = await fundedMatter(500_00, 800_00);
    // Each named invoice costs two reads to resolve and two statements in the batch. The refusal is
    // named so the caller splits the transfer rather than meeting a slow request or an opaque commit
    // error.
    const tooMany = Array.from({ length: MAXIMUM_INVOICES_PER_TRUST_APPLICATION + 1 }, () => ({
      invoiceId: funded.bill.invoiceId,
      amountMinor: 1,
    }));
    await expect(
      applyTrustFundsToInvoices(funded.fixture.database, applyInput(funded, tooMany), options),
    ).rejects.toThrow(expect.objectContaining({ code: "earned-fee-too-many-invoices" }) as Error);
  });

  it("refuses when money is under a disputed-funds hold, in trust's own words", async () => {
    const funded = await fundedMatter(500_00, 500_00);
    const { fixture, bill } = funded;
    const leaf = await readOneRow<{ id: string }>(
      fixture.database,
      "SELECT id FROM trust_ledger_node WHERE matter_id = ?1",
      bill.matterId,
    );
    // A hold over the whole balance. The ceiling is AVAILABLE, not balance, and billing adds nothing
    // to that rule — it is trust's, and this is trust's refusal reaching a billing caller.
    await fixture.database
      .prepare(
        `INSERT INTO trust_hold (id, node_id, amount_minor, currency, reason, placed_by, placed_at)
         VALUES (?1, ?2, ?3, 'USD', 'Fee dispute', ?4, ?5)`,
      )
      .bind(
        "trustHold_disputed",
        leaf!.id,
        500_00,
        fixture.memberUserId,
        "2026-08-05T15:00:00.000Z",
      )
      .run();

    await expect(
      applyTrustFundsToInvoices(
        fixture.database,
        applyInput(funded, [{ invoiceId: bill.invoiceId, amountMinor: 500_00 }]),
        options,
      ),
    ).rejects.toThrow(expect.objectContaining({ code: "transfer-exceeds-available" }) as Error);
  });

  it("refuses when the firm has not said which account is its operating bank", async () => {
    const fixture = await billingFixture();
    // Everything finalization needs, but not the operating bank a transfer lands in.
    await mapAccountRoles(fixture, ["accounts_receivable", "fee_income"]);
    const bill = await finalizedBill(fixture, ACME, 500_00);
    const trustAccountId = await seedTrustAccount(fixture);
    await depositToMatterTrustLeaf(fixture, trustAccountId, bill.matterId, 800_00);

    await expect(
      applyTrustFundsToInvoices(
        fixture.database,
        {
          trustAccountId,
          matterId: bill.matterId,
          applications: [{ invoiceId: bill.invoiceId, amountMinor: 500_00 }],
          currency: "USD",
          effectiveDate: "2026-08-05",
          trustDescription: "Earned fees",
          operatingDescription: "Earned fees",
          appliedBy: fixture.memberUserId,
        },
        options,
      ),
    ).rejects.toThrow(expect.objectContaining({ code: "account-role-unmapped" }) as Error);
  });
});

describe("the bounds CHECK is the guarantee, not the pre-check", () => {
  // The whole point of the design. Every condition is read before the batch so a refusal reads as a
  // sentence — but the mechanism is the CHECK riding the same batch as the trust entries.
  it("aborts the WHOLE batch when a concurrent application consumes the balance after the read", async () => {
    const funded = await fundedMatter(500_00, 1_000_00);
    const { fixture, bill } = funded;

    // Both compose against the same read: 500 unpaid, 1,000 available. Both pre-checks pass.
    const first = await applyTrustFundsToInvoices(
      fixture.database,
      applyInput(funded, [{ invoiceId: bill.invoiceId, amountMinor: 400_00 }]),
      options,
    );
    const second = await applyTrustFundsToInvoices(
      fixture.database,
      applyInput(funded, [{ invoiceId: bill.invoiceId, amountMinor: 400_00 }]),
      options,
    );

    await commit(fixture.database, first.effect);

    // The second one's pre-check was true when it ran and is false by the time it commits. It does
    // not partially apply and it does not silently no-op: the CHECK aborts the entire batch.
    await expect(expectRefusal(() => commit(fixture.database, second.effect))).rejects.toThrow(
      /invoice_matter_balance_bounds_check|CHECK constraint failed/,
    );

    // AND THE TRUST ENTRIES WENT WITH IT. This is what riding one batch buys: the loser's client
    // money never left the ledger, its transfer row was never written, and the receivable was never
    // credited a second time.
    const [balance] = await readInvoiceMatterBalances(fixture.database, bill.invoiceId);
    expect(balance?.appliedMinor).toBe(400_00);
    const transfers = await fixture.database.prepare("SELECT id FROM trust_transfer").all();
    expect(transfers.results).toHaveLength(1);
    expect((await accountsReceivableTieOutStatement(fixture.database).all()).results).toEqual([]);
  });
});

describe("the one application door", () => {
  it("refuses a kind whose ledger entry nothing composes yet", async () => {
    const fixture = await billingFixture();
    // A payment, a credit note, a client credit, a write-off, and a reversal each owe the ledger an
    // entry, and none of those write paths exist. Letting one through would reduce what a client
    // owes with nothing on the firm's books to match.
    expect(() =>
      composeInvoiceApplication(
        fixture.database,
        {
          invoiceId: "invoice_x" as InvoiceId,
          matterId: "matter_x" as MatterId,
          kind: "payment",
          amountMinor: 100_00,
          currency: "USD",
          effectiveDate: "2026-08-05",
          appliedBy: fixture.memberUserId,
        },
        options,
      ),
    ).toThrow(expect.objectContaining({ code: "application-kind-not-built" }) as Error);
  });

  it("refuses a negative or fractional amount — direction is the kind, never a sign", async () => {
    const fixture = await billingFixture();
    for (const amountMinor of [-100, 0, 12.5]) {
      expect(() =>
        composeInvoiceApplication(
          fixture.database,
          {
            invoiceId: "invoice_x" as InvoiceId,
            matterId: "matter_x" as MatterId,
            kind: "trust_transfer",
            amountMinor,
            currency: "USD",
            effectiveDate: "2026-08-05",
            trustTransferId: null,
            appliedBy: fixture.memberUserId,
          },
          options,
        ),
      ).toThrow(BillingValidationError);
    }
  });

  it("keeps an application append-only once it is written", async () => {
    const funded = await fundedMatter(500_00, 800_00);
    const { fixture, bill } = funded;
    const applied = await applyTrustFundsToInvoices(
      fixture.database,
      applyInput(funded, [{ invoiceId: bill.invoiceId, amountMinor: 500_00 }]),
      options,
    );
    await commit(fixture.database, applied.effect);
    const applicationId = applied.applicationIds[0];

    // Editing an application would let money that reached a bill be quietly un-reached: the balance
    // delta it rode with has already moved.
    await expect(
      expectRefusal(() =>
        fixture.database
          .prepare("UPDATE invoice_application SET amount_minor = 1 WHERE id = ?1")
          .bind(applicationId)
          .run(),
      ),
    ).rejects.toThrow(/append-only/);
    await expect(
      expectRefusal(() =>
        fixture.database
          .prepare("DELETE FROM invoice_application WHERE id = ?1")
          .bind(applicationId)
          .run(),
      ),
    ).rejects.toThrow(/append-only/);
  });
});
