/*
 * What the time ledger is designed to show and the server does not yet answer.
 *
 * The screen was designed whole, against a record that carries an entry number, both dates, a
 * category, an activity code, a resolved rate, an internal memo, attached files and the invoice it
 * was billed onto. The listing answers a smaller record than that. Two wrong ways to handle the
 * difference were available: invent the missing values, or quietly drop the columns and controls
 * that carry them. Both leave a reader unable to tell what the product does from what it does not.
 *
 * So every gap is named here, once, as the noun phrase the Soon affordance completes into a
 * sentence and the cell hover states on its own. A column whose value cannot be read renders its
 * gap rather than a value; a control that cannot act renders disabled and says what it waits on.
 * When one of these starts being served, its entry comes out of this file and nothing else changes.
 */

/** A field the surface shows, and what has to arrive before it can carry a value. */
export interface TimeLedgerGap {
  /** The field as the reader sees it named, so the sentence and the column agree. */
  readonly field: string;
  /** What it waits on, as a noun phrase. Completed into a sentence by the Soon composition. */
  readonly waitsOn: string;
}

export const TIME_LEDGER_GAPS = {
  entryNumber: {
    field: "Entry Number",
    waitsOn: "a matter-scoped entry number on the time record",
  },
  dateEntered: {
    field: "Date Entered",
    waitsOn: "the entered date being served on the listing",
  },
  category: {
    field: "Category",
    waitsOn: "a category served on the listing",
  },
  activity: {
    field: "Activity",
    waitsOn: "the activity code being served on the listing",
  },
  rate: {
    field: "Rate",
    waitsOn: "the resolved rate being served on the listing",
  },
  attachments: {
    field: "Attachments",
    waitsOn: "files being attachable to a time entry",
  },
  memo: {
    field: "Internal Memo",
    waitsOn: "a memo column on the time record",
  },
  history: {
    field: "History",
    waitsOn: "an endpoint that serves an entry's recorded events",
  },
  invoice: {
    field: "Invoice",
    waitsOn: "the invoice a billed entry rides being served on the listing",
  },
  matter: {
    field: "Matter",
    waitsOn: "a route that refiles an entry onto another matter",
  },
  billingDisposition: {
    field: "Billing",
    waitsOn: "a billing disposition on the time record beyond billable or not",
  },
  reviewGate: {
    field: "Review",
    waitsOn: "the firm's review setting being served",
  },
  unsubmit: {
    field: "Unsubmit",
    waitsOn: "a route that returns a submitted entry to draft at its own timekeeper's hand",
  },
  deleteDraft: {
    field: "Delete Draft",
    waitsOn: "a route that removes a draft that never entered review",
  },
  rounding: {
    field: "Hours",
    waitsOn: "the firm's rounding increment being served",
  },
  timekeeperChange: {
    field: "Timekeeper",
    waitsOn: "a route that records one member's work under another member's hand",
  },
  incompleteCapture: {
    field: "Save",
    waitsOn: "a capture route that accepts an entry before it has a description and a duration",
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
  return `${gap.field} is not recorded yet. Waiting on ${gap.waitsOn}.`;
}

/** What a control waits on, as the noun phrase the Soon affordance takes. */
export function gapReason(name: TimeLedgerGapName): string {
  return TIME_LEDGER_GAPS[name].waitsOn;
}
