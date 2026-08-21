import { describe, expect, it } from "vitest";
import type { InvoiceId, MatterId, MatterRecoveryId } from "@magna-carta/identifiers/types";
import { setBillingArrangement } from "../src/arrangements.ts";
import {
  addContingencyFeeToDraft,
  contingencyFeeMinor,
  deriveContingencyFee,
  readMatterRecoveriesPage,
  recordMatterRecovery,
  voidMatterRecovery,
} from "../src/contingency.ts";
import { addClaimsToDraft, createInvoiceDraft } from "../src/draft.ts";
import { finalizeInvoice } from "../src/finalize.ts";
import {
  contingencyBilledBeyondEntitlementStatement,
  invoiceLinesUnderArrangementsNotInForceStatement,
} from "../src/fitness.ts";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import { insertInvoiceLineStatement } from "../src/statements.ts";
import {
  billingFixture,
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

async function seedContingencyMatter(
  fixture: BillingFixture,
  clientEntityId: string,
  basis: "gross_recovery" | "net_after_costs",
  shareE4 = 3_333,
): Promise<MatterId> {
  const matterId = await seedMatter(fixture, clientEntityId, "Contingency");
  const set = await setBillingArrangement(
    fixture.database,
    {
      matterId,
      kind: "contingency",
      contingencyShareE4: shareE4,
      contingencyBasis: basis,
      currency: "USD",
      validFrom: "2026-08-01",
      createdBy: null,
    },
    options,
  );
  await commit(fixture.database, set.effect);
  return matterId;
}

async function recordRecovery(
  fixture: BillingFixture,
  matterId: MatterId,
  amountMinor: number,
  recoveredDate = "2026-08-03",
): Promise<MatterRecoveryId> {
  const composed = recordMatterRecovery(
    fixture.database,
    {
      matterId,
      amountMinor,
      currency: "USD",
      recoveredDate,
      description: "Settlement of all claims",
      recordedBy: null,
    },
    options,
  );
  await commit(fixture.database, composed.effect);
  return composed.recoveryId;
}

async function openDraft(fixture: BillingFixture, clientEntityId: string): Promise<InvoiceId> {
  const draft = createInvoiceDraft(
    fixture.database,
    { clientEntityId, currency: "USD", createdBy: null },
    options,
  );
  await commit(fixture.database, draft.effect);
  return draft.invoiceId;
}

describe("the contingency fee", () => {
  it("computes rate-scale share of the base, collapsed once at the invoice-line boundary", () => {
    // A third of 100,000.00: 3333/10000 x 10,000,000 = 3,333,000 minor exactly.
    expect(contingencyFeeMinor(10_000_000, 3_333, "USD")).toBe(3_333_000);
    // Half a cent rounds away from zero at the line boundary: 25% of 0.50 = 0.125 -> 0.13.
    expect(contingencyFeeMinor(50, 2_500, "USD")).toBe(13);
    // The whole recovery is a legal share.
    expect(contingencyFeeMinor(123_456, 10_000, "USD")).toBe(123_456);
  });

  it("derives from the recorded recoveries as they stand NOW — recording another changes the next answer", async () => {
    const fixture = await billingFixture();
    const matterId = await seedContingencyMatter(fixture, "entity_client", "gross_recovery");
    await recordRecovery(fixture, matterId, 10_000_000);

    const first = await deriveContingencyFee(fixture.database, matterId);
    expect(first.feeMinor).toBe(3_333_000);
    expect(first.baseMinor).toBe(10_000_000);

    await recordRecovery(fixture, matterId, 2_000_000);
    const second = await deriveContingencyFee(fixture.database, matterId);
    expect(second.baseMinor).toBe(12_000_000);
    expect(second.feeMinor).toBe(3_999_600);
  });

  it("the net-after-costs election deducts the matter's advanced (hard) costs and never its soft costs", async () => {
    const fixture = await billingFixture();
    const matterId = await seedContingencyMatter(fixture, "entity_client", "net_after_costs");
    await recordRecovery(fixture, matterId, 10_000_000);
    await seedCostEntry(fixture, matterId, {
      amountMinor: 1_000_000,
      disbursementClass: "hard",
      status: "approved",
    });
    await seedCostEntry(fixture, matterId, {
      amountMinor: 500_000,
      disbursementClass: "soft",
      status: "approved",
    });

    const derivation = await deriveContingencyFee(fixture.database, matterId);
    expect(derivation.advancedCostsMinor).toBe(1_000_000);
    expect(derivation.baseMinor).toBe(9_000_000);
    expect(derivation.feeMinor).toBe(2_999_700);
  });

  it("only costs the firm stood behind reduce the base: approved and billed count, draft and submitted do not", async () => {
    const fixture = await billingFixture();
    const matterId = await seedContingencyMatter(fixture, "entity_client", "net_after_costs");
    await recordRecovery(fixture, matterId, 10_000_000);
    await seedCostEntry(fixture, matterId, {
      amountMinor: 600_000,
      disbursementClass: "hard",
      status: "approved",
    });
    await seedCostEntry(fixture, matterId, {
      amountMinor: 400_000,
      disbursementClass: "hard",
      status: "billed",
    });
    // Claims nobody has confirmed yet: neither reduces the client's recovery base.
    await seedCostEntry(fixture, matterId, {
      amountMinor: 5_000_000,
      disbursementClass: "hard",
      status: "draft",
    });
    await seedCostEntry(fixture, matterId, {
      amountMinor: 5_000_000,
      disbursementClass: "hard",
      status: "submitted",
    });

    const derivation = await deriveContingencyFee(fixture.database, matterId);
    expect(derivation.advancedCostsMinor).toBe(1_000_000);
    expect(derivation.baseMinor).toBe(9_000_000);
  });

  it("refuses without a recovery, and refuses a base the costs have consumed", async () => {
    const fixture = await billingFixture();
    const matterId = await seedContingencyMatter(fixture, "entity_client", "net_after_costs");
    await expect(deriveContingencyFee(fixture.database, matterId)).rejects.toMatchObject({
      code: "contingency-no-recovery",
    });

    await recordRecovery(fixture, matterId, 100_000);
    await seedCostEntry(fixture, matterId, {
      amountMinor: 100_000,
      disbursementClass: "hard",
      status: "approved",
    });
    await expect(deriveContingencyFee(fixture.database, matterId)).rejects.toMatchObject({
      code: "contingency-base-not-positive",
    });
  });

  it("a recovery is voided with a reason, never edited, and a voided recovery leaves the derivation", async () => {
    const fixture = await billingFixture();
    const matterId = await seedContingencyMatter(fixture, "entity_client", "gross_recovery");
    const keptId = await recordRecovery(fixture, matterId, 10_000_000);
    const wrongId = await recordRecovery(fixture, matterId, 90_000_000);

    // The record is frozen: editing the amount aborts on the trigger.
    await expect(
      expectRefusal(() =>
        fixture.database
          .prepare(`UPDATE matter_recovery SET amount_minor = 1 WHERE id = ?1`)
          .bind(keptId)
          .run(),
      ),
    ).rejects.toThrow(/voiding/);

    const voided = await voidMatterRecovery(
      fixture.database,
      matterId,
      wrongId,
      "Amount entered with an extra digit",
      null,
      options,
    );
    await commit(fixture.database, voided);
    const derivation = await deriveContingencyFee(fixture.database, matterId);
    expect(derivation.baseMinor).toBe(10_000_000);
    // Both records remain readable — the wrong one carries its reason.
    const wrongRow = await readOneRow<{ void_reason: string | null }>(
      fixture.database,
      `SELECT void_reason FROM matter_recovery WHERE id = ?1`,
      wrongId,
    );
    expect(wrongRow?.void_reason).toBe("Amount entered with an extra digit");
  });

  it("voiding a recovery through another matter answers not-found: the record is not that caller's to reach", async () => {
    const fixture = await billingFixture();
    const matterId = await seedContingencyMatter(fixture, "entity_client", "gross_recovery");
    const otherMatterId = await seedMatter(fixture, "entity_client", "Other");
    const recoveryId = await recordRecovery(fixture, matterId, 1_000_000);
    await expect(
      voidMatterRecovery(
        fixture.database,
        otherMatterId,
        recoveryId,
        "Wrong matter",
        null,
        options,
      ),
    ).rejects.toMatchObject({ code: "unknown-matter-recovery" });
  });

  it("composes the fee line from the derivation, stamped with the agreement version, and finalizes as an ordinary fee", async () => {
    const fixture = await billingFixture();
    await mapAccountRoles(fixture, ["accounts_receivable", "fee_income"]);
    const matterId = await seedContingencyMatter(fixture, "entity_client", "gross_recovery");
    await recordRecovery(fixture, matterId, 10_000_000);
    const invoiceId = await openDraft(fixture, "entity_client");

    const composed = await addContingencyFeeToDraft(fixture.database, invoiceId, matterId, options);
    await commit(fixture.database, composed.effect);
    expect(composed.derivation.feeMinor).toBe(3_333_000);

    const line = await readOneRow<{
      kind: string;
      rate_e4: number | null;
      amount_minor: number;
      description: string;
      billing_arrangement_id: string | null;
    }>(
      fixture.database,
      `SELECT kind, rate_e4, amount_minor, description, billing_arrangement_id FROM invoice_line WHERE id = ?1`,
      composed.lineId,
    );
    expect(line).toMatchObject({ kind: "fee", rate_e4: 3_333, amount_minor: 3_333_000 });
    expect(line?.description).toContain("33.33%");
    expect(line?.billing_arrangement_id).not.toBeNull();

    const finalized = await finalizeInvoice(
      fixture.database,
      { invoiceId, issueDate: "2026-08-05", dueDate: "2026-09-04", finalizedBy: null },
      options,
    );
    await commit(fixture.database, finalized.effect);
    expect(finalized.totalMinor).toBe(3_333_000);
  });

  it("bills incrementally: a later recovery bills exactly its own share, never the whole basis again", async () => {
    const fixture = await billingFixture();
    await mapAccountRoles(fixture, ["accounts_receivable", "fee_income"]);
    const matterId = await seedContingencyMatter(fixture, "entity_client", "gross_recovery");
    await recordRecovery(fixture, matterId, 10_000_000);

    const firstInvoiceId = await openDraft(fixture, "entity_client");
    const first = await addContingencyFeeToDraft(
      fixture.database,
      firstInvoiceId,
      matterId,
      options,
    );
    await commit(fixture.database, first.effect);
    expect(first.lineAmountMinor).toBe(3_333_000);
    const firstFinalized = await finalizeInvoice(
      fixture.database,
      {
        invoiceId: firstInvoiceId,
        issueDate: "2026-08-05",
        dueDate: "2026-09-04",
        finalizedBy: null,
      },
      options,
    );
    await commit(fixture.database, firstFinalized.effect);

    // A second recovery lands. The entitlement is now the share of A+B; the second bill charges
    // ONLY B's increment — the reproduction shape was the whole 3,999,600 billed again on top.
    await recordRecovery(fixture, matterId, 2_000_000);
    const secondInvoiceId = await openDraft(fixture, "entity_client");
    const second = await addContingencyFeeToDraft(
      fixture.database,
      secondInvoiceId,
      matterId,
      options,
    );
    expect(second.entitlementMinor).toBe(3_999_600);
    expect(second.previouslyBilledMinor).toBe(3_333_000);
    expect(second.lineAmountMinor).toBe(666_600);
    await commit(fixture.database, second.effect);
    const secondFinalized = await finalizeInvoice(
      fixture.database,
      {
        invoiceId: secondInvoiceId,
        issueDate: "2026-08-05",
        dueDate: "2026-09-05",
        finalizedBy: null,
      },
      options,
    );
    await commit(fixture.database, secondFinalized.effect);
    expect(secondFinalized.totalMinor).toBe(666_600);

    // Everything billed under the agreement sums to the entitlement exactly, and the over-billing
    // fitness report is empty.
    const billed = await readOneRow<{ billed_minor: number }>(
      fixture.database,
      `SELECT SUM(l.amount_minor) AS billed_minor FROM invoice_line l JOIN invoice i ON i.id = l.invoice_id
        WHERE l.billing_arrangement_id IS NOT NULL AND i.status = 'final'`,
    );
    expect(billed?.billed_minor).toBe(3_999_600);
    const { results } = await contingencyBilledBeyondEntitlementStatement(fixture.database).all();
    expect(results).toHaveLength(0);

    // And with nothing new recovered, a third bill has nothing to charge.
    const thirdInvoiceId = await openDraft(fixture, "entity_client");
    await expect(
      addContingencyFeeToDraft(fixture.database, thirdInvoiceId, matterId, options),
    ).rejects.toMatchObject({ code: "contingency-nothing-unbilled" });
  });

  it("an amendment does not resurrect the double-bill: the offset spans the matter's whole agreement chain", async () => {
    const fixture = await billingFixture();
    await mapAccountRoles(fixture, ["accounts_receivable", "fee_income"]);
    const matterId = await seedContingencyMatter(fixture, "entity_client", "gross_recovery");
    await recordRecovery(fixture, matterId, 10_000_000);

    const firstInvoiceId = await openDraft(fixture, "entity_client");
    const first = await addContingencyFeeToDraft(
      fixture.database,
      firstInvoiceId,
      matterId,
      options,
    );
    await commit(fixture.database, first.effect);
    const firstFinalized = await finalizeInvoice(
      fixture.database,
      {
        invoiceId: firstInvoiceId,
        issueDate: "2026-08-05",
        dueDate: "2026-09-04",
        finalizedBy: null,
      },
      options,
    );
    await commit(fixture.database, firstFinalized.effect);

    // The routine re-signed engagement letter: SAME share, new version. The recoveries are still
    // the matter's, so nothing about what was billed resets.
    const amended = await setBillingArrangement(
      fixture.database,
      {
        matterId,
        kind: "contingency",
        contingencyShareE4: 3_333,
        contingencyBasis: "gross_recovery",
        currency: "USD",
        validFrom: "2026-08-03",
        createdBy: null,
      },
      options,
    );
    await commit(fixture.database, amended.effect);
    expect(amended.version).toBe(2);

    await recordRecovery(fixture, matterId, 2_000_000);
    const secondInvoiceId = await openDraft(fixture, "entity_client");
    const second = await addContingencyFeeToDraft(
      fixture.database,
      secondInvoiceId,
      matterId,
      options,
    );
    // The reproduction reported previouslyBilledMinor 0 and billed the whole 3,999,600 again.
    expect(second.previouslyBilledMinor).toBe(3_333_000);
    expect(second.lineAmountMinor).toBe(666_600);
    await commit(fixture.database, second.effect);
    const secondFinalized = await finalizeInvoice(
      fixture.database,
      {
        invoiceId: secondInvoiceId,
        issueDate: "2026-08-05",
        dueDate: "2026-09-05",
        finalizedBy: null,
      },
      options,
    );
    await commit(fixture.database, secondFinalized.effect);
    expect(secondFinalized.totalMinor).toBe(666_600);

    // A further compose with nothing new recovered refuses, and the matter-level report is clean.
    const thirdInvoiceId = await openDraft(fixture, "entity_client");
    await expect(
      addContingencyFeeToDraft(fixture.database, thirdInvoiceId, matterId, options),
    ).rejects.toMatchObject({ code: "contingency-nothing-unbilled" });
    const report = await contingencyBilledBeyondEntitlementStatement(fixture.database).all();
    expect(report.results).toHaveLength(0);
  });

  it("the fitness report judges the MATTER across the chain: a version-scoped double bill cannot look clean", async () => {
    const fixture = await billingFixture();
    await mapAccountRoles(fixture, ["accounts_receivable", "fee_income"]);
    const matterId = await seedContingencyMatter(fixture, "entity_client", "gross_recovery");
    await recordRecovery(fixture, matterId, 10_000_000);
    const firstInvoiceId = await openDraft(fixture, "entity_client");
    const first = await addContingencyFeeToDraft(
      fixture.database,
      firstInvoiceId,
      matterId,
      options,
    );
    await commit(fixture.database, first.effect);
    const firstFinalized = await finalizeInvoice(
      fixture.database,
      {
        invoiceId: firstInvoiceId,
        issueDate: "2026-08-05",
        dueDate: "2026-09-04",
        finalizedBy: null,
      },
      options,
    );
    await commit(fixture.database, firstFinalized.effect);

    const amended = await setBillingArrangement(
      fixture.database,
      {
        matterId,
        kind: "contingency",
        contingencyShareE4: 3_333,
        contingencyBasis: "gross_recovery",
        currency: "USD",
        validFrom: "2026-08-03",
        createdBy: null,
      },
      options,
    );
    await commit(fixture.database, amended.effect);
    await recordRecovery(fixture, matterId, 2_000_000);

    // The PROBE: write the line a version-scoped offset would have written — the whole 3,999,600
    // again under version 2 — onto a second bill, and finalize it. Each version individually
    // "looks clean" (v1 billed 3,333,000; v2 billed 3,999,600, each at most one version's share of
    // the basis); the matter is double-billed, and the matter-level report must say so.
    const secondInvoiceId = await openDraft(fixture, "entity_client");
    await commit(fixture.database, {
      statements: [
        insertInvoiceLineStatement(fixture.database, {
          id: newIdentifier("invoiceLine"),
          invoiceId: secondInvoiceId,
          lineIndex: 0,
          matterId,
          kind: "fee",
          description: "Contingency fee billed as if never billed before",
          quantityE4: null,
          rateE4: 3_333,
          amountMinor: 3_999_600,
          currency: "USD",
          utbmsTaskCode: null,
          utbmsActivityCode: null,
          utbmsExpenseCode: null,
          taxTreatment: "exempt",
          billingArrangementId: amended.arrangementId,
          now: options.clock.now(),
        }),
      ],
      outboxMessages: [],
    });
    const secondFinalized = await finalizeInvoice(
      fixture.database,
      {
        invoiceId: secondInvoiceId,
        issueDate: "2026-08-05",
        dueDate: "2026-09-05",
        finalizedBy: null,
      },
      options,
    );
    await commit(fixture.database, secondFinalized.effect);

    const report = await contingencyBilledBeyondEntitlementStatement(fixture.database).all<{
      matter_id: string;
      billed_minor: number;
      entitlement_minor: number;
    }>();
    expect(report.results).toHaveLength(1);
    expect(report.results[0]).toMatchObject({
      matter_id: matterId,
      billed_minor: 7_332_600,
      entitlement_minor: 3_999_600,
    });
  });

  it("a share CHANGE re-levels against the in-force share: an increase bills the difference, a decrease refuses and is reported", async () => {
    const fixture = await billingFixture();
    await mapAccountRoles(fixture, ["accounts_receivable", "fee_income"]);
    const matterId = await seedContingencyMatter(fixture, "entity_client", "gross_recovery");
    await recordRecovery(fixture, matterId, 10_000_000);
    const firstInvoiceId = await openDraft(fixture, "entity_client");
    const first = await addContingencyFeeToDraft(
      fixture.database,
      firstInvoiceId,
      matterId,
      options,
    );
    await commit(fixture.database, first.effect);
    const firstFinalized = await finalizeInvoice(
      fixture.database,
      {
        invoiceId: firstInvoiceId,
        issueDate: "2026-08-05",
        dueDate: "2026-09-04",
        finalizedBy: null,
      },
      options,
    );
    await commit(fixture.database, firstFinalized.effect);

    // Amended UP to 40%: the entitlement is the in-force share of the whole basis, and the next
    // bill charges the difference over what the old share already took.
    const raised = await setBillingArrangement(
      fixture.database,
      {
        matterId,
        kind: "contingency",
        contingencyShareE4: 4_000,
        contingencyBasis: "gross_recovery",
        currency: "USD",
        validFrom: "2026-08-03",
        createdBy: null,
      },
      options,
    );
    await commit(fixture.database, raised.effect);
    const raisedInvoiceId = await openDraft(fixture, "entity_client");
    const raisedFee = await addContingencyFeeToDraft(
      fixture.database,
      raisedInvoiceId,
      matterId,
      options,
    );
    expect(raisedFee.entitlementMinor).toBe(4_000_000);
    expect(raisedFee.previouslyBilledMinor).toBe(3_333_000);
    expect(raisedFee.lineAmountMinor).toBe(667_000);
    // Not finalized — the draft asserts nothing, so the amount billed stays 3,333,000 for the
    // decrease below.

    // Amended DOWN to 20%: the entitlement falls below what the old share already billed. The
    // composer refuses, and the matter-level report carries the finding — the platform does not
    // decide what the firm owes back; the credit-note path is that decision's home.
    const lowered = await setBillingArrangement(
      fixture.database,
      {
        matterId,
        kind: "contingency",
        contingencyShareE4: 2_000,
        contingencyBasis: "gross_recovery",
        currency: "USD",
        validFrom: "2026-08-04",
        createdBy: null,
      },
      options,
    );
    await commit(fixture.database, lowered.effect);
    const loweredInvoiceId = await openDraft(fixture, "entity_client");
    await expect(
      addContingencyFeeToDraft(fixture.database, loweredInvoiceId, matterId, options),
    ).rejects.toMatchObject({ code: "contingency-nothing-unbilled" });
    const report = await contingencyBilledBeyondEntitlementStatement(fixture.database).all<{
      matter_id: string;
      billed_minor: number;
      entitlement_minor: number;
    }>();
    expect(report.results).toHaveLength(1);
    expect(report.results[0]).toMatchObject({
      matter_id: matterId,
      billed_minor: 3_333_000,
      entitlement_minor: 2_000_000,
    });
  });

  it("refuses a second contingency fee line on the same draft", async () => {
    const fixture = await billingFixture();
    const matterId = await seedContingencyMatter(fixture, "entity_client", "gross_recovery");
    await recordRecovery(fixture, matterId, 10_000_000);
    const invoiceId = await openDraft(fixture, "entity_client");
    const composed = await addContingencyFeeToDraft(fixture.database, invoiceId, matterId, options);
    await commit(fixture.database, composed.effect);
    await expect(
      addContingencyFeeToDraft(fixture.database, invoiceId, matterId, options),
    ).rejects.toMatchObject({ code: "contingency-fee-already-on-draft" });
  });

  it("a basis that shrinks after billing is surfaced by the fitness report: voiding the recovery behind a finalized fee", async () => {
    const fixture = await billingFixture();
    await mapAccountRoles(fixture, ["accounts_receivable", "fee_income"]);
    const matterId = await seedContingencyMatter(fixture, "entity_client", "gross_recovery");
    const recoveryId = await recordRecovery(fixture, matterId, 10_000_000);
    const invoiceId = await openDraft(fixture, "entity_client");
    const composed = await addContingencyFeeToDraft(fixture.database, invoiceId, matterId, options);
    await commit(fixture.database, composed.effect);
    const finalized = await finalizeInvoice(
      fixture.database,
      { invoiceId, issueDate: "2026-08-05", dueDate: "2026-09-04", finalizedBy: null },
      options,
    );
    await commit(fixture.database, finalized.effect);

    // True when it finalized, so nothing is flagged yet.
    const before = await contingencyBilledBeyondEntitlementStatement(fixture.database).all();
    expect(before.results).toHaveLength(0);

    // The sole recovery behind the fee is then voided. No write-path guard can catch this — the
    // bill was honest when it issued — so the fitness report is the mechanism that says the firm
    // now holds a billed fee its surviving basis does not support.
    const voided = await voidMatterRecovery(
      fixture.database,
      matterId,
      recoveryId,
      "Settlement fell through before funding",
      null,
      options,
    );
    await commit(fixture.database, voided);
    const after = await contingencyBilledBeyondEntitlementStatement(fixture.database).all<{
      matter_id: string;
      billed_minor: number;
      entitlement_minor: number;
    }>();
    expect(after.results).toHaveLength(1);
    expect(after.results[0]).toMatchObject({
      matter_id: matterId,
      billed_minor: 3_333_000,
      entitlement_minor: 0,
    });
  });

  it("a line billed under an agreement version that did not govern the bill's issue date is surfaced by the fitness report", async () => {
    const fixture = await billingFixture();
    await mapAccountRoles(fixture, ["accounts_receivable", "fee_income"]);
    const matterId = await seedContingencyMatter(fixture, "entity_client", "gross_recovery");
    await recordRecovery(fixture, matterId, 10_000_000);
    const invoiceId = await openDraft(fixture, "entity_client");
    const composed = await addContingencyFeeToDraft(fixture.database, invoiceId, matterId, options);
    await commit(fixture.database, composed.effect);
    // The agreement's valid_from is 2026-08-01; issuing the bill BEFORE that date bills under a
    // version that was not in force on the bill's own date.
    const finalized = await finalizeInvoice(
      fixture.database,
      { invoiceId, issueDate: "2026-07-01", dueDate: "2026-09-04", finalizedBy: null },
      options,
    );
    await commit(fixture.database, finalized.effect);
    const flagged = await invoiceLinesUnderArrangementsNotInForceStatement(fixture.database).all<{
      invoice_id: string;
    }>();
    expect(flagged.results).toHaveLength(1);
    expect(flagged.results[0]?.invoice_id).toBe(invoiceId);
  });

  it("refuses hourly time claims on a contingency matter by name", async () => {
    const fixture = await billingFixture();
    const matterId = await seedContingencyMatter(fixture, "entity_client", "gross_recovery");
    const timeEntryId = await seedTimeEntry(fixture, matterId);
    const invoiceId = await openDraft(fixture, "entity_client");
    await expect(
      addClaimsToDraft(
        fixture.database,
        invoiceId,
        [{ sourceKind: "time_entry", sourceId: timeEntryId }],
        options,
      ),
    ).rejects.toMatchObject({ code: "matter-not-billed-hourly" });
  });

  it("refuses composing on a matter without a contingency agreement", async () => {
    const fixture = await billingFixture();
    const matterId = await seedMatter(fixture, "entity_client", "Hourly");
    const invoiceId = await openDraft(fixture, "entity_client");
    await expect(
      addContingencyFeeToDraft(fixture.database, invoiceId, matterId, options),
    ).rejects.toMatchObject({ code: "billing-arrangement-kind-mismatch" });
  });
});

// The list read and the arithmetic read are two functions on purpose. This is the test that keeps
// them two: a page size on the list must never become a page size on the fee.
describe("the recovery list pages, and the fee does not", () => {
  it("walks every recovery a page at a time, oldest first", async () => {
    const fixture = await billingFixture();
    const matterId = await seedContingencyMatter(fixture, "entity_client", "gross_recovery");
    const dates = ["2026-01-05", "2026-02-05", "2026-03-05", "2026-04-05", "2026-05-05"];
    for (const date of dates) {
      await recordRecovery(fixture, matterId, 1_000_000, date);
    }

    const seen: string[] = [];
    let cursor: string | undefined;
    // Bounded, so a cursor that fails to advance fails the test instead of spinning in it.
    for (let page = 0; page < 5; page += 1) {
      const result = await readMatterRecoveriesPage(fixture.database, matterId, {
        cursor,
        pageSize: 2,
      });
      seen.push(...result.data.map((recovery) => recovery.recoveredDate));
      if (result.nextCursor === null) break;
      cursor = result.nextCursor;
    }
    expect(seen).toEqual(dates);
  });

  it("derives the fee from every recovery, not from the first page of them", async () => {
    const fixture = await billingFixture();
    const matterId = await seedContingencyMatter(fixture, "entity_client", "gross_recovery");
    // More recoveries than any page size the list uses. If the derivation ever started reading
    // through the paged function, the base would be short and the fee would be wrong by that much.
    for (let index = 0; index < 60; index += 1) {
      await recordRecovery(
        fixture,
        matterId,
        100_000,
        `2026-01-${String((index % 28) + 1).padStart(2, "0")}`,
      );
    }

    const derivation = await deriveContingencyFee(fixture.database, matterId);
    expect(derivation.baseMinor).toBe(6_000_000);
  });
});
