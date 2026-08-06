import type { SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import { describe, expect, it } from "vitest";
import { addClaimsToDraft, createInvoiceDraft } from "../src/draft.ts";
import { finalizeInvoice } from "../src/finalize.ts";
import {
  accountsReceivableTieOutStatement,
  billedWorkWithoutAFinalizedInvoiceStatement,
  claimedWorkNotLockedStatement,
  claimsOnVoidedInvoicesStatement,
  finalizedInvoicesWithoutBalanceRowsStatement,
  invoiceNumberSequenceGapsStatement,
  invoicesBillingAnotherClientsMatterStatement,
} from "../src/fitness.ts";
import {
  billingFixture,
  commit,
  mapAccountRoles,
  options,
  seedMatter,
  seedTimeEntry,
  type BillingFixture,
} from "./support.ts";

const ACME = "directoryOrganization_acme";
const BOREALIS = "directoryOrganization_borealis";

async function rowCount(statement: SqlStatement): Promise<number> {
  const { results } = await statement.all();
  return results.length;
}

async function healthyBook(): Promise<BillingFixture> {
  const fixture = await billingFixture();
  await mapAccountRoles(fixture, ["accounts_receivable", "fee_income"]);
  for (let index = 0; index < 3; index += 1) {
    const matterId = await seedMatter(fixture, ACME, `Acme ${index}`);
    const timeEntryId = await seedTimeEntry(fixture, matterId, { durationMinutes: 60 });
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
    const finalized = await finalizeInvoice(
      fixture.database,
      {
        invoiceId: draft.invoiceId,
        issueDate: "2026-08-05",
        dueDate: "2026-09-04",
        finalizedBy: fixture.memberUserId,
      },
      options,
    );
    await commit(fixture.database, finalized.effect);
  }
  return fixture;
}

describe("billing fitness queries — zero rows is healthy", () => {
  it("finds nothing wrong with a book built through the real write paths", async () => {
    const fixture = await healthyBook();
    const { database } = fixture;
    expect(await rowCount(accountsReceivableTieOutStatement(database))).toBe(0);
    expect(await rowCount(invoicesBillingAnotherClientsMatterStatement(database))).toBe(0);
    expect(await rowCount(claimsOnVoidedInvoicesStatement(database))).toBe(0);
    expect(await rowCount(claimedWorkNotLockedStatement(database))).toBe(0);
    expect(await rowCount(billedWorkWithoutAFinalizedInvoiceStatement(database))).toBe(0);
    expect(await rowCount(invoiceNumberSequenceGapsStatement(database))).toBe(0);
    expect(await rowCount(finalizedInvoicesWithoutBalanceRowsStatement(database))).toBe(0);
  });

  it("catches a subledger that has drifted from the accounts-receivable control account", async () => {
    const fixture = await healthyBook();
    // A receivable posted straight to the control account with no invoice behind it — the drift the
    // tie-out exists to name. Written directly, because no supported path can produce it.
    await fixture.database
      .prepare("UPDATE account_balance SET balance_minor = balance_minor + 1 WHERE account_id = ?1")
      .bind(fixture.accountsReceivableAccountId)
      .run();
    const { results } = await accountsReceivableTieOutStatement(fixture.database).all<{
      control_minor: number;
      subledger_minor: number;
    }>();
    expect(results).toHaveLength(1);
    expect(results[0]!.control_minor - results[0]!.subledger_minor).toBe(1);
  });

  it("catches an invoice line whose matter belongs to a different client", async () => {
    const fixture = await healthyBook();
    const strayMatterId = await seedMatter(fixture, BOREALIS, "Borealis");
    // addClaimsToDraft refuses this outright, and a finalized invoice's lines cannot be edited at
    // all, so the only way to produce the shape is to write a line behind the service's back — which
    // is precisely the door the fitness query exists to watch.
    const draft = createInvoiceDraft(
      fixture.database,
      { clientEntityId: ACME, currency: "USD", createdBy: fixture.memberUserId },
      options,
    );
    await commit(fixture.database, draft.effect);
    await fixture.database
      .prepare(
        `INSERT INTO invoice_line (id, invoice_id, line_index, matter_id, kind, description, amount_minor, currency, created_at)
         VALUES (?1, ?2, 0, ?3, 'fee', 'Work on another client''s matter', 10000, 'USD', '2026-08-05T15:00:00.000Z')`,
      )
      .bind(newIdentifier("invoiceLine"), draft.invoiceId, strayMatterId)
      .run();

    expect(await rowCount(invoicesBillingAnotherClientsMatterStatement(fixture.database))).toBe(1);
  });

  it("catches an active claim left on a voided invoice", async () => {
    const fixture = await billingFixture();
    const matterId = await seedMatter(fixture, ACME, "Acme");
    const timeEntryId = await seedTimeEntry(fixture, matterId);
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
    // Voiding WITHOUT releasing — the shape voidDraft exists to make impossible.
    await fixture.database
      .prepare(
        "UPDATE invoice SET status = 'void', voided_at = '2026-08-05T15:00:00.000Z' WHERE id = ?1",
      )
      .bind(draft.invoiceId)
      .run();

    expect(await rowCount(claimsOnVoidedInvoicesStatement(fixture.database))).toBe(1);
  });

  it("catches work marked billed with no finalized invoice behind it", async () => {
    const fixture = await billingFixture();
    const matterId = await seedMatter(fixture, ACME, "Acme");
    const timeEntryId = await seedTimeEntry(fixture, matterId, { status: "billed" });
    expect(timeEntryId).toBeTruthy();
    expect(await rowCount(billedWorkWithoutAFinalizedInvoiceStatement(fixture.database))).toBe(1);
  });

  it("catches a gap in a number sequence", async () => {
    const fixture = await healthyBook();
    const invoiceId = newIdentifier("invoice");
    await fixture.database
      .prepare(
        "INSERT INTO invoice (id, client_entity_id, currency, status, created_at, updated_at) VALUES (?1, ?2, 'USD', 'draft', '2026-08-05T15:00:00.000Z', '2026-08-05T15:00:00.000Z')",
      )
      .bind(invoiceId, ACME)
      .run();
    await fixture.database
      .prepare(
        "INSERT INTO invoice_number_allocation (scope_key, drawn_value, invoice_id, allocated_at) VALUES ('', 9, ?1, '2026-08-05T15:00:00.000Z')",
      )
      .bind(invoiceId)
      .run();
    expect(await rowCount(invoiceNumberSequenceGapsStatement(fixture.database))).toBe(1);
  });
});
