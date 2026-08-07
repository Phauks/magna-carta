import { describe, expect, it } from "vitest";
import { writeFirmSettingStatement } from "@magna-carta/data-access/setting-statements";
import type { InvoiceId } from "@magna-carta/identifiers/types";
import { addClaimsToDraft, createInvoiceDraft } from "../src/draft.ts";
import { finalizeInvoice } from "../src/finalize.ts";
import { multiMatterRenderShapeDefinition, readInvoiceRenderModel } from "../src/render-shape.ts";
import {
  billingFixture,
  commit,
  mapAccountRoles,
  mergeEffects,
  options,
  readOneRow,
  seedMatter,
  seedTimeEntry,
  type BillingFixture,
} from "./support.ts";

// A finalized bill across two matters: 60 minutes on one, 90 on the other, at 400.00/hour.
async function finalizedTwoMatterInvoice(
  fixture: BillingFixture,
  finalizeOverrides: { renderShape?: "combined" | "per_matter_pages" } = {},
): Promise<{ invoiceId: InvoiceId; firstMatter: string; secondMatter: string }> {
  const firstMatter = await seedMatter(fixture, "entity_client", "First");
  const secondMatter = await seedMatter(fixture, "entity_client", "Second");
  const firstEntry = await seedTimeEntry(fixture, firstMatter);
  const secondEntry = await seedTimeEntry(fixture, secondMatter, { durationMinutes: 90 });
  const draft = createInvoiceDraft(
    fixture.database,
    { clientEntityId: "entity_client", currency: "USD", createdBy: null },
    options,
  );
  await commit(fixture.database, draft.effect);
  const claims = await addClaimsToDraft(
    fixture.database,
    draft.invoiceId,
    [
      { sourceKind: "time_entry", sourceId: firstEntry },
      { sourceKind: "time_entry", sourceId: secondEntry },
    ],
    options,
  );
  await commit(fixture.database, claims.effect);
  const finalized = await finalizeInvoice(
    fixture.database,
    {
      invoiceId: draft.invoiceId,
      issueDate: "2026-08-05",
      dueDate: "2026-09-04",
      finalizedBy: null,
      ...finalizeOverrides,
    },
    options,
  );
  await commit(fixture.database, finalized.effect);
  return { invoiceId: draft.invoiceId, firstMatter, secondMatter };
}

describe("the multi-matter render shape", () => {
  it("finalize snapshots the shipped default: per-matter pages plus a summary", async () => {
    const fixture = await billingFixture();
    await mapAccountRoles(fixture, ["accounts_receivable", "fee_income"]);
    const { invoiceId, firstMatter, secondMatter } = await finalizedTwoMatterInvoice(fixture);

    const stored = await readOneRow<{ render_shape: string | null }>(
      fixture.database,
      `SELECT render_shape FROM invoice WHERE id = ?1`,
      invoiceId,
    );
    expect(stored?.render_shape).toBe("per_matter_pages");

    const model = await readInvoiceRenderModel(fixture.database, invoiceId);
    expect(model?.renderShape).toBe("per_matter_pages");
    expect(model?.pages).toHaveLength(2);
    expect(model?.pages[0]).toMatchObject({ matterId: firstMatter, subtotalMinor: 40_000 });
    expect(model?.pages[1]).toMatchObject({ matterId: secondMatter, subtotalMinor: 60_000 });
    // The summary: each matter's total plus the grand total, and the parts sum to the whole.
    expect(model?.summary?.matters).toEqual([
      { matterId: firstMatter, totalMinor: 40_000 },
      { matterId: secondMatter, totalMinor: 60_000 },
    ]);
    expect(model?.summary?.totalMinor).toBe(100_000);
    expect(model?.totalMinor).toBe(100_000);
  });

  it("the firm's configured default governs, and an explicit per-invoice choice overrides it", async () => {
    const fixture = await billingFixture();
    await mapAccountRoles(fixture, ["accounts_receivable", "fee_income"]);
    // The firm chose the combined document.
    await commit(fixture.database, {
      statements: [
        writeFirmSettingStatement(
          fixture.database,
          multiMatterRenderShapeDefinition,
          "combined",
          options.clock.now(),
        ),
      ],
      outboxMessages: [],
    });
    const combined = await finalizedTwoMatterInvoice(fixture);
    const combinedModel = await readInvoiceRenderModel(fixture.database, combined.invoiceId);
    expect(combinedModel?.renderShape).toBe("combined");
    expect(combinedModel?.pages).toHaveLength(1);
    expect(combinedModel?.pages[0]?.lines).toHaveLength(2);
    expect(combinedModel?.summary).toBeNull();

    // This one bill goes out per-matter regardless of the firm default.
    const overridden = await finalizedTwoMatterInvoice(fixture, {
      renderShape: "per_matter_pages",
    });
    const overriddenModel = await readInvoiceRenderModel(fixture.database, overridden.invoiceId);
    expect(overriddenModel?.renderShape).toBe("per_matter_pages");
    expect(overriddenModel?.pages).toHaveLength(2);
  });

  it("a single-matter bill collapses to one page with no summary under either shape", async () => {
    const fixture = await billingFixture();
    await mapAccountRoles(fixture, ["accounts_receivable", "fee_income"]);
    const matterId = await seedMatter(fixture, "entity_client", "Only");
    const entry = await seedTimeEntry(fixture, matterId);
    const draft = createInvoiceDraft(
      fixture.database,
      { clientEntityId: "entity_client", currency: "USD", createdBy: null },
      options,
    );
    const claims = await commit(fixture.database, draft.effect).then(() =>
      addClaimsToDraft(
        fixture.database,
        draft.invoiceId,
        [{ sourceKind: "time_entry", sourceId: entry }],
        options,
      ),
    );
    await commit(fixture.database, claims.effect);
    const finalized = await finalizeInvoice(
      fixture.database,
      {
        invoiceId: draft.invoiceId,
        issueDate: "2026-08-05",
        dueDate: "2026-09-04",
        finalizedBy: null,
      },
      options,
    );
    await commit(fixture.database, finalized.effect);

    const model = await readInvoiceRenderModel(fixture.database, draft.invoiceId);
    expect(model?.renderShape).toBe("per_matter_pages"); // what the firm chose is part of the record
    expect(model?.pages).toHaveLength(1);
    expect(model?.pages[0]?.matterId).toBe(matterId);
    expect(model?.summary).toBeNull();
  });

  it("an invoice finalized before the shape existed derives as combined: a null column is the legacy answer", async () => {
    const fixture = await billingFixture();
    await mapAccountRoles(fixture, ["accounts_receivable", "fee_income"]);
    const { invoiceId } = await finalizedTwoMatterInvoice(fixture);
    // Simulate the pre-column record the way it actually exists: no stored shape. The freeze
    // trigger rightly refuses an UPDATE on a finalized invoice, so the draft-era write is the shape
    // this simulation takes.
    const draft = createInvoiceDraft(
      fixture.database,
      { clientEntityId: "entity_client", currency: "USD", createdBy: null },
      options,
    );
    await commit(fixture.database, draft.effect);
    const model = await readInvoiceRenderModel(fixture.database, draft.invoiceId);
    expect(model?.renderShape).toBe("combined");
    expect(await readInvoiceRenderModel(fixture.database, invoiceId)).not.toBeNull();
  });
});
