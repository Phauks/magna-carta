/*
 * What a table's footer ends with: a short row of labelled figures.
 *
 * The value is TEXT, already formatted. Money, durations and counts each format through their own
 * home — the money package, the duration formatter, a plain count — and a strip that took minor
 * units and a currency would have to learn all three and would still be wrong for the fourth.
 */

/**
 * What a figure is over.
 *
 * `"rows-in-view"`, the default, is summed from the rows the table is showing: under a filter it
 * narrows, and the strip says "In view:" before it so the narrowing is never silent. `"whole-record"`
 * is a fact the table did not compute from its rows — a server-side count of what is waiting, a
 * total over pages not loaded — and no filter on the loaded rows changes it, so the strip never
 * presents it as narrowed. A count of what is waiting to be filed under an "In view:" would claim
 * the filter narrowed it, and it did not.
 */
export type GridFigureScope = "rows-in-view" | "whole-record";

/** One labelled figure. `caption` is its hover, where the label alone does not carry the meaning. */
export interface GridFigure {
  /** Stable across re-renders, so the row is keyed by identity rather than position. */
  readonly identifier: string;
  readonly label: string;
  readonly value: string;
  readonly caption?: string;
  /** What the figure is over; the rows in view unless the caller says the whole record. */
  readonly scope?: GridFigureScope;
}
