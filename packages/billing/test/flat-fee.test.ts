import { describe, expect, it } from "vitest";
import type { InvoiceId, MatterId, TimeEntryId } from "@magna-carta/identifiers/types";
import { setBillingArrangement } from "../src/arrangements.ts";
import { addClaimsToDraft, createInvoiceDraft } from "../src/draft.ts";
import { addFlatFeeToDraft } from "../src/flat-fee.ts";
import { finalizeInvoice } from "../src/finalize.ts";
import { flatFeeBilledBeyondArrangementStatement } from "../src/fitness.ts";
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

async function seedFlatFeeMatter(
  fixture: BillingFixture,
  clientEntityId: string,
  amountMinor = 500_000,
): Promise<MatterId> {
  const matterId = await seedMatter(fixture, clientEntityId, "Flat fee");
  const set = await setBillingArrangement(
    fixture.database,
    {
      matterId,
      kind: "flat_fee",
      flatFeeAmountMinor: amountMinor,
      currency: "USD",
      validFrom: "2026-08-01",
      createdBy: null,
    },
    options,
  );
  await commit(fixture.database, set.effect);
  return matterId;
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

describe("the flat fee", () => {
  it("composes ONE line from the agreement, claims the contributing work at zero, and locks it at finalize", async () => {
    const fixture = await billingFixture();
    await mapAccountRoles(fixture, ["accounts_receivable", "fee_income"]);
    const matterId = await seedFlatFeeMatter(fixture, "entity_client");
    const first = await seedTimeEntry(fixture, matterId);
    const second = await seedTimeEntry(fixture, matterId, { durationMinutes: 90 });
    const invoiceId = await openDraft(fixture, "entity_client");

    const composed = await addFlatFeeToDraft(
      fixture.database,
      { invoiceId, matterId, contributingTimeEntryIds: [first, second] },
      options,
    );
    await commit(fixture.database, composed.effect);

    // One line, the agreement's amount, stamped with the agreement version that composed it.
    const line = await readOneRow<{
      kind: string;
      amount_minor: number;
      billing_arrangement_id: string | null;
    }>(
      fixture.database,
      `SELECT kind, amount_minor, billing_arrangement_id FROM invoice_line WHERE invoice_id = ?1`,
      invoiceId,
    );
    expect(line).toMatchObject({ kind: "flat_fee", amount_minor: 500_000 });
    expect(line?.billing_arrangement_id).not.toBeNull();

    // Claims at ZERO with no line: realization can attribute the covered work, the client sees one
    // fee.
    const claims = await fixture.database
      .prepare(
        `SELECT source_id, invoice_line_id, claimed_amount_minor FROM invoice_wip_claim WHERE invoice_id = ?1 ORDER BY source_id`,
      )
      .bind(invoiceId)
      .all<{ source_id: string; invoice_line_id: string | null; claimed_amount_minor: number }>();
    expect(claims.results).toHaveLength(2);
    for (const claim of claims.results) {
      expect(claim.invoice_line_id).toBeNull();
      expect(claim.claimed_amount_minor).toBe(0);
    }

    const finalized = await finalizeInvoice(
      fixture.database,
      { invoiceId, issueDate: "2026-08-05", dueDate: "2026-09-04", finalizedBy: null },
      options,
    );
    await commit(fixture.database, finalized.effect);
    expect(finalized.totalMinor).toBe(500_000);

    // Every contributing entry locked as billed by the finalize batch, exactly as hourly claims do.
    for (const timeEntryId of [first, second]) {
      const entry = await readOneRow<{ status: string; invoice_id: string | null }>(
        fixture.database,
        `SELECT status, invoice_id FROM time_entry WHERE id = ?1`,
        timeEntryId,
      );
      expect(entry).toMatchObject({ status: "billed", invoice_id: invoiceId });
    }
  });

  it("work a flat fee covers cannot also be billed hourly elsewhere: the claim guard holds at zero too", async () => {
    const fixture = await billingFixture();
    const matterId = await seedFlatFeeMatter(fixture, "entity_client");
    const timeEntryId = await seedTimeEntry(fixture, matterId);
    const invoiceId = await openDraft(fixture, "entity_client");
    const composed = await addFlatFeeToDraft(
      fixture.database,
      { invoiceId, matterId, contributingTimeEntryIds: [timeEntryId] },
      options,
    );
    await commit(fixture.database, composed.effect);

    const secondInvoiceId = await openDraft(fixture, "entity_client");
    const again = await addFlatFeeToDraft(
      fixture.database,
      { invoiceId: secondInvoiceId, matterId, contributingTimeEntryIds: [timeEntryId] },
      options,
    );
    await expect(expectRefusal(() => commit(fixture.database, again.effect))).rejects.toThrow();
  });

  it("refuses hourly time claims on a flat-fee matter by name, while its costs stay claimable", async () => {
    const fixture = await billingFixture();
    const matterId = await seedFlatFeeMatter(fixture, "entity_client");
    const timeEntryId = await seedTimeEntry(fixture, matterId);
    const costEntryId = await seedCostEntry(fixture, matterId);
    const invoiceId = await openDraft(fixture, "entity_client");

    await expect(
      addClaimsToDraft(
        fixture.database,
        invoiceId,
        [{ sourceKind: "time_entry", sourceId: timeEntryId }],
        options,
      ),
    ).rejects.toMatchObject({ code: "matter-not-billed-hourly" });

    // Advancing a filing fee is not a fee model: the cost line composes fine.
    const costs = await addClaimsToDraft(
      fixture.database,
      invoiceId,
      [{ sourceKind: "cost_entry", sourceId: costEntryId }],
      options,
    );
    await commit(fixture.database, costs.effect);
    expect(costs.lineIds).toHaveLength(1);
  });

  it("refuses without a flat-fee agreement, naming what the matter actually is", async () => {
    const fixture = await billingFixture();
    const matterId = await seedMatter(fixture, "entity_client", "Hourly");
    const invoiceId = await openDraft(fixture, "entity_client");
    await expect(
      addFlatFeeToDraft(fixture.database, { invoiceId, matterId }, options),
    ).rejects.toMatchObject({ code: "billing-arrangement-kind-mismatch" });
  });

  it("bills instalments against one agreement, and the fitness query reports billing past it", async () => {
    const fixture = await billingFixture();
    await mapAccountRoles(fixture, ["accounts_receivable", "fee_income"]);
    const matterId = await seedFlatFeeMatter(fixture, "entity_client", 500_000);

    // Two instalments summing past the agreed fee, each finalized: representable (no scheduler
    // polices instalments), and exactly what the over-billing report exists to say.
    for (const instalment of [300_000, 300_000]) {
      const invoiceId = await openDraft(fixture, "entity_client");
      const composed = await addFlatFeeToDraft(
        fixture.database,
        { invoiceId, matterId, amountMinor: instalment, description: "Instalment" },
        options,
      );
      await commit(fixture.database, composed.effect);
      const finalized = await finalizeInvoice(
        fixture.database,
        { invoiceId, issueDate: "2026-08-05", dueDate: "2026-09-04", finalizedBy: null },
        options,
      );
      await commit(fixture.database, finalized.effect);
    }

    const { results } = await flatFeeBilledBeyondArrangementStatement(fixture.database).all<{
      matter_id: string;
      agreed_minor: number;
      billed_minor: number;
    }>();
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      matter_id: matterId,
      agreed_minor: 500_000,
      billed_minor: 600_000,
    });
  });
});
