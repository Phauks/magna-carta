import type { InvoiceId } from "@magna-carta/identifiers/types";
import { describe, expect, it } from "vitest";
import { addClaimsToDraft, createInvoiceDraft } from "../src/draft.ts";
import { finalizeInvoice } from "../src/finalize.ts";
import { readInvoiceMatterBalances } from "../src/statements.ts";
import { readUnbilledWorkInProgress } from "../src/queries.ts";
import {
  billingFixture,
  clock,
  commit,
  expectRefusal,
  mapAccountRoles,
  options,
  readOneRow,
  seedCostEntry,
  seedMatter,
  seedTimeEntry,
  type BillingFixture,
} from "./support.ts";

const ACME = "directoryOrganization_acme";

async function draftWithWork(
  fixture: BillingFixture,
  clientEntityId: string,
): Promise<{ invoiceId: InvoiceId; matterId: string; timeEntryId: string; costEntryId: string }> {
  const matterId = await seedMatter(fixture, clientEntityId, "Acme");
  const timeEntryId = await seedTimeEntry(fixture, matterId, {
    durationMinutes: 90,
    rateE4: 4_000_000,
  });
  const costEntryId = await seedCostEntry(fixture, matterId, {
    amountMinor: 12_500,
    disbursementClass: "hard",
  });
  const draft = createInvoiceDraft(
    fixture.database,
    { clientEntityId, currency: "USD", createdBy: fixture.memberUserId },
    options,
  );
  await commit(fixture.database, draft.effect);
  const claimed = await addClaimsToDraft(
    fixture.database,
    draft.invoiceId,
    [
      { sourceKind: "time_entry", sourceId: timeEntryId },
      { sourceKind: "cost_entry", sourceId: costEntryId },
    ],
    options,
  );
  await commit(fixture.database, claimed.effect);
  return { invoiceId: draft.invoiceId, matterId, timeEntryId, costEntryId };
}

const FINALIZE_DATES = { issueDate: "2026-08-05", dueDate: "2026-09-04" } as const;

describe("finalization — the one batch", () => {
  it("draws a number, locks the work, creates the balance rows, and posts the receivable", async () => {
    const fixture = await billingFixture();
    await mapAccountRoles(fixture, ["accounts_receivable", "fee_income", "client_costs_advanced"]);
    const { invoiceId, matterId, timeEntryId, costEntryId } = await draftWithWork(fixture, ACME);

    const finalized = await finalizeInvoice(
      fixture.database,
      { invoiceId, ...FINALIZE_DATES, finalizedBy: fixture.memberUserId },
      options,
    );
    await commit(fixture.database, finalized.effect);

    // 1.5 hours at 400.0000 plus a 125.00 filing fee, integer-exact.
    expect(finalized.totalMinor).toBe(72_500);
    expect(finalized.invoiceNumber).toBe("00001");

    const invoice = await readOneRow<{
      status: string;
      invoice_number: string;
      finalized_at: string;
      issue_date: string;
      due_date: string;
    }>(
      fixture.database,
      "SELECT status, invoice_number, finalized_at, issue_date, due_date FROM invoice WHERE id = ?1",
      invoiceId,
    );
    expect(invoice?.status).toBe("final");
    expect(invoice?.invoice_number).toBe("00001");
    expect(invoice?.finalized_at).toBe(clock.now());
    expect(invoice?.issue_date).toBe("2026-08-05");
    expect(invoice?.due_date).toBe("2026-09-04");

    const balances = await readInvoiceMatterBalances(fixture.database, invoiceId);
    expect(balances).toHaveLength(1);
    expect(balances[0]?.matterId).toBe(matterId);
    expect(balances[0]?.totalMinor).toBe(72_500);
    expect(balances[0]?.appliedMinor).toBe(0);

    // Every claimed entry is locked, and the matter has nothing unbilled left.
    for (const [table, entryId] of [
      ["time_entry", timeEntryId],
      ["cost_entry", costEntryId],
    ] as const) {
      const row = await readOneRow<{ status: string }>(
        fixture.database,
        `SELECT status FROM ${table} WHERE id = ?1`,
        entryId,
      );
      expect(row?.status).toBe("billed");
    }
    const unbilled = await readUnbilledWorkInProgress(fixture.database, matterId);
    expect(unbilled.timeEntryCount).toBe(0);
    expect(unbilled.costEntryCount).toBe(0);

    // The posting balances, and its DEBIT equals the invoice total.
    const debit = await readOneRow<{ amount_minor: number }>(
      fixture.database,
      "SELECT amount_minor FROM ledger_line WHERE entry_id = ?1 AND direction = 'debit'",
      finalized.ledgerEntryId,
    );
    expect(debit?.amount_minor).toBe(72_500);
    const credits = await fixture.database
      .prepare(
        "SELECT SUM(amount_minor) AS total FROM ledger_line WHERE entry_id = ?1 AND direction = 'credit'",
      )
      .bind(finalized.ledgerEntryId)
      .all<{ total: number }>();
    expect(credits.results[0]?.total).toBe(72_500);

    // A HARD cost credits Client Costs Advanced — the firm is being repaid for money it advanced on
    // the client's behalf, not earning income.
    const hardCostCredit = await readOneRow<{ amount_minor: number }>(
      fixture.database,
      "SELECT amount_minor FROM ledger_line WHERE entry_id = ?1 AND account_id = ?2",
      finalized.ledgerEntryId,
      fixture.clientCostsAdvancedAccountId,
    );
    expect(hardCostCredit?.amount_minor).toBe(12_500);
  });

  it("credits Cost Recovery Income for a SOFT cost, which is a firm expense being recovered", async () => {
    const fixture = await billingFixture();
    await mapAccountRoles(fixture, ["accounts_receivable", "fee_income", "cost_recovery_income"]);
    const matterId = await seedMatter(fixture, ACME, "Acme");
    const costEntryId = await seedCostEntry(fixture, matterId, {
      amountMinor: 4_200,
      disbursementClass: "soft",
    });
    const draft = createInvoiceDraft(
      fixture.database,
      { clientEntityId: ACME, currency: "USD", createdBy: fixture.memberUserId },
      options,
    );
    await commit(fixture.database, draft.effect);
    const claimed = await addClaimsToDraft(
      fixture.database,
      draft.invoiceId,
      [{ sourceKind: "cost_entry", sourceId: costEntryId }],
      options,
    );
    await commit(fixture.database, claimed.effect);

    const finalized = await finalizeInvoice(
      fixture.database,
      { invoiceId: draft.invoiceId, ...FINALIZE_DATES, finalizedBy: fixture.memberUserId },
      options,
    );
    await commit(fixture.database, finalized.effect);

    const recovery = await readOneRow<{ amount_minor: number }>(
      fixture.database,
      "SELECT amount_minor FROM ledger_line WHERE entry_id = ?1 AND account_id = ?2",
      finalized.ledgerEntryId,
      fixture.costRecoveryIncomeAccountId,
    );
    expect(recovery?.amount_minor).toBe(4_200);
  });

  it("REFUSES when a role the posting needs is unmapped, naming the role and where to set it", async () => {
    const fixture = await billingFixture();
    // Accounts receivable is mapped; the fee income the fee line credits is not.
    await mapAccountRoles(fixture, ["accounts_receivable", "client_costs_advanced"]);
    const { invoiceId } = await draftWithWork(fixture, ACME);

    const refusal = await finalizeInvoice(
      fixture.database,
      { invoiceId, ...FINALIZE_DATES, finalizedBy: fixture.memberUserId },
      options,
    ).catch((error: unknown) => error);
    expect(refusal).toMatchObject({ code: "account-role-unmapped" });
    expect(String(refusal)).toContain("fee_income");

    // And nothing happened: no number consumed, no entry locked, no posting.
    const invoice = await readOneRow<{ status: string; invoice_number: string | null }>(
      fixture.database,
      "SELECT status, invoice_number FROM invoice WHERE id = ?1",
      invoiceId,
    );
    expect(invoice?.status).toBe("draft");
    expect(invoice?.invoice_number).toBeNull();
    const allocations = await fixture.database
      .prepare("SELECT COUNT(*) AS count FROM invoice_number_allocation")
      .all<{ count: number }>();
    expect(allocations.results[0]?.count).toBe(0);
  });

  it("REFUSES when accounts receivable itself is unmapped", async () => {
    const fixture = await billingFixture();
    await mapAccountRoles(fixture, ["fee_income", "client_costs_advanced"]);
    const { invoiceId } = await draftWithWork(fixture, ACME);
    await expect(
      finalizeInvoice(
        fixture.database,
        { invoiceId, ...FINALIZE_DATES, finalizedBy: fixture.memberUserId },
        options,
      ),
    ).rejects.toMatchObject({ code: "account-role-unmapped" });
  });

  it("refuses an invoice with no lines", async () => {
    const fixture = await billingFixture();
    await mapAccountRoles(fixture, ["accounts_receivable", "fee_income"]);
    const draft = createInvoiceDraft(
      fixture.database,
      { clientEntityId: ACME, currency: "USD", createdBy: fixture.memberUserId },
      options,
    );
    await commit(fixture.database, draft.effect);
    await expect(
      finalizeInvoice(
        fixture.database,
        { invoiceId: draft.invoiceId, ...FINALIZE_DATES, finalizedBy: fixture.memberUserId },
        options,
      ),
    ).rejects.toMatchObject({ code: "invoice-has-no-lines" });
  });

  it("refuses to finalize an invoice that is already final", async () => {
    const fixture = await billingFixture();
    await mapAccountRoles(fixture, ["accounts_receivable", "fee_income", "client_costs_advanced"]);
    const { invoiceId } = await draftWithWork(fixture, ACME);
    const finalized = await finalizeInvoice(
      fixture.database,
      { invoiceId, ...FINALIZE_DATES, finalizedBy: fixture.memberUserId },
      options,
    );
    await commit(fixture.database, finalized.effect);
    await expect(
      finalizeInvoice(
        fixture.database,
        { invoiceId, ...FINALIZE_DATES, finalizedBy: fixture.memberUserId },
        options,
      ),
    ).rejects.toMatchObject({ code: "invoice-not-draft" });
  });

  it("aborts the whole batch when a claimed entry was voided between the read and the commit", async () => {
    const fixture = await billingFixture();
    await mapAccountRoles(fixture, ["accounts_receivable", "fee_income", "client_costs_advanced"]);
    const { invoiceId, timeEntryId } = await draftWithWork(fixture, ACME);

    const finalized = await finalizeInvoice(
      fixture.database,
      { invoiceId, ...FINALIZE_DATES, finalizedBy: fixture.memberUserId },
      options,
    );
    // The race: the entry is voided AFTER finalization read it and BEFORE the batch commits.
    await fixture.database
      .prepare("UPDATE time_entry SET status = 'void' WHERE id = ?1")
      .bind(timeEntryId)
      .run();

    await expect(expectRefusal(() => commit(fixture.database, finalized.effect))).rejects.toThrow();

    // The commit guard did its job: nothing landed.
    const invoice = await readOneRow<{ status: string }>(
      fixture.database,
      "SELECT status FROM invoice WHERE id = ?1",
      invoiceId,
    );
    expect(invoice?.status).toBe("draft");
    const allocations = await fixture.database
      .prepare("SELECT COUNT(*) AS count FROM invoice_number_allocation")
      .all<{ count: number }>();
    expect(allocations.results[0]?.count).toBe(0);
  });

  it("numbers sequentially and gaplessly across invoices in one scope", async () => {
    const fixture = await billingFixture();
    await mapAccountRoles(fixture, ["accounts_receivable", "fee_income", "client_costs_advanced"]);
    const numbers: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      const { invoiceId } = await draftWithWork(fixture, ACME);
      const finalized = await finalizeInvoice(
        fixture.database,
        { invoiceId, ...FINALIZE_DATES, finalizedBy: fixture.memberUserId },
        options,
      );
      await commit(fixture.database, finalized.effect);
      numbers.push(finalized.invoiceNumber);
    }
    expect(numbers).toEqual(["00001", "00002", "00003"]);

    const counter = await readOneRow<{ next_value: number }>(
      fixture.database,
      "SELECT next_value FROM invoice_number_counter WHERE scope_key = ''",
    );
    expect(counter?.next_value).toBe(4);
  });

  it("gives a per-office scope its own independent sequence", async () => {
    const fixture = await billingFixture();
    await mapAccountRoles(fixture, ["accounts_receivable", "fee_income", "client_costs_advanced"]);
    const first = await draftWithWork(fixture, ACME);
    const firstFinal = await finalizeInvoice(
      fixture.database,
      {
        invoiceId: first.invoiceId,
        ...FINALIZE_DATES,
        finalizedBy: fixture.memberUserId,
        numberScopeKey: "RENO",
      },
      options,
    );
    await commit(fixture.database, firstFinal.effect);
    const second = await draftWithWork(fixture, ACME);
    const secondFinal = await finalizeInvoice(
      fixture.database,
      {
        invoiceId: second.invoiceId,
        ...FINALIZE_DATES,
        finalizedBy: fixture.memberUserId,
        numberScopeKey: "VEGAS",
      },
      options,
    );
    await commit(fixture.database, secondFinal.effect);

    expect(firstFinal.invoiceNumber).toBe("RENO-00001");
    expect(secondFinal.invoiceNumber).toBe("VEGAS-00001");
  });

  it("a losing concurrent draw aborts its whole batch on the allocation key", async () => {
    const fixture = await billingFixture();
    await mapAccountRoles(fixture, ["accounts_receivable", "fee_income", "client_costs_advanced"]);
    const winner = await draftWithWork(fixture, ACME);
    const loser = await draftWithWork(fixture, ACME);

    // Both finalizations read the same counter value — the concurrent draw the allocation key
    // arbitrates.
    const winnerEffect = await finalizeInvoice(
      fixture.database,
      { invoiceId: winner.invoiceId, ...FINALIZE_DATES, finalizedBy: fixture.memberUserId },
      options,
    );
    const loserEffect = await finalizeInvoice(
      fixture.database,
      { invoiceId: loser.invoiceId, ...FINALIZE_DATES, finalizedBy: fixture.memberUserId },
      options,
    );
    expect(winnerEffect.drawnValue).toBe(loserEffect.drawnValue);

    await commit(fixture.database, winnerEffect.effect);
    await expect(expectRefusal(() => commit(fixture.database, loserEffect.effect))).rejects.toThrow(
      /UNIQUE constraint failed/,
    );

    // One number consumed, one invoice final, and the loser is untouched and retryable.
    const allocations = await fixture.database
      .prepare("SELECT COUNT(*) AS count FROM invoice_number_allocation")
      .all<{ count: number }>();
    expect(allocations.results[0]?.count).toBe(1);
    const loserInvoice = await readOneRow<{ status: string }>(
      fixture.database,
      "SELECT status FROM invoice WHERE id = ?1",
      loser.invoiceId,
    );
    expect(loserInvoice?.status).toBe("draft");

    // The retry re-reads the advanced counter and converges on the next value.
    const retry = await finalizeInvoice(
      fixture.database,
      { invoiceId: loser.invoiceId, ...FINALIZE_DATES, finalizedBy: fixture.memberUserId },
      options,
    );
    await commit(fixture.database, retry.effect);
    expect(retry.invoiceNumber).toBe("00002");
  });

  it("bills several of one client's matters on one invoice, with a balance row for each", async () => {
    const fixture = await billingFixture();
    await mapAccountRoles(fixture, ["accounts_receivable", "fee_income"]);
    const firstMatterId = await seedMatter(fixture, ACME, "Acme merger");
    const secondMatterId = await seedMatter(fixture, ACME, "Acme lease");
    const firstEntryId = await seedTimeEntry(fixture, firstMatterId, { durationMinutes: 60 });
    const secondEntryId = await seedTimeEntry(fixture, secondMatterId, { durationMinutes: 30 });
    const draft = createInvoiceDraft(
      fixture.database,
      { clientEntityId: ACME, currency: "USD", createdBy: fixture.memberUserId },
      options,
    );
    await commit(fixture.database, draft.effect);
    const claimed = await addClaimsToDraft(
      fixture.database,
      draft.invoiceId,
      [
        { sourceKind: "time_entry", sourceId: firstEntryId },
        { sourceKind: "time_entry", sourceId: secondEntryId },
      ],
      options,
    );
    await commit(fixture.database, claimed.effect);

    const finalized = await finalizeInvoice(
      fixture.database,
      { invoiceId: draft.invoiceId, ...FINALIZE_DATES, finalizedBy: fixture.memberUserId },
      options,
    );
    await commit(fixture.database, finalized.effect);

    const balances = await readInvoiceMatterBalances(fixture.database, draft.invoiceId);
    expect(balances).toHaveLength(2);
    expect(balances.reduce((total, row) => total + row.totalMinor, 0)).toBe(60_000);
    // The per-matter ceilings differ, which is the whole reason the balance is per (invoice, matter):
    // a trust transfer draws on one matter leaf and may not exceed that matter's share.
    expect(new Set(balances.map((row) => row.totalMinor))).toEqual(new Set([40_000, 20_000]));
  });
});

describe("a finalized invoice is immutable at the database", () => {
  async function finalizedFixture() {
    const fixture = await billingFixture();
    await mapAccountRoles(fixture, ["accounts_receivable", "fee_income", "client_costs_advanced"]);
    const seeded = await draftWithWork(fixture, ACME);
    const finalized = await finalizeInvoice(
      fixture.database,
      { invoiceId: seeded.invoiceId, ...FINALIZE_DATES, finalizedBy: fixture.memberUserId },
      options,
    );
    await commit(fixture.database, finalized.effect);
    return { fixture, ...seeded };
  }

  it("refuses an UPDATE to the invoice header", async () => {
    const { fixture, invoiceId } = await finalizedFixture();
    await expect(
      expectRefusal(() =>
        fixture.database
          .prepare("UPDATE invoice SET notes = 'reworded' WHERE id = ?1")
          .bind(invoiceId)
          .run(),
      ),
    ).rejects.toThrow(/immutable/);
  });

  it("refuses a DELETE of the invoice header", async () => {
    const { fixture, invoiceId } = await finalizedFixture();
    await expect(
      expectRefusal(() =>
        fixture.database.prepare("DELETE FROM invoice WHERE id = ?1").bind(invoiceId).run(),
      ),
    ).rejects.toThrow(/immutable/);
  });

  it("refuses an un-finalize back to draft", async () => {
    const { fixture, invoiceId } = await finalizedFixture();
    await expect(
      expectRefusal(() =>
        fixture.database
          .prepare("UPDATE invoice SET status = 'draft' WHERE id = ?1")
          .bind(invoiceId)
          .run(),
      ),
    ).rejects.toThrow(/immutable/);
  });

  it("refuses an UPDATE and a DELETE of a line", async () => {
    const { fixture, invoiceId } = await finalizedFixture();
    await expect(
      expectRefusal(() =>
        fixture.database
          .prepare("UPDATE invoice_line SET amount_minor = 1 WHERE invoice_id = ?1")
          .bind(invoiceId)
          .run(),
      ),
    ).rejects.toThrow(/immutable/);
    await expect(
      expectRefusal(() =>
        fixture.database
          .prepare("DELETE FROM invoice_line WHERE invoice_id = ?1")
          .bind(invoiceId)
          .run(),
      ),
    ).rejects.toThrow(/immutable/);
  });

  it("refuses releasing a claim, which would return billed work to unbilled", async () => {
    const { fixture, invoiceId } = await finalizedFixture();
    await expect(
      expectRefusal(() =>
        fixture.database
          .prepare("UPDATE invoice_wip_claim SET released_at = '2026-08-06' WHERE invoice_id = ?1")
          .bind(invoiceId)
          .run(),
      ),
    ).rejects.toThrow(/immutable/);
  });

  it("refuses editing or deleting a number allocation, and refuses overwriting one by REPLACE", async () => {
    const { fixture } = await finalizedFixture();
    await expect(
      expectRefusal(() =>
        fixture.database
          .prepare("UPDATE invoice_number_allocation SET drawn_value = 99 WHERE drawn_value = 1")
          .run(),
      ),
    ).rejects.toThrow(/append-only/);
    await expect(
      expectRefusal(() => fixture.database.prepare("DELETE FROM invoice_number_allocation").run()),
    ).rejects.toThrow(/append-only/);
    await expect(
      expectRefusal(() =>
        fixture.database
          .prepare(
            "INSERT OR REPLACE INTO invoice_number_allocation (scope_key, drawn_value, invoice_id, allocated_at) SELECT scope_key, drawn_value, invoice_id, '2026-01-01' FROM invoice_number_allocation LIMIT 1",
          )
          .run(),
      ),
    ).rejects.toThrow(/append-only/);
  });

  it("refuses over-application on the balance CHECK rather than by a pre-check", async () => {
    const { fixture, invoiceId } = await finalizedFixture();
    await expect(
      expectRefusal(() =>
        fixture.database
          .prepare(
            "UPDATE invoice_matter_balance SET applied_minor = total_minor + 1 WHERE invoice_id = ?1",
          )
          .bind(invoiceId)
          .run(),
      ),
    ).rejects.toThrow(/CHECK constraint failed/);
    // And the ordinary case still commits — the derived balance is mutable inside a posting batch,
    // which is exactly the arrangement account_balance uses.
    await fixture.database
      .prepare(
        "UPDATE invoice_matter_balance SET applied_minor = total_minor WHERE invoice_id = ?1",
      )
      .bind(invoiceId)
      .run();
    const balances = await readInvoiceMatterBalances(fixture.database, invoiceId);
    expect(balances[0]?.appliedMinor).toBe(balances[0]?.totalMinor);
  });
});
