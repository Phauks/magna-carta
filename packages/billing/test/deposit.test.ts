import { describe, expect, it } from "vitest";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type {
  InvoiceId,
  LedgerAccountId,
  MatterId,
  PaymentDepositId,
} from "@magna-carta/identifiers/types";
import { createAccount } from "@magna-carta/ledger/create-account";
import { setAccountRoleStatement } from "../src/account-roles.ts";
import { composeApplicationReversal } from "../src/credit-note.ts";
import { composeDepositNote, recordPaymentDeposit, type DepositLineInput } from "../src/deposit.ts";
import { readOpenBillShares, readPaymentDeposit } from "../src/deposit-reads.ts";
import { addClaimsToDraft, createInvoiceDraft } from "../src/draft.ts";
import { finalizeInvoice } from "../src/finalize.ts";
import {
  accountsReceivableTieOutStatement,
  billingCompositionsWithoutTheirReceivablePostingStatement,
  invoiceMatterBalancesDisagreeingWithApplicationsStatement,
} from "../src/fitness.ts";
import { readInvoiceMatterBalances } from "../src/statements.ts";
import {
  billingFixture,
  clock,
  commit,
  expectRefusal,
  mapAccountRoles,
  mergeEffects,
  options,
  readOneRow,
  seedMatter,
  seedTimeEntry,
  type BillingFixture,
} from "./support.ts";

const FINALIZE_DATES = { issueDate: "2026-08-03", dueDate: "2026-09-04" } as const;

interface DepositBooks {
  readonly undepositedFundsAccountId: LedgerAccountId;
  readonly bankFeesAccountId: LedgerAccountId;
}

// The fixture's chart plus the two accounts a deposit posts through, mapped to their roles, and the
// fixture's operating bank leaf registered as an open operating account.
async function depositBooks(fixture: BillingFixture): Promise<DepositBooks> {
  await mapAccountRoles(fixture, ["accounts_receivable", "fee_income", "operating_bank"]);
  const undeposited = await createAccount(
    fixture.database,
    { name: "Undeposited Funds", type: "asset", currency: "USD" },
    options,
  );
  const bankFees = await createAccount(
    fixture.database,
    { name: "Bank Charges", type: "expense", currency: "USD" },
    options,
  );
  await commit(fixture.database, mergeEffects(undeposited.effect, bankFees.effect));
  await fixture.database.batch([
    setAccountRoleStatement(fixture.database, "undeposited_funds", undeposited.accountId, clock.now()),
    setAccountRoleStatement(fixture.database, "bank_fees", bankFees.accountId, clock.now()),
    fixture.database
      .prepare(
        `INSERT INTO operating_bank_account (id, name, bank_name, account_number_last_four, ledger_account_id, currency, opened_on, closed_at, created_by, created_at)
         VALUES (?1, 'Operating', 'Wells Fargo', '2210', ?2, 'USD', '2026-01-01', NULL, ?3, ?4)`,
      )
      .bind(
        newIdentifier("operatingBankAccount"),
        fixture.operatingBankAccountId,
        fixture.memberUserId,
        clock.now(),
      ),
  ]);
  return { undepositedFundsAccountId: undeposited.accountId, bankFeesAccountId: bankFees.accountId };
}

interface Bill {
  readonly invoiceId: InvoiceId;
  readonly matterId: MatterId;
}

async function finalizedBill(
  fixture: BillingFixture,
  client: string,
  amountMinor: number,
): Promise<Bill> {
  const matterId = await seedMatter(fixture, client, client);
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
    { invoiceId: draft.invoiceId, ...FINALIZE_DATES, finalizedBy: null },
    options,
  );
  await commit(fixture.database, finalized.effect);
  return { invoiceId: draft.invoiceId, matterId };
}

async function balance(fixture: BillingFixture, accountId: string): Promise<number> {
  const row = await readOneRow<{ balance_minor: number }>(
    fixture.database,
    "SELECT balance_minor FROM account_balance WHERE account_id = ?1",
    accountId,
  );
  return row?.balance_minor ?? 0;
}

async function owed(fixture: BillingFixture, bill: Bill): Promise<number> {
  const row = (await readInvoiceMatterBalances(fixture.database, bill.invoiceId)).find(
    (candidate) => candidate.matterId === bill.matterId,
  );
  if (!row) throw new Error("no balance row");
  return row.totalMinor - row.appliedMinor;
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

const line = (bill: Bill, overrides: Partial<DepositLineInput> = {}): DepositLineInput => ({
  invoiceId: bill.invoiceId,
  matterId: bill.matterId,
  amountMinor: 100_000,
  method: "check",
  reference: "1043",
  receivedFrom: "Acme Holdings",
  receivedOn: "2026-08-04",
  ...overrides,
});

describe("a deposit of payments recorded by hand", () => {
  it("pays several matters' bills, books each line through Undeposited Funds and the deposit into the bank less fees", async () => {
    const fixture = await billingFixture();
    const books = await depositBooks(fixture);
    const acme = await finalizedBill(fixture, "entity_acme", 382_500);
    const ruiz = await finalizedBill(fixture, "entity_ruiz", 120_000);

    const recorded = await recordPaymentDeposit(
      fixture.database,
      {
        depositToAccountId: fixture.operatingBankAccountId,
        depositedOn: "2026-08-05",
        slipNumber: " DS-1182 ",
        lines: [
          line(acme, {
            amountMinor: 150_000,
            details: { bank: "Wells Fargo", account: "6621", checkDate: "2026-08-03" },
            note: "Client called ahead",
          }),
          line(acme, { amountMinor: 132_500, reference: "1044" }),
          line(ruiz, {
            method: "cash",
            reference: null,
            receivedFrom: "Dana Ruiz",
            receivedOn: "2026-08-05",
            amountMinor: 100_000,
            details: { receivedBy: "Pat Lee", cashCount: { bill10000: 9, bill2000: 5 } },
          }),
        ],
        fees: [{ description: "Deposit fee", amountMinor: 1_500 }],
        note: "Taken to the branch by Sam",
        recordedBy: fixture.memberUserId,
      },
      options,
    );
    await commit(fixture.database, recorded.effect);

    expect(await owed(fixture, acme)).toBe(100_000);
    expect(await owed(fixture, ruiz)).toBe(20_000);
    expect(await balance(fixture, fixture.operatingBankAccountId)).toBe(381_000);
    expect(await balance(fixture, books.bankFeesAccountId)).toBe(1_500);
    expect(await balance(fixture, books.undepositedFundsAccountId)).toBe(0);
    await expectTiedOut(fixture);

    const deposit = await readPaymentDeposit(fixture.database, recorded.depositId);
    expect(deposit).toMatchObject({
      depositToName: "Operating",
      depositedOn: "2026-08-05",
      slipNumber: "DS-1182",
      paymentsMinor: 382_500,
      feesMinor: 1_500,
      depositMinor: 381_000,
      fees: [{ lineNumber: 1, description: "Deposit fee", amountMinor: 1_500 }],
    });
    expect(deposit?.lines.map((each) => [each.lineNumber, each.method, each.reference, each.receivedOn])).toEqual([
      [1, "check", "1043", "2026-08-04"],
      [2, "check", "1044", "2026-08-04"],
      [3, "cash", null, "2026-08-05"],
    ]);
    expect(deposit?.lines[0]?.details).toEqual({ bank: "Wells Fargo", account: "6621", checkDate: "2026-08-03" });
    expect(deposit?.lines[2]?.details).toEqual({
      receivedBy: "Pat Lee",
      cashCount: { bill10000: 9, bill2000: 5 },
    });
    expect(deposit?.notes.map((note) => [note.receiptId, note.body])).toEqual([
      [null, "Taken to the branch by Sam"],
      [recorded.receiptIds[0], "Client called ahead"],
    ]);

    // What the next deposit can pay: Acme's bill and Ruiz's, with what each still owes.
    const open = await readOpenBillShares(fixture.database);
    expect(open.map((share) => share.owedMinor).sort()).toEqual([100_000, 20_000].sort());

    // A note added later lands on the line.
    const later = composeDepositNote(
      fixture.database,
      { depositId: recorded.depositId, receiptId: recorded.receiptIds[1]!, body: "Cleared", writtenBy: null },
      options,
    );
    await commit(fixture.database, later.effect);
    expect((await readPaymentDeposit(fixture.database, recorded.depositId))?.notes).toHaveLength(3);
  });

  it("keeps a deposit with no fees to the bank and Undeposited Funds alone, and marks a reversed line", async () => {
    const fixture = await billingFixture();
    const books = await depositBooks(fixture);
    const acme = await finalizedBill(fixture, "entity_acme", 200_000);
    const recorded = await recordPaymentDeposit(
      fixture.database,
      {
        depositToAccountId: fixture.operatingBankAccountId,
        depositedOn: "2026-08-04",
        lines: [line(acme, { method: "card", reference: "A1B2C3", details: { brand: "Visa", lastFour: "4242" } })],
        recordedBy: null,
      },
      options,
    );
    await commit(fixture.database, recorded.effect);
    expect(await balance(fixture, fixture.operatingBankAccountId)).toBe(100_000);
    expect(await balance(fixture, books.bankFeesAccountId)).toBe(0);

    const deposit = await readPaymentDeposit(fixture.database, recorded.depositId);
    const reversal = await composeApplicationReversal(
      fixture.database,
      {
        applicationId: deposit!.lines[0]!.applicationId,
        reason: "Check returned",
        effectiveDate: "2026-08-05",
        reversedBy: null,
      },
      options,
    );
    await commit(fixture.database, reversal.effect);
    expect((await readPaymentDeposit(fixture.database, recorded.depositId))?.lines[0]?.reversed).toBe(true);
  });

  it("refuses what a deposit cannot be", async () => {
    const fixture = await billingFixture();
    await depositBooks(fixture);
    const acme = await finalizedBill(fixture, "entity_acme", 100_000);
    const base = {
      depositToAccountId: fixture.operatingBankAccountId,
      depositedOn: "2026-08-05",
      recordedBy: null,
    };
    const refusals: [string, Parameters<typeof recordPaymentDeposit>[1]][] = [
      ["two lines together pay more than the bill owes", { ...base, lines: [line(acme, { amountMinor: 60_000 }), line(acme, { amountMinor: 60_000 })] }],
      ["a check with no number", { ...base, lines: [line(acme, { reference: "  " })] }],
      ["received after it was deposited", { ...base, depositedOn: "2026-08-04", lines: [line(acme, { receivedOn: "2026-08-05" })] }],
      ["received before the bill was issued", { ...base, lines: [line(acme, { receivedOn: "2026-08-02" })] }],
      ["a full account number", { ...base, lines: [line(acme, { details: { account: "123456789" } })] }],
      ["a detail another method carries", { ...base, lines: [line(acme, { details: { brand: "Visa" } })] }],
      ["a card with no last four", { ...base, lines: [line(acme, { method: "card", reference: "A1", details: { brand: "Visa" } })] }],
      ["cash counted to a different total", { ...base, lines: [line(acme, { method: "cash", reference: null, details: { receivedBy: "Pat", cashCount: { bill10000: 1 } } })] }],
      ["fees as large as the payments", { ...base, lines: [line(acme)], fees: [{ description: "Fee", amountMinor: 100_000 }] }],
      ["no lines", { ...base, lines: [] }],
      ["an account that is not an operating account", { ...base, depositToAccountId: fixture.feeIncomeAccountId, lines: [line(acme)] }],
    ];
    for (const [, input] of refusals) {
      await expect(
        expectRefusal(() => recordPaymentDeposit(fixture.database, input, options)),
      ).rejects.toThrow();
    }
    expect(await owed(fixture, acme)).toBe(100_000);
  });

  it("is append-only", async () => {
    const fixture = await billingFixture();
    await depositBooks(fixture);
    const acme = await finalizedBill(fixture, "entity_acme", 100_000);
    const recorded = await recordPaymentDeposit(
      fixture.database,
      { depositToAccountId: fixture.operatingBankAccountId, depositedOn: "2026-08-04", lines: [line(acme)], recordedBy: null },
      options,
    );
    await commit(fixture.database, recorded.effect);
    for (const sql of [
      "UPDATE payment_deposit SET slip_number = 'X' WHERE id = ?1",
      "DELETE FROM payment_deposit WHERE id = ?1",
      "UPDATE payment_receipt SET reference = 'X' WHERE deposit_id = ?1",
      "DELETE FROM payment_receipt WHERE deposit_id = ?1",
    ]) {
      await expect(
        expectRefusal(() =>
          fixture.database.prepare(sql).bind(recorded.depositId as PaymentDepositId).run(),
        ),
      ).rejects.toThrow(/append-only/);
    }
  });
});
