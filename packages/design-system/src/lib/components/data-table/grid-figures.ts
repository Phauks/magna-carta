/*
 * What a table's footer ends with: a short row of labelled figures.
 *
 * The value is TEXT, already formatted. Money, durations and counts each format through their own
 * home — the money package, the duration formatter, a plain count — and a strip that took minor
 * units and a currency would have to learn all three and would still be wrong for the fourth.
 */

/** One labelled figure. `caption` is its hover, where the label alone does not carry the meaning. */
export interface GridFigure {
  /** Stable across re-renders, so the row is keyed by identity rather than position. */
  readonly identifier: string;
  readonly label: string;
  readonly value: string;
  readonly caption?: string;
}
