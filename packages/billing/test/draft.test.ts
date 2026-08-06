import type { InvoiceId, InvoiceLineId, InvoiceWipClaimId } from "@magna-carta/identifiers/types";
import { describe, expect, it } from "vitest";
import { BillingValidationError } from "../src/billing-validation.ts";
import {
  addClaimsToDraft,
  createInvoiceDraft,
  MAXIMUM_CLAIMS_PER_INVOICE,
  removeClaim,
  updateDraftLine,
  voidDraft,
} from "../src/draft.ts";
import { readActiveInvoiceClaims, readInvoiceLines } from "../src/statements.ts";
import { readUnbilledWorkInProgress } from "../src/queries.ts";
import {
  billingFixture,
  clock,
  commit,
  options,
  readOneRow,
  seedCostEntry,
  seedMatter,
  seedTimeEntry,
} from "./support.ts";

const ACME = "directoryOrganization_acme";
const BOREALIS = "directoryOrganization_borealis";

async function draftFor(
  fixture: Awaited<ReturnType<typeof billingFixture>>,
  clientEntityId: string,
): Promise<InvoiceId> {
  const draft = createInvoiceDraft(
    fixture.database,
    { clientEntityId, currency: "USD", createdBy: fixture.memberUserId },
    options,
  );
  await commit(fixture.database, draft.effect);
  return draft.invoiceId;
}

describe("pulling work-in-progress onto a draft", () => {
  it("composes a line from the entry's snapshot and sets the mirror on the entry", async () => {
    const fixture = await billingFixture();
    const matterId = await seedMatter(fixture, ACME, "Acme");
    const timeEntryId = await seedTimeEntry(fixture, matterId, {
      durationMinutes: 90,
      rateE4: 4_000_000,
      narrative: "Drafted the motion",
    });
    const invoiceId = await draftFor(fixture, ACME);

    const claimed = await addClaimsToDraft(
      fixture.database,
      invoiceId,
      [{ sourceKind: "time_entry", sourceId: timeEntryId }],
      options,
    );
    await commit(fixture.database, claimed.effect);

    const lines = await readInvoiceLines(fixture.database, invoiceId);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.kind).toBe("fee");
    expect(lines[0]?.matterId).toBe(matterId);
    expect(lines[0]?.description).toBe("Drafted the motion");
    expect(lines[0]?.amountMinor).toBe(60_000); // 1.5 hours at 400.0000
    expect(lines[0]?.rateE4).toBe(4_000_000);

    const mirror = await readOneRow<{ invoice_id: string | null; status: string }>(
      fixture.database,
      "SELECT invoice_id, status FROM time_entry WHERE id = ?1",
      timeEntryId,
    );
    expect(mirror?.invoice_id).toBe(invoiceId);
    // The STATUS does not move at claim: bill review is exactly when a firm fixes a narrative or a
    // duration, so a claimed entry stays editable until finalization locks it.
    expect(mirror?.status).toBe("draft");
  });

  it("editing the claimed entry's narrative does not change what the client was told", async () => {
    const fixture = await billingFixture();
    const matterId = await seedMatter(fixture, ACME, "Acme");
    const timeEntryId = await seedTimeEntry(fixture, matterId, { narrative: "Called the client" });
    const invoiceId = await draftFor(fixture, ACME);
    const claimed = await addClaimsToDraft(
      fixture.database,
      invoiceId,
      [{ sourceKind: "time_entry", sourceId: timeEntryId }],
      options,
    );
    await commit(fixture.database, claimed.effect);

    await fixture.database
      .prepare("UPDATE time_entry SET narrative = ?2 WHERE id = ?1")
      .bind(timeEntryId, "Telephone conference regarding discovery")
      .run();

    const lines = await readInvoiceLines(fixture.database, invoiceId);
    expect(lines[0]?.description).toBe("Called the client");
  });

  it("a second draft claiming the same entry aborts its whole batch on the partial unique index", async () => {
    const fixture = await billingFixture();
    const matterId = await seedMatter(fixture, ACME, "Acme");
    const timeEntryId = await seedTimeEntry(fixture, matterId);
    const firstInvoiceId = await draftFor(fixture, ACME);
    const secondInvoiceId = await draftFor(fixture, ACME);

    // Both drafts compose against the same pre-claim state — the concurrent read the partial unique
    // index exists to arbitrate.
    const first = await addClaimsToDraft(
      fixture.database,
      firstInvoiceId,
      [{ sourceKind: "time_entry", sourceId: timeEntryId }],
      options,
    );
    const second = await addClaimsToDraft(
      fixture.database,
      secondInvoiceId,
      [{ sourceKind: "time_entry", sourceId: timeEntryId }],
      options,
    );
    await commit(fixture.database, first.effect);

    let caught: unknown;
    try {
      await commit(fixture.database, second.effect);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(String(caught)).toContain("UNIQUE constraint failed");

    // Exactly one winner, and the loser's LINE rolled back with its claim.
    expect(await readActiveInvoiceClaims(fixture.database, firstInvoiceId)).toHaveLength(1);
    expect(await readActiveInvoiceClaims(fixture.database, secondInvoiceId)).toHaveLength(0);
    expect(await readInvoiceLines(fixture.database, secondInvoiceId)).toHaveLength(0);
  });

  it("a released entry can be claimed again, and its history stays readable", async () => {
    const fixture = await billingFixture();
    const matterId = await seedMatter(fixture, ACME, "Acme");
    const timeEntryId = await seedTimeEntry(fixture, matterId);
    const abandonedInvoiceId = await draftFor(fixture, ACME);
    const claimed = await addClaimsToDraft(
      fixture.database,
      abandonedInvoiceId,
      [{ sourceKind: "time_entry", sourceId: timeEntryId }],
      options,
    );
    await commit(fixture.database, claimed.effect);
    const claimId = claimed.claimIds[0] as InvoiceWipClaimId;
    await commit(fixture.database, await removeClaim(fixture.database, claimId, options));

    const released = await readOneRow<{ released_at: string | null }>(
      fixture.database,
      "SELECT released_at FROM invoice_wip_claim WHERE id = ?1",
      claimId,
    );
    expect(released?.released_at).toBe(clock.now());

    const nextInvoiceId = await draftFor(fixture, ACME);
    const reclaimed = await addClaimsToDraft(
      fixture.database,
      nextInvoiceId,
      [{ sourceKind: "time_entry", sourceId: timeEntryId }],
      options,
    );
    await commit(fixture.database, reclaimed.effect);
    expect(await readActiveInvoiceClaims(fixture.database, nextInvoiceId)).toHaveLength(1);
  });

  it("refuses a matter belonging to another client, by name", async () => {
    const fixture = await billingFixture();
    const otherMatterId = await seedMatter(fixture, BOREALIS, "Borealis");
    const timeEntryId = await seedTimeEntry(fixture, otherMatterId);
    const invoiceId = await draftFor(fixture, ACME);

    await expect(
      addClaimsToDraft(
        fixture.database,
        invoiceId,
        [{ sourceKind: "time_entry", sourceId: timeEntryId }],
        options,
      ),
    ).rejects.toMatchObject({ code: "invoice-client-mismatch" });
  });

  // The line is written with the ENTRY's currency, but finalize aggregates every line under the
  // INVOICE's — so a line that disagreed was silently re-labelled at finalize and billed as if it
  // had always been in the invoice's money. Unreachable through the work-in-progress stores today
  // because their CHECK constraints pin them to USD, which means the guard was the schema rather
  // than any code: the first second currency in the registry would have removed it in silence.
  it("refuses claiming work recorded in a currency the invoice does not bill in", async () => {
    const fixture = await billingFixture();
    const matterId = await seedMatter(fixture, ACME, "Acme");
    const timeEntryId = await seedTimeEntry(fixture, matterId);
    const draft = createInvoiceDraft(
      fixture.database,
      { clientEntityId: ACME, currency: "EUR", createdBy: fixture.memberUserId },
      options,
    );
    await commit(fixture.database, draft.effect);

    await expect(
      addClaimsToDraft(
        fixture.database,
        draft.invoiceId,
        [{ sourceKind: "time_entry", sourceId: timeEntryId }],
        options,
      ),
    ).rejects.toMatchObject({ code: "invoice-line-currency-mismatch" });
  });

  it("refuses a matter with no client party rather than inventing one", async () => {
    const fixture = await billingFixture();
    const matterId = await seedMatter(fixture, ACME, "Acme");
    await fixture.database
      .prepare("DELETE FROM matter_party WHERE matter_id = ?1")
      .bind(matterId)
      .run();
    const timeEntryId = await seedTimeEntry(fixture, matterId);
    const invoiceId = await draftFor(fixture, ACME);

    await expect(
      addClaimsToDraft(
        fixture.database,
        invoiceId,
        [{ sourceKind: "time_entry", sourceId: timeEntryId }],
        options,
      ),
    ).rejects.toMatchObject({ code: "matter-has-no-client" });
  });

  it("refuses non-billable time, which is tracked for realization and never charged", async () => {
    const fixture = await billingFixture();
    const matterId = await seedMatter(fixture, ACME, "Acme");
    const invoiceId = await draftFor(fixture, ACME);
    const timeEntryId = await seedTimeEntry(fixture, matterId);
    await fixture.database
      .prepare("UPDATE time_entry SET rate_e4 = NULL, amount_minor = NULL WHERE id = ?1")
      .bind(timeEntryId)
      .run();

    await expect(
      addClaimsToDraft(
        fixture.database,
        invoiceId,
        [{ sourceKind: "time_entry", sourceId: timeEntryId }],
        options,
      ),
    ).rejects.toMatchObject({ code: "work-in-progress-not-billable" });
  });

  it("refuses more claims than the measured finalize batch can carry, and says what to do", async () => {
    const fixture = await billingFixture();
    const matterId = await seedMatter(fixture, ACME, "Acme");
    const invoiceId = await draftFor(fixture, ACME);
    const requests = Array.from({ length: MAXIMUM_CLAIMS_PER_INVOICE + 1 }, () => ({
      sourceKind: "time_entry" as const,
      sourceId: "timeEntry_placeholder",
    }));

    const refusal = await addClaimsToDraft(fixture.database, invoiceId, requests, options).catch(
      (error: unknown) => error,
    );
    expect(refusal).toBeInstanceOf(BillingValidationError);
    expect((refusal as BillingValidationError).code).toBe("claim-limit-exceeded");
    expect((refusal as BillingValidationError).message).toContain("split the work");
  });
});

describe("bill review edits the line", () => {
  it("recomputes the amount through the invoice-line rounding boundary when the quantity changes", async () => {
    const fixture = await billingFixture();
    const matterId = await seedMatter(fixture, ACME, "Acme");
    const timeEntryId = await seedTimeEntry(fixture, matterId, {
      durationMinutes: 90,
      rateE4: 4_000_000,
    });
    const invoiceId = await draftFor(fixture, ACME);
    const claimed = await addClaimsToDraft(
      fixture.database,
      invoiceId,
      [{ sourceKind: "time_entry", sourceId: timeEntryId }],
      options,
    );
    await commit(fixture.database, claimed.effect);
    const lineId = claimed.lineIds[0] as InvoiceLineId;

    // The reviewer trims half an hour off what the client is charged.
    await commit(
      fixture.database,
      await updateDraftLine(fixture.database, lineId, {
        quantityE4: 10_000,
        description: "Drafted the motion (reduced as a courtesy)",
      }),
    );

    const lines = await readInvoiceLines(fixture.database, invoiceId);
    expect(lines[0]?.amountMinor).toBe(40_000);
    expect(lines[0]?.description).toBe("Drafted the motion (reduced as a courtesy)");

    // And the timekeeper's own record is untouched: two records, both true.
    const entry = await readOneRow<{ duration_minutes: number; amount_minor: number }>(
      fixture.database,
      "SELECT duration_minutes, amount_minor FROM time_entry WHERE id = ?1",
      timeEntryId,
    );
    expect(entry?.duration_minutes).toBe(90);
    expect(entry?.amount_minor).toBe(60_000);
  });
});

describe("voiding a draft", () => {
  it("releases every claim, nulls every mirror, and returns the work to unbilled", async () => {
    const fixture = await billingFixture();
    const matterId = await seedMatter(fixture, ACME, "Acme");
    const timeEntryId = await seedTimeEntry(fixture, matterId, { durationMinutes: 60 });
    const costEntryId = await seedCostEntry(fixture, matterId, { amountMinor: 12_500 });
    const invoiceId = await draftFor(fixture, ACME);
    const claimed = await addClaimsToDraft(
      fixture.database,
      invoiceId,
      [
        { sourceKind: "time_entry", sourceId: timeEntryId },
        { sourceKind: "cost_entry", sourceId: costEntryId },
      ],
      options,
    );
    await commit(fixture.database, claimed.effect);

    const heldBack = await readUnbilledWorkInProgress(fixture.database, matterId);
    expect(heldBack.timeEntryCount).toBe(0);
    expect(heldBack.costEntryCount).toBe(0);

    await commit(
      fixture.database,
      await voidDraft(
        fixture.database,
        invoiceId,
        "billed in error",
        fixture.memberUserId,
        options,
      ),
    );

    expect(await readActiveInvoiceClaims(fixture.database, invoiceId)).toHaveLength(0);
    const returned = await readUnbilledWorkInProgress(fixture.database, matterId);
    expect(returned.timeEntryCount).toBe(1);
    expect(returned.timeAmountMinor).toBe(40_000);
    expect(returned.costEntryCount).toBe(1);
    expect(returned.costAmountMinor).toBe(12_500);

    const invoice = await readOneRow<{ status: string; void_reason: string }>(
      fixture.database,
      "SELECT status, void_reason FROM invoice WHERE id = ?1",
      invoiceId,
    );
    expect(invoice?.status).toBe("void");
    expect(invoice?.void_reason).toBe("billed in error");
  });

  it("refuses to void a second time — void is reachable only from draft", async () => {
    const fixture = await billingFixture();
    const invoiceId = await draftFor(fixture, ACME);
    await commit(
      fixture.database,
      await voidDraft(fixture.database, invoiceId, "abandoned", fixture.memberUserId, options),
    );
    await expect(
      voidDraft(fixture.database, invoiceId, "abandoned again", fixture.memberUserId, options),
    ).rejects.toMatchObject({ code: "invoice-not-draft" });
  });
});
