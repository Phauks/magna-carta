/*
 * The reconciliation screen's own arithmetic and words. The server works the figures; the screen
 * works them again the moment a box is ticked, so the two must agree, and a test holds the screen's
 * half to the same sums.
 *
 *   - A TICK MOVES THE FIGURES AT ONCE. Credited interest counts as a deposit and swept interest as
 *     a withdrawal, as on the bank statement.
 *   - THE LATEST REVIEW MARK DECIDES. Needs Review and Mark Resolved are marks on a line in time
 *     order; the newest one says whether the line still needs review.
 *   - A BALANCE CAN BE NEGATIVE. A trust bank account can be overdrawn, so the end-balance box reads
 *     a minus sign or brackets.
 *   - THE REPORT IS A DRAFT UNTIL FINISHED, watermarked on every page.
 */
import { describe, expect, it } from "vitest";
import type {
  TrustBankReconciliationDetail,
  TrustBankReconciliationNote,
} from "../src/lib/trust/reconciliation/reconciliation-api.ts";
import { galleryReconciliationService } from "../src/lib/trust/reconciliation/reconciliation-gallery-fixtures.ts";
import {
  balanceFieldText,
  changeSentence,
  entryLine,
  figuresOf,
  filterItems,
  interestLine,
  linesNeedingReview,
  noteCounts,
  readBalanceMinor,
  statusOf,
  typeCounts,
  withEndBalance,
  withTicks,
} from "../src/lib/trust/reconciliation/reconciliation-model.ts";
import {
  isDraftReport,
  reconciliationReport,
} from "../src/lib/trust/reconciliation/reconciliation-report.ts";

const money = (minor: number): string => `$${(minor / 100).toFixed(2)}`;

async function galleryDetail(
  state: "working" | "finished",
): Promise<TrustBankReconciliationDetail> {
  const outcome = await galleryReconciliationService(state).read("tbr_gallery_open");
  if (outcome.kind !== "ok") throw new Error("the gallery read failed");
  return outcome.value;
}

function note(
  overrides: Partial<TrustBankReconciliationNote> &
    Pick<TrustBankReconciliationNote, "kind" | "line">,
): TrustBankReconciliationNote {
  return {
    noteId: `note_${Math.random()}`,
    body: null,
    writtenBy: "usr_one",
    writtenByName: "Eleanor Whitfield",
    writtenAt: "2026-11-05T17:00:00.000Z",
    ...overrides,
  } as TrustBankReconciliationNote;
}

describe("figuresOf", () => {
  it("adds cleared deposits, takes away cleared withdrawals and compares with the end balance", () => {
    const figures = figuresOf(
      "USD",
      100_00,
      150_00,
      [
        { amountMinor: 80_00, cleared: true },
        { amountMinor: 20_00, cleared: false },
        { amountMinor: -30_00, cleared: true },
      ],
      [],
    );
    expect(figures.depositedMinor).toBe(80_00);
    expect(figures.withdrawnMinor).toBe(30_00);
    expect(figures.clearedBalanceMinor).toBe(150_00);
    expect(figures.differenceMinor).toBe(0);
    expect([figures.depositClearedCount, figures.depositCount]).toEqual([1, 2]);
    expect([figures.withdrawalClearedCount, figures.withdrawalCount]).toEqual([1, 1]);
  });

  it("counts credited interest as a deposit and swept interest as a withdrawal", () => {
    const figures = figuresOf(
      "USD",
      0,
      null,
      [],
      [
        { amountMinor: 10_00, cleared: true, kind: "credited" },
        { amountMinor: 4_00, cleared: true, kind: "swept" },
      ],
    );
    expect(figures.depositedMinor).toBe(10_00);
    expect(figures.withdrawnMinor).toBe(4_00);
    expect(figures.clearedBalanceMinor).toBe(6_00);
  });

  it("knows no difference until an end balance is entered", () => {
    expect(figuresOf("USD", 0, null, [], []).differenceMinor).toBeNull();
  });
});

describe("withTicks and withEndBalance", () => {
  it("moves the figures the moment a line is unticked", async () => {
    const detail = await galleryDetail("working");
    const cleared = detail.items.find((item) => item.cleared && item.amountMinor > 0);
    if (cleared === undefined) throw new Error("the gallery has no cleared deposit");
    const after = withTicks(detail, [{ line: entryLine(cleared.entryId), cleared: false }]);
    expect(after.items.find((item) => item.entryId === cleared.entryId)?.cleared).toBe(false);
    expect(after.figures.depositedMinor).toBeLessThan(detail.figures.depositedMinor);
    expect(after.figures.depositClearedCount).toBe(detail.figures.depositClearedCount - 1);
    // Ticking it again puts every figure back where it was.
    expect(withTicks(after, [{ line: entryLine(cleared.entryId), cleared: true }]).figures).toEqual(
      detail.figures,
    );
  });

  it("ticks an interest line as well as an item", async () => {
    const detail = await galleryDetail("working");
    const line = detail.interest[0];
    if (line === undefined) throw new Error("the gallery has no interest line");
    const after = withTicks(detail, [
      { line: interestLine(line.interestId), cleared: !line.cleared },
    ]);
    expect(after.interest[0]?.cleared).toBe(!line.cleared);
  });

  it("works the difference again from a new end balance", async () => {
    const detail = await galleryDetail("working");
    const after = withEndBalance(detail, detail.figures.clearedBalanceMinor);
    expect(after.figures.differenceMinor).toBe(0);
  });
});

describe("Needs Review", () => {
  const line = entryLine("ent_1");
  it("follows the latest mark on a line", () => {
    const marked = [
      note({ kind: "needs_review", line, writtenAt: "2026-11-01T00:00:00.000Z" }),
      note({ kind: "note", line, body: "Asked the bank" }),
    ];
    expect(linesNeedingReview(marked).has("entry:ent_1")).toBe(true);
    expect(linesNeedingReview([...marked, note({ kind: "resolved", line })]).size).toBe(0);
  });

  it("counts notes, not marks", () => {
    const counts = noteCounts([
      note({ kind: "needs_review", line }),
      note({ kind: "note", line, body: "One" }),
      note({ kind: "note", line, body: "Two" }),
    ]);
    expect(counts.get("entry:ent_1")).toBe(2);
  });
});

describe("the end balance box", () => {
  it("reads dollars and cents, with or without a dollar sign and commas", () => {
    expect(readBalanceMinor("$412,806.19")).toBe(41_280_619);
    expect(readBalanceMinor("12")).toBe(12_00);
  });

  it("reads an overdrawn balance with a minus sign or in brackets", () => {
    expect(readBalanceMinor("-15.00")).toBe(-15_00);
    expect(readBalanceMinor("(15.00)")).toBe(-15_00);
  });

  it("is empty when nothing is typed and refuses what is not an amount", () => {
    expect(readBalanceMinor("  ")).toBeNull();
    expect(readBalanceMinor("twelve")).toHaveProperty("refused");
  });

  it("writes the balance back as plain digits that read the same", () => {
    for (const minor of [0, 5, 41_280_619, -15_00]) {
      expect(readBalanceMinor(balanceFieldText(minor))).toBe(minor);
    }
    expect(balanceFieldText(null)).toBe("");
  });
});

describe("the item filters", () => {
  it("narrow by type and by state, and count each type", async () => {
    const detail = await galleryDetail("working");
    const review = linesNeedingReview(detail.notes);
    const uncleared = filterItems(detail.items, "all", "uncleared", review);
    expect(uncleared.every((item) => !item.cleared)).toBe(true);
    expect(filterItems(detail.items, "all", "new", review).every((item) => item.isNew)).toBe(true);
    expect(filterItems(detail.items, "all", "review", review).length).toBe(review.size);
    const counts = typeCounts(detail.items);
    expect(counts.get("all")).toBe(detail.items.length);
    const checks = filterItems(detail.items, "check", "all", review);
    expect(checks.length).toBe(counts.get("check"));
  });
});

describe("History sentences and status", () => {
  it("names the line a tick changed the way a person would", async () => {
    const detail = await galleryDetail("working");
    const item = detail.items.find((one) => one.number !== null);
    if (item === undefined) throw new Error("the gallery has no numbered item");
    const sentence = changeSentence(
      {
        changeId: "chg_1",
        kind: "cleared",
        line: entryLine(item.entryId),
        endDate: null,
        endBalanceMinor: null,
        cause: "edit",
        revertsChangeId: null,
        changedBy: "usr_one",
        changedByName: "Eleanor Whitfield",
        changedAt: "2026-11-05T17:00:00.000Z",
        canRevert: true,
      } as Parameters<typeof changeSentence>[0],
      detail,
      money,
    );
    expect(sentence).toBe(
      `Ticked Check ${item.number}, ${item.payeeOrFrom}, ${money(Math.abs(item.amountMinor))}`,
    );
  });

  it("is In Progress until finished, then Reconciled only with no difference", () => {
    expect(statusOf({ differenceMinor: 0, reconciliation: { finishedAt: null } })).toBe(
      "in-progress",
    );
    expect(
      statusOf({ differenceMinor: 0, reconciliation: { finishedAt: "2026-11-07T00:00:00Z" } }),
    ).toBe("reconciled");
    expect(
      statusOf({ differenceMinor: 5, reconciliation: { finishedAt: "2026-11-07T00:00:00Z" } }),
    ).toBe("difference");
  });
});

describe("the report", () => {
  it("is a DRAFT, watermarked, until the reconciliation is finished", async () => {
    const working = await galleryDetail("working");
    const draft = reconciliationReport({
      detail: working,
      accountName: "IOLTA",
      money,
      made: "2026-11-19T00:00:00Z",
    });
    expect(isDraftReport(working)).toBe(true);
    expect(JSON.stringify(draft)).toContain('"watermark":"DRAFT"');

    const finished = await galleryDetail("finished");
    const final = reconciliationReport({
      detail: finished,
      accountName: "IOLTA",
      money,
      made: "2026-11-19T00:00:00Z",
    });
    expect(isDraftReport(finished)).toBe(false);
    expect(JSON.stringify(final)).not.toContain("DRAFT");
  });
});
