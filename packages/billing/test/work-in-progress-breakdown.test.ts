import { fromMinor, toMinor } from "@magna-carta/money/format";
import { sum, USD } from "@magna-carta/money/money";
import { describe, expect, it } from "vitest";
import { addClaimsToDraft, createInvoiceDraft } from "../src/draft.ts";
import { readUnbilledWorkInProgress, readWorkInProgressBreakdown } from "../src/queries.ts";
import {
  billingFixture,
  commit,
  options,
  seedCostEntry,
  seedMatter,
  seedTimeEntry,
} from "./support.ts";

// THE AGREEMENT TEST for the firm-wide work in progress. Per matter, the entries no draft holds must
// equal the per-matter hot read exactly; the breakdown adds a timekeeper and the draft-held work
// beside it, and nothing else.

const totalOf = (minors: readonly number[]): number =>
  minors.length === 0 ? 0 : toMinor(sum(minors.map((minor) => fromMinor(minor, USD))));

describe("the work-in-progress breakdown", () => {
  it("agrees with the per-matter read for work no draft holds, and reports draft-held work beside it", async () => {
    const fixture = await billingFixture();
    const alder = await seedMatter(fixture, "entity_alder", "Alder");
    const washoe = await seedMatter(fixture, "entity_washoe", "Washoe");
    await seedTimeEntry(fixture, alder, { amountMinor: 40_000, durationMinutes: 60 });
    await seedTimeEntry(fixture, alder, { amountMinor: 20_000, durationMinutes: 30 });
    await seedTimeEntry(fixture, alder, { amountMinor: 99_000, status: "billed" });
    await seedTimeEntry(fixture, alder, { amountMinor: 99_000, status: "void" });
    await seedCostEntry(fixture, alder, { amountMinor: 12_500 });
    const held = await seedTimeEntry(fixture, washoe, { amountMinor: 30_000, durationMinutes: 45 });
    await seedTimeEntry(fixture, washoe, { amountMinor: 8_000, durationMinutes: 12 });

    // One Washoe entry is put on a draft bill.
    const draft = createInvoiceDraft(
      fixture.database,
      { clientEntityId: "entity_washoe", currency: "USD", createdBy: null },
      options,
    );
    await commit(fixture.database, draft.effect);
    const claimed = await addClaimsToDraft(
      fixture.database,
      draft.invoiceId,
      [{ sourceKind: "time_entry", sourceId: held }],
      options,
    );
    await commit(fixture.database, claimed.effect);

    const breakdown = await readWorkInProgressBreakdown(fixture.database);
    expect(breakdown.truncated).toBe(false);

    for (const matterId of [alder, washoe]) {
      const owned = await readUnbilledWorkInProgress(fixture.database, matterId);
      const free = breakdown.rows.filter((row) => row.matterId === matterId && !row.onDraft);
      const timeRows = free.filter((row) => row.kind === "time");
      const costRows = free.filter((row) => row.kind === "cost");
      expect(totalOf(timeRows.map((row) => row.amountMinor))).toBe(owned.timeAmountMinor);
      expect(timeRows.reduce((count, row) => count + row.entryCount, 0)).toBe(owned.timeEntryCount);
      expect(totalOf(costRows.map((row) => row.amountMinor))).toBe(owned.costAmountMinor);
      expect(costRows.reduce((count, row) => count + row.entryCount, 0)).toBe(owned.costEntryCount);
    }

    const onDraft = breakdown.rows.filter((row) => row.onDraft);
    expect(onDraft).toHaveLength(1);
    expect(onDraft[0]).toMatchObject({ matterId: washoe, amountMinor: 30_000, minutes: 45 });
    expect(breakdown.rows.every((row) => row.clientEntityId !== null)).toBe(true);
    expect(
      breakdown.rows
        .filter((row) => row.kind === "time")
        .every((row) => row.timekeeperUserId === fixture.memberUserId),
    ).toBe(true);
  });
});
