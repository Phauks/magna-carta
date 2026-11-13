/*
 * The three figures the bill register states about itself, beneath the table.
 *
 * They are the matter's money in the three places it can be: WORK NOBODY HAS CLAIMED, work a draft
 * is holding, and money a client has been asked for and has not paid. A firm reading a matter's
 * billing asks those three questions in that order, and none of them is a column, because none of
 * them is a property of a row.
 *
 * SCOPE IS PART OF THE FIGURE. Under a filter the register speaks for the rows in view and says so;
 * the unbilled figure is a fact about the matter rather than about any row, so it appears only when
 * nothing is filtered rather than silently answering a question nobody asked.
 *
 * MONEY LEAVES HERE AS MINOR UNITS. Rendering needs the matter's currency and the reader's locale,
 * and it belongs where the rendering happens.
 */
import { billUnpaidMinor, draftTotalMinor, type InvoiceRow } from "./invoice-standing.ts";
import type { MatterUnbilled } from "./billing-api.ts";

/** One labelled figure on the footer bar. */
export interface BillFigure {
  readonly identifier: string;
  readonly label: string;
  readonly amountMinor: number;
  /** The scope-honest caption, on the hover. */
  readonly caption: string;
}

export interface BillFigureContext {
  /** The matter's unbilled read, or null while it has not landed. */
  readonly unbilled: MatterUnbilled | null;
  readonly filtered: boolean;
  /** How an amount reads, so a caption can quote one. */
  readonly money: (amountMinor: number) => string;
}

/**
 * The figures, in reading order.
 *
 * Unbilled is dropped under a filter rather than restated: it counts time and costs, not invoices,
 * so no filter over invoices could narrow it and showing it beside two filtered figures would
 * invite the reader to add three numbers that do not belong to the same scope.
 */
export function billFigures(
  rows: readonly InvoiceRow[],
  context: BillFigureContext,
): readonly BillFigure[] {
  const inView = context.filtered ? ", in view" : "";
  const figures: BillFigure[] = [];

  const unbilled = context.unbilled;
  if (!context.filtered && unbilled !== null) {
    const timeWord = unbilled.timeEntryCount === 1 ? "time entry" : "time entries";
    const costWord = unbilled.costEntryCount === 1 ? "cost" : "costs";
    figures.push({
      identifier: "unbilled",
      label: "unbilled",
      amountMinor: unbilled.timeAmountMinor + unbilled.costAmountMinor,
      caption: `Time and costs not yet on a bill: ${String(unbilled.timeEntryCount)} ${timeWord} · ${context.money(unbilled.timeAmountMinor)}, ${String(unbilled.costEntryCount)} ${costWord} · ${context.money(unbilled.costAmountMinor)}.`,
    });
  }

  figures.push({
    identifier: "onDrafts",
    label: "on drafts",
    amountMinor: rows
      .filter((row) => row.summary.status === "draft")
      .reduce((total, row) => total + draftTotalMinor(row.detail), 0),
    caption: `Claimed by open drafts${inView}, from their lines.`,
  });

  figures.push({
    identifier: "outstanding",
    label: "outstanding",
    amountMinor: rows
      .filter((row) => row.summary.status === "final")
      .reduce((total, row) => total + billUnpaidMinor(row), 0),
    caption:
      `Still owed across this client's finalized invoices, all matters${inView}. Worked out from ` +
      `the per-matter balances, never stored.`,
  });

  return figures;
}

/** How many bills the register is holding, by kind, for the strip beside the tally. */
export interface BillCounts {
  readonly finalized: number;
  readonly drafts: number;
  readonly voided: number;
}

export function billCounts(rows: readonly InvoiceRow[]): BillCounts {
  return {
    finalized: rows.filter((row) => row.summary.status === "final").length,
    drafts: rows.filter((row) => row.summary.status === "draft").length,
    voided: rows.filter((row) => row.summary.status === "void").length,
  };
}
