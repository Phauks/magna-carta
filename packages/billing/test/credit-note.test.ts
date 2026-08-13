import { describe, expect, it } from "vitest";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type {
  ClientCreditId,
  InvoiceApplicationId,
  InvoiceId,
  InvoiceLineId,
  MatterId,
} from "@magna-carta/identifiers/types";
import { setBillingArrangement } from "../src/arrangements.ts";
import { matterClientCreditClosePrecondition } from "../src/close-precondition.ts";
import {
  addContingencyFeeToDraft,
  readContingencyResidual,
  recordMatterRecovery,
  voidMatterRecovery,
} from "../src/contingency.ts";
import {
  applyClientCreditToInvoice,
  composeApplicationReversal,
  composeInvoiceWriteOff,
  issueCreditNote,
} from "../src/credit-note.ts";
import { addClaimsToDraft, createInvoiceDraft } from "../src/draft.ts";
import { finalizeInvoice } from "../src/finalize.ts";
import {
  accountsReceivableTieOutStatement,
  billingCompositionsWithoutTheirReceivablePostingStatement,
  contingencyBilledBeyondEntitlementStatement,
  clientCreditsDisagreeingWithApplicationsStatement,
  creditNotesAgainstUnfinalizedInvoicesStatement,
  invoiceMatterBalancesDisagreeingWithApplicationsStatement,
} from "../src/fitness.ts";
import {
  readCreditNoteLines,
  readCreditNotesForInvoice,
  readInvoiceLines,
  readInvoiceMatterBalances,
  readOpenClientCreditsForClient,
} from "../src/statements.ts";
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

const FINALIZE_DATES = { issueDate: "2026-08-03", dueDate: "2026-09-04" } as const;
const CLIENT = "entity_client";

const CORRECTION_ROLES = [
  "accounts_receivable",
  "fee_income",
  "fee_adjustments",
  "fee_write_off",
  "client_credit_liability",
] as const;

interface FinalizedBill {
  readonly invoiceId: InvoiceId;
  readonly matterId: MatterId;
  readonly totalMinor: number;
}

// One matter, one hour of work, one finalized bill. The amount is the entry's own snapshot rate, so
// nothing here re-derives a rate — the same discipline the finalize suite holds.
async function finalizedBill(
  fixture: BillingFixture,
  amountMinor: number,
  clientEntityId = CLIENT,
): Promise<FinalizedBill> {
  const matterId = await seedMatter(fixture, clientEntityId, "Acme");
  const timeEntryId = await seedTimeEntry(fixture, matterId, { amountMinor });
  const draft = createInvoiceDraft(
    fixture.database,
    { clientEntityId, currency: "USD", createdBy: null },
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
  expect(finalized.totalMinor).toBe(amountMinor);
  return { invoiceId: draft.invoiceId, matterId, totalMinor: amountMinor };
}

async function unpaidMinor(fixture: BillingFixture, bill: FinalizedBill): Promise<number> {
  const balances = await readInvoiceMatterBalances(fixture.database, bill.invoiceId);
  const balance = balances.find((row) => row.matterId === bill.matterId);
  if (!balance) throw new Error("the fixture bill has no balance row");
  return balance.totalMinor - balance.appliedMinor;
}

async function accountBalanceMinor(
  fixture: BillingFixture,
  accountId: string,
): Promise<number | undefined> {
  const row = await readOneRow<{ balance_minor: number }>(
    fixture.database,
    "SELECT balance_minor FROM account_balance WHERE account_id = ?1",
    accountId,
  );
  return row?.balance_minor;
}

describe("the credit note", () => {
  it("reduces what the client owes without touching the bill, and posts contra-revenue against the receivable", async () => {
    const fixture = await billingFixture();
    await mapAccountRoles(fixture, CORRECTION_ROLES);
    const bill = await finalizedBill(fixture, 500_000);

    const issued = await issueCreditNote(
      fixture.database,
      {
        invoiceId: bill.invoiceId,
        reason: "The research hours were covered by the flat quote given in June",
        effectiveDate: "2026-08-05",
        lines: [
          {
            matterId: bill.matterId,
            kind: "adjustment",
            description: "Research hours already covered by the June quote",
            amountMinor: 120_000,
          },
        ],
        issuedBy: null,
      },
      options,
    );
    await commit(fixture.database, issued.effect);

    expect(issued.totalMinor).toBe(120_000);
    expect(issued.appliedMinor).toBe(120_000);
    expect(issued.clientCreditMinor).toBe(0);
    expect(await unpaidMinor(fixture, bill)).toBe(380_000);

    // The bill itself is untouched: the header carries no total, the lines still say what the client
    // was told, and only the derived balance moved.
    const lines = await readInvoiceLines(fixture.database, bill.invoiceId);
    expect(lines.map((line) => line.amountMinor)).toEqual([500_000]);
    const balances = await readInvoiceMatterBalances(fixture.database, bill.invoiceId);
    expect(balances[0]?.totalMinor).toBe(500_000);
    expect(balances[0]?.appliedMinor).toBe(120_000);

    // Contra-revenue debited, receivable credited — gross billings and the credits against them stay
    // separately readable.
    expect(await accountBalanceMinor(fixture, fixture.feeAdjustmentsAccountId)).toBe(-120_000);
    expect(await accountBalanceMinor(fixture, fixture.accountsReceivableAccountId)).toBe(380_000);

    const notes = await readCreditNotesForInvoice(fixture.database, bill.invoiceId);
    expect(notes).toHaveLength(1);
    expect(notes[0]?.reason).toContain("June");
    const noteLines = await readCreditNoteLines(fixture.database, issued.creditNoteId);
    expect(noteLines.map((line) => line.amountMinor)).toEqual([120_000]);
  });

  it("opens a client credit for what the bill can no longer absorb, and the ledger says the firm owes it", async () => {
    const fixture = await billingFixture();
    await mapAccountRoles(fixture, CORRECTION_ROLES);
    const bill = await finalizedBill(fixture, 500_000);

    // The bill is paid down to 100,000 by a write-off standing in for a payment: the point is only
    // that the unpaid remainder is smaller than the correction.
    const writtenOff = await composeInvoiceWriteOff(
      fixture.database,
      {
        invoiceId: bill.invoiceId,
        matterId: bill.matterId,
        amountMinor: 400_000,
        reason: "Balance abandoned after the client's insurer settled directly",
        effectiveDate: "2026-08-05",
        writtenOffBy: null,
      },
      options,
    );
    await commit(fixture.database, writtenOff.effect);
    expect(await unpaidMinor(fixture, bill)).toBe(100_000);

    const issued = await issueCreditNote(
      fixture.database,
      {
        invoiceId: bill.invoiceId,
        reason: "Two of the three deposition hours were not earned",
        effectiveDate: "2026-08-05",
        lines: [
          {
            matterId: bill.matterId,
            kind: "adjustment",
            description: "Deposition hours not earned",
            amountMinor: 300_000,
          },
        ],
        issuedBy: null,
      },
      options,
    );
    await commit(fixture.database, issued.effect);

    // The bill absorbs what it still owes and no more: reducing the total below what was already
    // applied would be a negative unpaid receivable.
    expect(issued.appliedMinor).toBe(100_000);
    expect(issued.clientCreditMinor).toBe(200_000);
    expect(await unpaidMinor(fixture, bill)).toBe(0);

    const credits = await readOpenClientCreditsForClient(fixture.database, CLIENT);
    expect(credits).toHaveLength(1);
    expect(credits[0]).toMatchObject({
      amountMinor: 200_000,
      dischargedMinor: 0,
      remainingMinor: 200_000,
      matterId: bill.matterId,
    });
    // A liability, not a reduction of a receivable that no longer exists.
    expect(await accountBalanceMinor(fixture, fixture.clientCreditLiabilityAccountId)).toBe(200_000);
    expect(await accountBalanceMinor(fixture, fixture.feeAdjustmentsAccountId)).toBe(-300_000);
  });

  it("a note against a fully paid bill opens the whole amount as a client credit and composes no application", async () => {
    const fixture = await billingFixture();
    await mapAccountRoles(fixture, CORRECTION_ROLES);
    const bill = await finalizedBill(fixture, 250_000);
    const writtenOff = await composeInvoiceWriteOff(
      fixture.database,
      {
        invoiceId: bill.invoiceId,
        matterId: bill.matterId,
        amountMinor: 250_000,
        reason: "Uncollectable after the client's practice dissolved",
        effectiveDate: "2026-08-05",
        writtenOffBy: null,
      },
      options,
    );
    await commit(fixture.database, writtenOff.effect);

    const issued = await issueCreditNote(
      fixture.database,
      {
        invoiceId: bill.invoiceId,
        reason: "The whole engagement was quoted flat and the hourly bill was an error",
        effectiveDate: "2026-08-05",
        lines: [
          {
            matterId: bill.matterId,
            kind: "adjustment",
            description: "Hourly bill issued in error",
            amountMinor: 250_000,
          },
        ],
        issuedBy: null,
      },
      options,
    );
    await commit(fixture.database, issued.effect);

    expect(issued.appliedMinor).toBe(0);
    expect(issued.clientCreditMinor).toBe(250_000);
    // No application at all, which is exactly why the note carries its own posting: there would
    // otherwise be no row to record what it posted.
    const applications = await readOneRow<{ note_applications: number }>(
      fixture.database,
      "SELECT COUNT(*) AS note_applications FROM invoice_application WHERE kind = 'credit_note'",
    );
    expect(applications?.note_applications).toBe(0);
    const note = await readOneRow<{ entry_id: string }>(
      fixture.database,
      "SELECT entry_id FROM credit_note WHERE id = ?1",
      issued.creditNoteId,
    );
    expect(note?.entry_id).toBe(issued.entryId);
  });

  it("refuses a correction against a draft, and the trigger refuses it too", async () => {
    const fixture = await billingFixture();
    await mapAccountRoles(fixture, CORRECTION_ROLES);
    // A finalized bill first, so a ledger entry exists for the raw insert below to borrow.
    const bill = await finalizedBill(fixture, 100_000);
    const matterId = bill.matterId;
    const draft = createInvoiceDraft(
      fixture.database,
      { clientEntityId: CLIENT, currency: "USD", createdBy: null },
      options,
    );
    await commit(fixture.database, draft.effect);

    await expect(
      issueCreditNote(
        fixture.database,
        {
          invoiceId: draft.invoiceId,
          reason: "Wrong",
          effectiveDate: "2026-08-05",
          lines: [
            { matterId, kind: "adjustment", description: "Wrong", amountMinor: 100 },
          ],
          issuedBy: null,
        },
        options,
      ),
    ).rejects.toMatchObject({ code: "invoice-not-final" });

    // And the guarantee under the sentence: a hand-built insert against the same draft aborts.
    await expect(
      expectRefusal(() =>
        fixture.database
          .prepare(
            `INSERT INTO credit_note (id, invoice_id, currency, reason, effective_date, entry_id, issued_at)
             SELECT ?1, ?2, 'USD', 'Wrong', '2026-08-05', id, ?3 FROM ledger_entry LIMIT 1`,
          )
          .bind(newIdentifier("creditNote"), draft.invoiceId, "2026-08-05T00:00:00.000Z")
          .run(),
      ),
    ).rejects.toThrow(/corrects a finalized invoice/);
  });

  it("refuses a line naming a matter the bill does not charge", async () => {
    const fixture = await billingFixture();
    await mapAccountRoles(fixture, CORRECTION_ROLES);
    const bill = await finalizedBill(fixture, 100_000);
    const otherMatterId = await seedMatter(fixture, CLIENT, "Other");
    await expect(
      issueCreditNote(
        fixture.database,
        {
          invoiceId: bill.invoiceId,
          reason: "Aimed at the wrong matter",
          effectiveDate: "2026-08-05",
          lines: [
            {
              matterId: otherMatterId,
              kind: "adjustment",
              description: "Not on this bill",
              amountMinor: 100,
            },
          ],
          issuedBy: null,
        },
        options,
      ),
    ).rejects.toMatchObject({ code: "credit-note-matter-not-billed" });
  });

  it("is frozen once issued: neither the note nor its lines can be edited or deleted", async () => {
    const fixture = await billingFixture();
    await mapAccountRoles(fixture, CORRECTION_ROLES);
    const bill = await finalizedBill(fixture, 100_000);
    const issued = await issueCreditNote(
      fixture.database,
      {
        invoiceId: bill.invoiceId,
        reason: "Overstated by an hour",
        effectiveDate: "2026-08-05",
        lines: [
          { matterId: bill.matterId, kind: "adjustment", description: "One hour", amountMinor: 100 },
        ],
        issuedBy: null,
      },
      options,
    );
    await commit(fixture.database, issued.effect);

    await expect(
      expectRefusal(() =>
        fixture.database
          .prepare("UPDATE credit_note SET reason = 'Something else' WHERE id = ?1")
          .bind(issued.creditNoteId)
          .run(),
      ),
    ).rejects.toThrow(/append-only/);
    await expect(
      expectRefusal(() =>
        fixture.database
          .prepare("DELETE FROM credit_note_line WHERE credit_note_id = ?1")
          .bind(issued.creditNoteId)
          .run(),
      ),
    ).rejects.toThrow(/append-only/);
  });
});

describe("the write-off", () => {
  it("posts bad debt against the receivable and cannot exceed what is still owed", async () => {
    const fixture = await billingFixture();
    await mapAccountRoles(fixture, CORRECTION_ROLES);
    const bill = await finalizedBill(fixture, 300_000);

    await expect(
      composeInvoiceWriteOff(
        fixture.database,
        {
          invoiceId: bill.invoiceId,
          matterId: bill.matterId,
          amountMinor: 300_001,
          reason: "Uncollectable",
          effectiveDate: "2026-08-05",
          writtenOffBy: null,
        },
        options,
      ),
    ).rejects.toMatchObject({ code: "write-off-exceeds-unpaid-balance" });

    const writtenOff = await composeInvoiceWriteOff(
      fixture.database,
      {
        invoiceId: bill.invoiceId,
        matterId: bill.matterId,
        amountMinor: 300_000,
        reason: "Uncollectable after the client stopped responding",
        effectiveDate: "2026-08-05",
        writtenOffBy: null,
      },
      options,
    );
    await commit(fixture.database, writtenOff.effect);

    expect(await unpaidMinor(fixture, bill)).toBe(0);
    // Bad debt is its own account: giving up a receivable is a different management fact from
    // conceding an over-charge, and netting them would hide both.
    expect(await accountBalanceMinor(fixture, fixture.feeWriteOffAccountId)).toBe(300_000);
    expect(await accountBalanceMinor(fixture, fixture.feeAdjustmentsAccountId)).toBe(0);
  });

  it("states why: an unexplained write-off is refused by the composer and by the trigger", async () => {
    const fixture = await billingFixture();
    await mapAccountRoles(fixture, CORRECTION_ROLES);
    const bill = await finalizedBill(fixture, 100_000);
    await expect(
      composeInvoiceWriteOff(
        fixture.database,
        {
          invoiceId: bill.invoiceId,
          matterId: bill.matterId,
          amountMinor: 100,
          reason: "   ",
          effectiveDate: "2026-08-05",
          writtenOffBy: null,
        },
        options,
      ),
    ).rejects.toMatchObject({ code: "write-off-invalid" });

    await expect(
      expectRefusal(() =>
        fixture.database
          .prepare(
            `INSERT INTO invoice_application (id, invoice_id, matter_id, kind, amount_minor, currency, entry_id, effective_date, applied_at)
             SELECT ?1, ?2, ?3, 'write_off', 100, 'USD', id, '2026-08-05', ?4 FROM ledger_entry LIMIT 1`,
          )
          .bind(
            newIdentifier("invoiceApplication"),
            bill.invoiceId,
            bill.matterId,
            "2026-08-05T00:00:00.000Z",
          )
          .run(),
      ),
    ).rejects.toThrow(/state why/);
  });
});

describe("the client credit", () => {
  it("discharges against a later bill for the same client, and never against another client's", async () => {
    const fixture = await billingFixture();
    await mapAccountRoles(fixture, CORRECTION_ROLES);
    const first = await finalizedBill(fixture, 200_000);
    const writtenOff = await composeInvoiceWriteOff(
      fixture.database,
      {
        invoiceId: first.invoiceId,
        matterId: first.matterId,
        amountMinor: 200_000,
        reason: "Settled directly with the client",
        effectiveDate: "2026-08-05",
        writtenOffBy: null,
      },
      options,
    );
    await commit(fixture.database, writtenOff.effect);
    const issued = await issueCreditNote(
      fixture.database,
      {
        invoiceId: first.invoiceId,
        reason: "The whole bill was raised against the wrong engagement",
        effectiveDate: "2026-08-05",
        lines: [
          {
            matterId: first.matterId,
            kind: "adjustment",
            description: "Raised against the wrong engagement",
            amountMinor: 150_000,
          },
        ],
        issuedBy: null,
      },
      options,
    );
    await commit(fixture.database, issued.effect);
    const creditId = issued.matters[0]?.clientCreditId as ClientCreditId;
    expect(creditId).toBeTruthy();

    // Another client's bill is refused outright: money the firm owes one client is never set against
    // another client's debt.
    const strangersBill = await finalizedBill(fixture, 500_000, "entity_other_client");
    await expect(
      applyClientCreditToInvoice(
        fixture.database,
        {
          clientCreditId: creditId,
          invoiceId: strangersBill.invoiceId,
          matterId: strangersBill.matterId,
          amountMinor: 10_000,
          effectiveDate: "2026-08-05",
          appliedBy: null,
        },
        options,
      ),
    ).rejects.toMatchObject({ code: "client-credit-client-mismatch" });

    // The same client's later bill, on a DIFFERENT matter, is the ordinary case.
    const second = await finalizedBill(fixture, 400_000);
    const applied = await applyClientCreditToInvoice(
      fixture.database,
      {
        clientCreditId: creditId,
        invoiceId: second.invoiceId,
        matterId: second.matterId,
        amountMinor: 100_000,
        effectiveDate: "2026-08-05",
        appliedBy: null,
      },
      options,
    );
    await commit(fixture.database, applied.effect);
    expect(await unpaidMinor(fixture, second)).toBe(300_000);
    expect(applied.remainingMinor).toBe(50_000);
    // The liability comes down by exactly what was set against the bill; no money moved.
    expect(await accountBalanceMinor(fixture, fixture.clientCreditLiabilityAccountId)).toBe(50_000);

    // And it cannot be given back twice.
    await expect(
      applyClientCreditToInvoice(
        fixture.database,
        {
          clientCreditId: creditId,
          invoiceId: second.invoiceId,
          matterId: second.matterId,
          amountMinor: 50_001,
          effectiveDate: "2026-08-05",
          appliedBy: null,
        },
        options,
      ),
    ).rejects.toMatchObject({ code: "client-credit-exhausted" });
  });

  it("blocks a matter close while it is open, and the guard aborts the close batch too", async () => {
    const fixture = await billingFixture();
    await mapAccountRoles(fixture, CORRECTION_ROLES);
    const bill = await finalizedBill(fixture, 200_000);
    const writtenOff = await composeInvoiceWriteOff(
      fixture.database,
      {
        invoiceId: bill.invoiceId,
        matterId: bill.matterId,
        amountMinor: 200_000,
        reason: "Settled directly",
        effectiveDate: "2026-08-05",
        writtenOffBy: null,
      },
      options,
    );
    await commit(fixture.database, writtenOff.effect);

    const before = await matterClientCreditClosePrecondition.check({
      database: fixture.database,
      matterId: bill.matterId,
    });
    expect(before).toHaveLength(0);

    const issued = await issueCreditNote(
      fixture.database,
      {
        invoiceId: bill.invoiceId,
        reason: "Billed in error",
        effectiveDate: "2026-08-05",
        lines: [
          {
            matterId: bill.matterId,
            kind: "adjustment",
            description: "Billed in error",
            amountMinor: 75_000,
          },
        ],
        issuedBy: null,
      },
      options,
    );
    await commit(fixture.database, issued.effect);

    const after = await matterClientCreditClosePrecondition.check({
      database: fixture.database,
      matterId: bill.matterId,
    });
    expect(after).toHaveLength(1);
    expect(after[0]?.code).toBe("client-credit-open");
    expect(after[0]?.message).toContain("750.00");

    // The guard re-asks inside the batch, where the answer is the committed one. It aims a value the
    // table's CHECK forbids at exactly the open credits, so it aborts rather than storing anything.
    const guards = matterClientCreditClosePrecondition.commitGuard?.({
      database: fixture.database,
      matterId: bill.matterId,
    });
    expect(guards).toHaveLength(1);
    await expect(expectRefusal(() => fixture.database.batch([...(guards ?? [])]))).rejects.toThrow();
  });
});

describe("the reversal", () => {
  it("unwinds an application and its posting, gives a discharged credit back, and refuses a second attempt", async () => {
    const fixture = await billingFixture();
    await mapAccountRoles(fixture, CORRECTION_ROLES);
    const first = await finalizedBill(fixture, 200_000);
    const paid = await composeInvoiceWriteOff(
      fixture.database,
      {
        invoiceId: first.invoiceId,
        matterId: first.matterId,
        amountMinor: 200_000,
        reason: "Settled directly",
        effectiveDate: "2026-08-05",
        writtenOffBy: null,
      },
      options,
    );
    await commit(fixture.database, paid.effect);
    const issued = await issueCreditNote(
      fixture.database,
      {
        invoiceId: first.invoiceId,
        reason: "Billed in error",
        effectiveDate: "2026-08-05",
        lines: [
          {
            matterId: first.matterId,
            kind: "adjustment",
            description: "Billed in error",
            amountMinor: 150_000,
          },
        ],
        issuedBy: null,
      },
      options,
    );
    await commit(fixture.database, issued.effect);
    const creditId = issued.matters[0]?.clientCreditId as ClientCreditId;

    const second = await finalizedBill(fixture, 400_000);
    const applied = await applyClientCreditToInvoice(
      fixture.database,
      {
        clientCreditId: creditId,
        invoiceId: second.invoiceId,
        matterId: second.matterId,
        amountMinor: 150_000,
        effectiveDate: "2026-08-05",
        appliedBy: null,
      },
      options,
    );
    await commit(fixture.database, applied.effect);
    expect(await unpaidMinor(fixture, second)).toBe(250_000);

    const reversed = await composeApplicationReversal(
      fixture.database,
      {
        applicationId: applied.applicationId,
        reason: "The credit was set against the wrong one of this client's bills",
        effectiveDate: "2026-08-05",
        reversedBy: null,
      },
      options,
    );
    await commit(fixture.database, reversed.effect);

    // The bill owes it again, the credit is open again, and the liability is back where it was.
    expect(await unpaidMinor(fixture, second)).toBe(400_000);
    const credits = await readOpenClientCreditsForClient(fixture.database, CLIENT);
    expect(credits[0]?.remainingMinor).toBe(150_000);
    expect(await accountBalanceMinor(fixture, fixture.clientCreditLiabilityAccountId)).toBe(150_000);

    // A double reversal is structurally impossible: the UNIQUE link settles the second attempt.
    await expect(
      composeApplicationReversal(
        fixture.database,
        {
          applicationId: applied.applicationId,
          reason: "Again",
          effectiveDate: "2026-08-05",
          reversedBy: null,
        },
        options,
      ),
    ).rejects.toMatchObject({ code: "already-reversed" });
  });

  it("refuses to unwind a trust transfer or a credit note", async () => {
    const fixture = await billingFixture();
    await mapAccountRoles(fixture, CORRECTION_ROLES);
    const bill = await finalizedBill(fixture, 200_000);
    const issued = await issueCreditNote(
      fixture.database,
      {
        invoiceId: bill.invoiceId,
        reason: "Overstated",
        effectiveDate: "2026-08-05",
        lines: [
          {
            matterId: bill.matterId,
            kind: "adjustment",
            description: "Overstated",
            amountMinor: 50_000,
          },
        ],
        issuedBy: null,
      },
      options,
    );
    await commit(fixture.database, issued.effect);
    const noteApplication = await readOneRow<{ id: string }>(
      fixture.database,
      "SELECT id FROM invoice_application WHERE kind = 'credit_note'",
    );
    await expect(
      composeApplicationReversal(
        fixture.database,
        {
          applicationId: noteApplication?.id as InvoiceApplicationId,
          reason: "Change of mind",
          effectiveDate: "2026-08-05",
          reversedBy: null,
        },
        options,
      ),
    ).rejects.toMatchObject({ code: "application-reversal-refused" });
  });
});

describe("the corrections tie out", () => {
  it("keeps the subledger equal to the receivable control account through a credit, a write-off, a discharge, and a reversal", async () => {
    const fixture = await billingFixture();
    await mapAccountRoles(fixture, CORRECTION_ROLES);
    const first = await finalizedBill(fixture, 600_000);
    const second = await finalizedBill(fixture, 400_000);

    const writtenOff = await composeInvoiceWriteOff(
      fixture.database,
      {
        invoiceId: first.invoiceId,
        matterId: first.matterId,
        amountMinor: 500_000,
        reason: "Uncollectable after the client's practice dissolved",
        effectiveDate: "2026-08-05",
        writtenOffBy: null,
      },
      options,
    );
    await commit(fixture.database, writtenOff.effect);
    const issued = await issueCreditNote(
      fixture.database,
      {
        invoiceId: first.invoiceId,
        reason: "The last three hours were not earned",
        effectiveDate: "2026-08-05",
        lines: [
          {
            matterId: first.matterId,
            kind: "adjustment",
            description: "Three hours not earned",
            amountMinor: 300_000,
          },
        ],
        issuedBy: null,
      },
      options,
    );
    await commit(fixture.database, issued.effect);
    const creditId = issued.matters[0]?.clientCreditId as ClientCreditId;
    const applied = await applyClientCreditToInvoice(
      fixture.database,
      {
        clientCreditId: creditId,
        invoiceId: second.invoiceId,
        matterId: second.matterId,
        amountMinor: 150_000,
        effectiveDate: "2026-08-05",
        appliedBy: null,
      },
      options,
    );
    await commit(fixture.database, applied.effect);
    const reversed = await composeApplicationReversal(
      fixture.database,
      {
        applicationId: applied.applicationId,
        reason: "Set against the wrong bill",
        effectiveDate: "2026-08-05",
        reversedBy: null,
      },
      options,
    );
    await commit(fixture.database, reversed.effect);

    // THE relationship: the sum of unpaid balances equals the receivable control account. Zero rows
    // is healthy, and it is the claim that makes "the invoice tables are the subledger" testable.
    for (const statement of [
      accountsReceivableTieOutStatement(fixture.database),
      invoiceMatterBalancesDisagreeingWithApplicationsStatement(fixture.database),
      billingCompositionsWithoutTheirReceivablePostingStatement(fixture.database),
      clientCreditsDisagreeingWithApplicationsStatement(fixture.database),
      creditNotesAgainstUnfinalizedInvoicesStatement(fixture.database),
    ]) {
      const { results } = await statement.all();
      expect(results).toEqual([]);
    }
  });
});

describe("the contingency shrunk-basis residual", () => {
  // A settlement is recorded, a third of it is billed and finalized, and then the settlement
  // collapses. The bill was true when it issued and cannot be edited, so what the firm has is a
  // charge its surviving basis no longer supports — and the only record that can answer it is a
  // credit note standing beside the bill.
  async function billedContingencyThenVoided(fixture: BillingFixture) {
    const matterId = await seedMatter(fixture, CLIENT, "Contingency");
    const arrangement = await setBillingArrangement(
      fixture.database,
      {
        matterId,
        kind: "contingency",
        contingencyShareE4: 3_333,
        contingencyBasis: "gross_recovery",
        currency: "USD",
        validFrom: "2026-08-01",
        createdBy: null,
      },
      options,
    );
    await commit(fixture.database, arrangement.effect);
    const recovery = recordMatterRecovery(
      fixture.database,
      {
        matterId,
        amountMinor: 10_000_000,
        currency: "USD",
        recoveredDate: "2026-08-03",
        description: "Settlement of all claims",
        recordedBy: null,
      },
      options,
    );
    await commit(fixture.database, recovery.effect);
    const draft = createInvoiceDraft(
      fixture.database,
      { clientEntityId: CLIENT, currency: "USD", createdBy: null },
      options,
    );
    await commit(fixture.database, draft.effect);
    const fee = await addContingencyFeeToDraft(fixture.database, draft.invoiceId, matterId, options);
    await commit(fixture.database, fee.effect);
    const finalized = await finalizeInvoice(
      fixture.database,
      { invoiceId: draft.invoiceId, ...FINALIZE_DATES, finalizedBy: null },
      options,
    );
    await commit(fixture.database, finalized.effect);
    // Half the fee is settled out of the client's own money before the basis collapses, so the
    // correction has to split — which is the shape that makes the residual interesting.
    const part = await composeInvoiceWriteOff(
      fixture.database,
      {
        invoiceId: draft.invoiceId,
        matterId,
        amountMinor: 1_333_000,
        reason: "Portion abandoned in the fee negotiation",
        effectiveDate: "2026-08-05",
        writtenOffBy: null,
      },
      options,
    );
    await commit(fixture.database, part.effect);
    const voided = await voidMatterRecovery(
      fixture.database,
      matterId,
      recovery.recoveryId,
      "The settlement fell through before it funded",
      null,
      options,
    );
    await commit(fixture.database, voided);
    return { matterId, invoiceId: draft.invoiceId, feeLineId: fee.lineId };
  }

  it("is reported as an amount against the bills that carry it, and the credit note clears the report", async () => {
    const fixture = await billingFixture();
    await mapAccountRoles(fixture, CORRECTION_ROLES);
    const { matterId, invoiceId, feeLineId } = await billedContingencyThenVoided(fixture);

      // The whole basis is gone, so every penny of the fee is beyond the surviving entitlement. A
    // vanished basis is the WORST case this read exists to report, not a reason to stop reporting:
    // it resolves to an entitlement of zero rather than refusing the way the composition path does.
    const collapsed = await readContingencyResidual(fixture.database, matterId);
    expect(collapsed.entitlementMinor).toBe(0);
    expect(collapsed.residualMinor).toBe(3_333_000);

    // A recovery survives, at a fifth of the original: the entitlement shrinks rather than vanishing.
    const smaller = recordMatterRecovery(
      fixture.database,
      {
        matterId,
        amountMinor: 2_000_000,
        currency: "USD",
        recoveredDate: "2026-08-09",
        description: "Reduced settlement after the first collapsed",
        recordedBy: null,
      },
      options,
    );
    await commit(fixture.database, smaller.effect);

    const residual = await readContingencyResidual(fixture.database, matterId);
    // 33.33% of 10,000,000 was billed; 33.33% of 2,000,000 is the surviving entitlement.
    expect(residual.billedMinor).toBe(3_333_000);
    expect(residual.entitlementMinor).toBe(666_600);
    expect(residual.residualMinor).toBe(2_666_400);
    expect(residual.feeLines).toHaveLength(1);
    expect(residual.feeLines[0]).toMatchObject({
      invoiceId,
      invoiceLineId: feeLineId,
      chargedMinor: 3_333_000,
      creditedMinor: 0,
      invoiceMatterUnpaidMinor: 2_000_000,
    });

    const flagged = await contingencyBilledBeyondEntitlementStatement(fixture.database).all<{
      matter_id: string;
      billed_minor: number;
      entitlement_minor: number;
    }>();
    expect(flagged.results).toHaveLength(1);
    expect(flagged.results[0]).toMatchObject({
      matter_id: matterId,
      billed_minor: 3_333_000,
      entitlement_minor: 666_600,
    });

    // THE CORRECTION. The credit note names the fee line it credits, so the credit is attributable
    // to that charge rather than to the bill in general.
    const issued = await issueCreditNote(
      fixture.database,
      {
        invoiceId,
        reason: "The settlement behind the fee collapsed and was replaced by a smaller one",
        effectiveDate: "2026-08-05",
        lines: [
          {
            matterId,
            kind: "fee",
            description: "Contingency fee re-levelled to the surviving recovery",
            amountMinor: 2_666_400,
            creditsInvoiceLineId: feeLineId,
          },
        ],
        issuedBy: null,
      },
      options,
    );
    await commit(fixture.database, issued.effect);
    // 2,000,000 was still unpaid, so the rest is money already the firm's and becomes an obligation.
    expect(issued.appliedMinor).toBe(2_000_000);
    expect(issued.clientCreditMinor).toBe(666_400);

    // AND THE REPORT CLEARS. Before this slice the fitness comparison read the gross charge, so the
    // one record that resolves the finding had no effect on the report that demanded it.
    const afterCorrection = await contingencyBilledBeyondEntitlementStatement(
      fixture.database,
    ).all();
    expect(afterCorrection.results).toEqual([]);

    const settled = await readContingencyResidual(fixture.database, matterId);
    expect(settled.billedMinor).toBe(666_600);
    expect(settled.residualMinor).toBe(0);
    expect(settled.feeLines[0]?.creditedMinor).toBe(2_666_400);
  });

  it("frees the credited amount to be billed again only if the basis itself recovers", async () => {
    const fixture = await billingFixture();
    await mapAccountRoles(fixture, CORRECTION_ROLES);
    const { matterId, invoiceId, feeLineId } = await billedContingencyThenVoided(fixture);
    const smaller = recordMatterRecovery(
      fixture.database,
      {
        matterId,
        amountMinor: 2_000_000,
        currency: "USD",
        recoveredDate: "2026-08-09",
        description: "Reduced settlement after the first collapsed",
        recordedBy: null,
      },
      options,
    );
    await commit(fixture.database, smaller.effect);
    const issued = await issueCreditNote(
      fixture.database,
      {
        invoiceId,
        reason: "Re-levelled to the surviving recovery",
        effectiveDate: "2026-08-05",
        lines: [
          {
            matterId,
            kind: "fee",
            description: "Contingency fee re-levelled",
            amountMinor: 2_666_400,
            creditsInvoiceLineId: feeLineId,
          },
        ],
        issuedBy: null,
      },
      options,
    );
    await commit(fixture.database, issued.effect);

    // Nothing left to bill: the offset now says 666,600 charged against an entitlement of 666,600.
    const settledDraft = createInvoiceDraft(
      fixture.database,
      { clientEntityId: CLIENT, currency: "USD", createdBy: null },
      options,
    );
    await commit(fixture.database, settledDraft.effect);
    await expect(
      addContingencyFeeToDraft(fixture.database, settledDraft.invoiceId, matterId, options),
    ).rejects.toMatchObject({ code: "contingency-nothing-unbilled" });

    // A further recovery lands. The increment is measured against the NET figure, so the firm bills
    // the difference and never re-charges what it gave back beyond it.
    const further = recordMatterRecovery(
      fixture.database,
      {
        matterId,
        amountMinor: 8_000_000,
        currency: "USD",
        recoveredDate: "2026-09-01",
        description: "The appeal recovered the balance",
        recordedBy: null,
      },
      options,
    );
    await commit(fixture.database, further.effect);
    const nextDraft = createInvoiceDraft(
      fixture.database,
      { clientEntityId: CLIENT, currency: "USD", createdBy: null },
      options,
    );
    await commit(fixture.database, nextDraft.effect);
    const nextFee = await addContingencyFeeToDraft(
      fixture.database,
      nextDraft.invoiceId,
      matterId,
      options,
    );
    // 33.33% of 10,000,000 is 3,333,000 again; 666,600 is charged and uncredited, so the increment
    // is exactly the difference.
    expect(nextFee.entitlementMinor).toBe(3_333_000);
    expect(nextFee.previouslyBilledMinor).toBe(666_600);
    expect(nextFee.lineAmountMinor).toBe(2_666_400);
  });

  it("a general credit against the same bill is not a statement about the fee", async () => {
    const fixture = await billingFixture();
    await mapAccountRoles(fixture, CORRECTION_ROLES);
    const { matterId, invoiceId } = await billedContingencyThenVoided(fixture);
    const smaller = recordMatterRecovery(
      fixture.database,
      {
        matterId,
        amountMinor: 2_000_000,
        currency: "USD",
        recoveredDate: "2026-08-09",
        description: "Reduced settlement",
        recordedBy: null,
      },
      options,
    );
    await commit(fixture.database, smaller.effect);
    const issued = await issueCreditNote(
      fixture.database,
      {
        invoiceId,
        reason: "Goodwill credit unrelated to the fee computation",
        effectiveDate: "2026-08-05",
        lines: [
          {
            matterId,
            kind: "discount",
            description: "Goodwill credit",
            amountMinor: 500_000,
          },
        ],
        issuedBy: null,
      },
      options,
    );
    await commit(fixture.database, issued.effect);

      const residual = await readContingencyResidual(fixture.database, matterId);
    expect(residual.billedMinor).toBe(3_333_000);
    expect(residual.residualMinor).toBe(2_666_400);
  });

  it("refuses a credit attributed to a line on another bill", async () => {
    const fixture = await billingFixture();
    await mapAccountRoles(fixture, CORRECTION_ROLES);
    const bill = await finalizedBill(fixture, 100_000);
    const other = await finalizedBill(fixture, 100_000);
    const otherLines = await readInvoiceLines(fixture.database, other.invoiceId);
    await expect(
      issueCreditNote(
        fixture.database,
        {
          invoiceId: bill.invoiceId,
          reason: "Aimed at another bill's line",
          effectiveDate: "2026-08-05",
          lines: [
            {
              matterId: bill.matterId,
              kind: "fee",
              description: "Wrong line",
              amountMinor: 100,
              creditsInvoiceLineId: otherLines[0]?.id as InvoiceLineId,
            },
          ],
          issuedBy: null,
        },
        options,
      ),
    ).rejects.toMatchObject({ code: "credit-note-invalid" });
  });
});
