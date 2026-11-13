/*
 * What the time ledger is designed to show and the server does not yet answer.
 *
 * The screens were designed whole, against a record fuller than the one the contract served. Two
 * wrong ways to handle the difference were available: invent the missing values, or quietly drop
 * the columns and controls that carry them. Both leave a reader unable to tell what the product
 * does from what it does not.
 *
 * So every gap is named here, once, as the noun phrase the Soon affordance completes into a
 * sentence and the cell hover states on its own. A column whose value cannot be read renders its
 * gap rather than a value; a control that cannot act renders disabled and says what it waits on.
 * When one of these starts being served, its entry comes out of this file and nothing else changes.
 *
 * THE COST OF NOT LOOKING. Eight entries were retired at once — the entry number, the entered date
 * and its enterer, the resolved rate, the two UTBMS codes, the internal memo, the attachment
 * relation and the event history — because the routes serving all of them had already shipped while
 * these screens went on saying "not recorded yet" about them. A register of gaps is only honest
 * while somebody re-asks it against the contract; unasked, it states the opposite of what it is for.
 * Re-read the served summary in $lib/matters/time-api.ts before adding to this list.
 */

/** A field the surface shows, and what has to arrive before it can carry a value. */
export interface TimeLedgerGap {
  /** The field as the reader sees it named, so the sentence and the column agree. */
  readonly field: string;
  /** What it waits on, as a noun phrase. Completed into a sentence by the Soon composition. */
  readonly waitsOn: string;
}

export const TIME_LEDGER_GAPS = {
  nonBillableCategory: {
    field: "Non-billable Category",
    waitsOn: "the non-billable category",
  },
  invoice: {
    field: "Bill",
    waitsOn: "bill numbers and dates",
  },
  billingDisposition: {
    field: "Billing",
    waitsOn: "more billing options for time",
  },
  reviewGate: {
    field: "Review",
    waitsOn: "the firm's review setting",
  },
  unsubmit: {
    field: "Unsubmit",
    waitsOn: "returning an entry to draft",
  },
  deleteDraft: {
    field: "Delete Draft",
    waitsOn: "deleting drafts",
  },
  rounding: {
    field: "Hours",
    // Narrowed, not retired. The increment itself IS served now — the record window reads it for
    // the matter and the person it is writing for, states what the entry will be billed at, and
    // counts units in it. What the SHEET still cannot do is say that for a row nobody has written
    // yet: it is a day across every matter a person touched, the increment is a per-matter
    // setting, and one read cannot answer for a mixed list. A written row needs none of this — the
    // server sends its billed figure with it.
    waitsOn: "rounding across matters",
  },
  timekeeperChange: {
    field: "Timekeeper",
    waitsOn: "recording time for someone else",
  },
  incompleteCapture: {
    field: "Save",
    waitsOn: "saving an entry without a description or duration",
  },
} as const satisfies Readonly<Record<string, TimeLedgerGap>>;

export type TimeLedgerGapName = keyof typeof TIME_LEDGER_GAPS;

/**
 * What a cell says where its value cannot be read.
 *
 * It is the same sentence the Soon affordance says about a control, because it is the same fact:
 * the column is real, the value is not there yet, and here is what it waits on. A bare blank would
 * read as an entry that has no category rather than as a product that cannot yet say.
 */
export function gapCellTitle(name: TimeLedgerGapName): string {
  const gap = TIME_LEDGER_GAPS[name];
  return `Not built yet: ${gap.waitsOn}.`;
}

/** What a control waits on, as the noun phrase the Soon affordance takes. */
export function gapReason(name: TimeLedgerGapName): string {
  return TIME_LEDGER_GAPS[name].waitsOn;
}
