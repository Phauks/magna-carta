import { describe, expect, it } from "vitest";
import type { InvoiceId, MatterId, MatterRecoveryId } from "@magna-carta/identifiers/types";
import { setBillingArrangement } from "../src/arrangements.ts";
import {
  addContingencyFeeToDraft,
  contingencyFeeMinor,
  deriveContingencyFee,
  recordMatterRecovery,
  voidMatterRecovery,
} from "../src/contingency.ts";
import { addClaimsToDraft, createInvoiceDraft } from "../src/draft.ts";
import { finalizeInvoice } from "../src/finalize.ts";
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
): Promise<MatterRecoveryId> {
  const composed = recordMatterRecovery(
    fixture.database,
    {
      matterId,
      amountMinor,
      currency: "USD",
      recoveredDate: "2026-08-03",
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
    await seedCostEntry(fixture, matterId, { amountMinor: 1_000_000, disbursementClass: "hard" });
    await seedCostEntry(fixture, matterId, { amountMinor: 500_000, disbursementClass: "soft" });

    const derivation = await deriveContingencyFee(fixture.database, matterId);
    expect(derivation.advancedCostsMinor).toBe(1_000_000);
    expect(derivation.baseMinor).toBe(9_000_000);
    expect(derivation.feeMinor).toBe(2_999_700);
  });

  it("refuses without a recovery, and refuses a base the costs have consumed", async () => {
    const fixture = await billingFixture();
    const matterId = await seedContingencyMatter(fixture, "entity_client", "net_after_costs");
    await expect(deriveContingencyFee(fixture.database, matterId)).rejects.toMatchObject({
      code: "contingency-no-recovery",
    });

    await recordRecovery(fixture, matterId, 100_000);
    await seedCostEntry(fixture, matterId, { amountMinor: 100_000, disbursementClass: "hard" });
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
