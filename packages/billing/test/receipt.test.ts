import { describe, expect, it } from "vitest";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { InvoiceId, MatterId } from "@magna-carta/identifiers/types";
import { composeApplicationReversal } from "../src/credit-note.ts";
import { addClaimsToDraft, createInvoiceDraft } from "../src/draft.ts";
import { finalizeInvoice } from "../src/finalize.ts";
import {
  accountsReceivableTieOutStatement,
  billingCompositionsWithoutTheirReceivablePostingStatement,
  invoiceMatterBalancesDisagreeingWithApplicationsStatement,
} from "../src/fitness.ts";
import { recordPaymentReceipt } from "../src/receipt.ts";
import { readInvoiceMatterBalances, readPaymentReceiptsForInvoice } from "../src/statements.ts";
import {
  billingFixture,
  commit,
  expectRefusal,
  mapAccountRoles,
  options,
  readOneRow,
  seedMatter,
  seedTimeEntry,
  type BillingFixture,
} from "./support.ts";

const RECEIPT_ROLES = ["accounts_receivable", "fee_income", "operating_bank"] as const;
const FINALIZE_DATES = { issueDate: "2026-08-03", dueDate: "2026-09-04" } as const;

interface FinalizedBill {
  readonly invoiceId: InvoiceId;
  readonly matterId: MatterId;
}

async function finalizedBill(fixture: BillingFixture, amountMinor: number): Promise<FinalizedBill> {
  const matterId = await seedMatter(fixture, "entity_client", "Acme");
  const timeEntryId = await seedTimeEntry(fixture, matterId, { amountMinor });
  const draft = createInvoiceDraft(
    fixture.database,
    { clientEntityId: "entity_client", currency: "USD", createdBy: null },
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
    { invoiceId: draft.invoiceId, ...FINALIZE_DATES, finalizedBy: null },
    options,
  );
  await commit(fixture.database, finalized.effect);
  return { invoiceId: draft.invoiceId, matterId };
}

async function unpaidMinor(fixture: BillingFixture, bill: FinalizedBill): Promise<number> {
  const balances = await readInvoiceMatterBalances(fixture.database, bill.invoiceId);
  const balance = balances.find((row) => row.matterId === bill.matterId);
  if (!balance) throw new Error("the fixture bill has no balance row");
  return balance.totalMinor - balance.appliedMinor;
}

async function accountBalanceMinor(fixture: BillingFixture, accountId: string): Promise<number> {
  const row = await readOneRow<{ balance_minor: number }>(
    fixture.database,
    "SELECT balance_minor FROM account_balance WHERE account_id = ?1",
    accountId,
  );
  return row?.balance_minor ?? 0;
}

async function expectTiedOut(fixture: BillingFixture): Promise<void> {
  for (const statement of [
    accountsReceivableTieOutStatement(fixture.database),
    invoiceMatterBalancesDisagreeingWithApplicationsStatement(fixture.database),
    billingCompositionsWithoutTheirReceivablePostingStatement(fixture.database),
  ]) {
    const { results } = await statement.all();
    expect(results).toEqual([]);
  }
}

describe("a payment recorded by hand", () => {
  it("books the money into the operating bank, brings the bill down, and keeps how it arrived", async () => {
    const fixture = await billingFixture();
    await mapAccountRoles(fixture, RECEIPT_ROLES);
    const bill = await finalizedBill(fixture, 300_000);

    const recorded = await recordPaymentReceipt(
      fixture.database,
      {
        invoiceId: bill.invoiceId,
        matterId: bill.matterId,
        amountMinor: 120_000,
        method: "check",
        reference: "  1043  ",
        effectiveDate: "2026-08-04",
        recordedBy: null,
      },
      options,
    );
    await commit(fixture.database, recorded.effect);

    expect(await unpaidMinor(fixture, bill)).toBe(180_000);
    expect(await accountBalanceMinor(fixture, fixture.operatingBankAccountId)).toBe(120_000);
    const receipts = await readPaymentReceiptsForInvoice(fixture.database, bill.invoiceId);
    expect(receipts).toEqual([
      expect.objectContaining({
        id: recorded.receiptId,
        applicationId: recorded.applicationId,
        amountMinor: 120_000,
        method: "check",
        reference: "1043",
        effectiveDate: "2026-08-04",
        reversedByApplicationId: null,
      }),
    ]);
    await expectTiedOut(fixture);
  });

  it("refuses more than the matter still owes, and a draft, and a date before the bill", async () => {
    const fixture = await billingFixture();
    await mapAccountRoles(fixture, RECEIPT_ROLES);
    const bill = await finalizedBill(fixture, 100_000);
    const base = {
      invoiceId: bill.invoiceId,
      matterId: bill.matterId,
      amountMinor: 100_000,
      method: "cash" as const,
      effectiveDate: "2026-08-04",
      recordedBy: null,
    };

    await expect(
      recordPaymentReceipt(fixture.database, { ...base, amountMinor: 100_001 }, options),
    ).rejects.toMatchObject({ code: "payment-exceeds-unpaid-balance" });
    await expect(
      recordPaymentReceipt(fixture.database, { ...base, effectiveDate: "2026-08-02" }, options),
    ).rejects.toMatchObject({ code: "application-before-invoice-issued" });
    await expect(
      recordPaymentReceipt(fixture.database, { ...base, amountMinor: 0 }, options),
    ).rejects.toMatchObject({ code: "payment-receipt-invalid" });

    const draft = createInvoiceDraft(
      fixture.database,
      { clientEntityId: "entity_client", currency: "USD", createdBy: null },
      options,
    );
    await commit(fixture.database, draft.effect);
    await expect(
      recordPaymentReceipt(fixture.database, { ...base, invoiceId: draft.invoiceId }, options),
    ).rejects.toMatchObject({ code: "invoice-not-final" });

    // Paid in full is fine, and nothing more fits after it.
    const full = await recordPaymentReceipt(fixture.database, base, options);
    await commit(fixture.database, full.effect);
    expect(await unpaidMinor(fixture, bill)).toBe(0);
    await expect(
      recordPaymentReceipt(fixture.database, { ...base, amountMinor: 1 }, options),
    ).rejects.toMatchObject({ code: "payment-exceeds-unpaid-balance" });
  });

  it("refuses when the firm has not said which account is its operating bank", async () => {
    const fixture = await billingFixture();
    await mapAccountRoles(fixture, ["accounts_receivable", "fee_income"]);
    const bill = await finalizedBill(fixture, 100_000);
    await expect(
      recordPaymentReceipt(
        fixture.database,
        {
          invoiceId: bill.invoiceId,
          matterId: bill.matterId,
          amountMinor: 50_000,
          method: "bank_transfer",
          effectiveDate: "2026-08-04",
          recordedBy: null,
        },
        options,
      ),
    ).rejects.toMatchObject({ code: "account-role-unmapped" });
  });

  it("is undone by reversing it, which keeps both records and the books tied out", async () => {
    const fixture = await billingFixture();
    await mapAccountRoles(fixture, RECEIPT_ROLES);
    const bill = await finalizedBill(fixture, 200_000);
    const recorded = await recordPaymentReceipt(
      fixture.database,
      {
        invoiceId: bill.invoiceId,
        matterId: bill.matterId,
        amountMinor: 200_000,
        method: "card_terminal",
        effectiveDate: "2026-08-04",
        recordedBy: null,
      },
      options,
    );
    await commit(fixture.database, recorded.effect);
    const reversed = await composeApplicationReversal(
      fixture.database,
      {
        applicationId: recorded.applicationId,
        reason: "The card was declined after the terminal printed approval",
        effectiveDate: "2026-08-05",
        reversedBy: null,
      },
      options,
    );
    await commit(fixture.database, reversed.effect);

    expect(await unpaidMinor(fixture, bill)).toBe(200_000);
    expect(await accountBalanceMinor(fixture, fixture.operatingBankAccountId)).toBe(0);
    const [receipt] = await readPaymentReceiptsForInvoice(fixture.database, bill.invoiceId);
    expect(receipt?.reversedByApplicationId).toBe(reversed.applicationId);
    await expectTiedOut(fixture);
  });

  it("is append-only, and stands only beside a payment application", async () => {
    const fixture = await billingFixture();
    await mapAccountRoles(fixture, RECEIPT_ROLES);
    const bill = await finalizedBill(fixture, 100_000);
    const recorded = await recordPaymentReceipt(
      fixture.database,
      {
        invoiceId: bill.invoiceId,
        matterId: bill.matterId,
        amountMinor: 40_000,
        method: "check",
        reference: "88",
        effectiveDate: "2026-08-04",
        recordedBy: null,
      },
      options,
    );
    await commit(fixture.database, recorded.effect);

    await expect(
      expectRefusal(() =>
        fixture.database
          .prepare("UPDATE payment_receipt SET reference = '89' WHERE id = ?1")
          .bind(recorded.receiptId)
          .run(),
      ),
    ).rejects.toThrow(/append-only/);
    await expect(
      expectRefusal(() =>
        fixture.database
          .prepare("DELETE FROM payment_receipt WHERE id = ?1")
          .bind(recorded.receiptId)
          .run(),
      ),
    ).rejects.toThrow(/append-only/);

    // A second receipt for the same application, and a receipt beside a reversal, are both refused.
    await expect(
      expectRefusal(() =>
        fixture.database
          .prepare(
            "INSERT INTO payment_receipt (id, application_id, method, recorded_at) VALUES (?1, ?2, 'cash', '2026-08-04T00:00:00.000Z')",
          )
          .bind(newIdentifier("paymentReceipt"), recorded.applicationId)
          .run(),
      ),
    ).rejects.toThrow();
    const reversed = await composeApplicationReversal(
      fixture.database,
      {
        applicationId: recorded.applicationId,
        reason: "Recorded against the wrong bill",
        effectiveDate: "2026-08-05",
        reversedBy: null,
      },
      options,
    );
    await commit(fixture.database, reversed.effect);
    await expect(
      expectRefusal(() =>
        fixture.database
          .prepare(
            "INSERT INTO payment_receipt (id, application_id, method, recorded_at) VALUES (?1, ?2, 'cash', '2026-08-04T00:00:00.000Z')",
          )
          .bind(newIdentifier("paymentReceipt"), reversed.applicationId)
          .run(),
      ),
    ).rejects.toThrow(/stands beside the payment application/);

    // And a payment application that names no posting is refused by the pairing trigger.
    await expect(
      expectRefusal(() =>
        fixture.database
          .prepare(
            `INSERT INTO invoice_application (id, invoice_id, matter_id, kind, amount_minor, currency, effective_date, applied_at)
             VALUES (?1, ?2, ?3, 'payment', 100, 'USD', '2026-08-04', '2026-08-04T00:00:00.000Z')`,
          )
          .bind(newIdentifier("invoiceApplication"), bill.invoiceId, bill.matterId)
          .run(),
      ),
    ).rejects.toThrow(/records its own/);
  });
});
