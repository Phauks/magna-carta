/*
 * What the conflicts surface is designed to show, and what the contract does not yet answer.
 *
 * The screens were designed against the whole professional-responsibility act: run a check, read
 * why each candidate surfaced and against whom, answer it on the record, and hand a court a written
 * account of the procedure. The four shipped operations answer most of that and not all of it. Two
 * wrong ways to handle the difference were available — invent the missing values, or quietly drop
 * the columns and controls that carry them — and both leave a reader unable to tell what the
 * product does from what it does not, which on this surface is a professional-conduct problem
 * rather than a presentation one.
 *
 * So every gap is named here once, as the noun phrase a Soon affordance completes into a sentence
 * and a cell's hover states on its own. A column whose value cannot be read states its gap; a
 * control that cannot act renders disabled and says what it waits on. When one of these starts
 * being served, its entry comes out of this file and nothing else changes.
 */

/** Something the surface shows, and what has to arrive before it can carry a value. */
export interface ConflictsGap {
  /** The field or control as the reader sees it named, so the sentence and the screen agree. */
  readonly field: string;
  /** What it waits on, as a noun phrase. Completed into a sentence by the Soon composition. */
  readonly waitsOn: string;
}

export const CONFLICTS_GAPS = {
  reportDocument: {
    field: "Assembled Report",
    waitsOn: "conflicts reports as saved documents",
  },
} as const satisfies Readonly<Record<string, ConflictsGap>>;

export type ConflictsGapName = keyof typeof CONFLICTS_GAPS;

/**
 * What a cell says where its value cannot be read.
 *
 * It is the same sentence the Soon affordance says about a control, because it is the same fact:
 * the column is real, the value is not there yet, and here is what it waits on. A bare blank would
 * read as a hit with no party rather than as a product that cannot yet say.
 */
export function gapCellTitle(name: ConflictsGapName): string {
  const gap = CONFLICTS_GAPS[name];
  return `Not built yet: ${gap.waitsOn}.`;
}

/** What a control waits on, as the noun phrase the Soon affordance takes. */
export function gapReason(name: ConflictsGapName): string {
  return CONFLICTS_GAPS[name].waitsOn;
}
