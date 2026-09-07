/*
 * What the cost ledger is designed to show and the server does not yet answer.
 *
 * The screen was designed whole, against a record that carries an entry number, both dates, the
 * person who recorded it, the files attached to it, the invoice it was billed onto, an internal
 * memo, a recorded kick-back reason and a history. The listing answers a smaller record than that.
 * The entered date, the recorder, the invoice and the kick-back reason have since been projected
 * onto the response — their columns were in `cost_entry` all along — and their entries came out of
 * this file, which is what an entry here is for.
 *
 * Two wrong ways to handle the difference were available: invent the missing values, or quietly
 * drop the columns and controls that carry them. Both leave a reader unable to tell what the
 * product does from what it does not.
 *
 * So every gap is named here, once, as the noun phrase the Soon affordance completes into a
 * sentence and the cell hover states on its own. A column whose value cannot be read renders its
 * gap rather than a value; a control that cannot act renders disabled and says what it waits on.
 * When one of these starts being served, its entry comes out of this file and nothing else changes.
 */

/** A field the surface shows, and what has to arrive before it can carry a value. */
export interface CostLedgerGap {
  /** The field as the reader sees it named, so the sentence and the column agree. */
  readonly field: string;
  /** What it waits on, as a noun phrase. Completed into a sentence by the Soon composition. */
  readonly waitsOn: string;
}

export const COST_LEDGER_GAPS = {
  entryNumber: {
    field: "Entry Number",
    waitsOn: "a matter-scoped entry number on the cost record",
  },
  attachments: {
    field: "Attachments",
    waitsOn: "a cost's attached files being served on the cost listing",
  },
  attachmentPicker: {
    field: "Attach File",
    waitsOn: "a picker that reaches the matter's own files",
  },
  history: {
    field: "History",
    waitsOn: "an endpoint that serves a cost's recorded events",
  },
  memo: {
    field: "Internal Memo",
    waitsOn: "an internal memo field on the cost entry record",
  },
  deleteDraft: {
    field: "Delete Draft",
    waitsOn: "a route that removes a draft that never entered review",
  },
  unsubmit: {
    field: "Unsubmit",
    waitsOn: "a route that returns a submitted cost to draft at its own recorder's hand",
  },
  reviewGate: {
    field: "Review",
    waitsOn: "the firm's review setting being served",
  },
  expenseCodeCatalogue: {
    field: "Expense Code",
    waitsOn: "a read of the expense-code catalogue this account is allowed to make",
  },
  screenshot: {
    field: "Screenshot",
    waitsOn: "screenshot capture in the problem report",
  },
} as const satisfies Readonly<Record<string, CostLedgerGap>>;

export type CostLedgerGapName = keyof typeof COST_LEDGER_GAPS;

/**
 * What a cell says where its value cannot be read.
 *
 * It is the same sentence the Soon affordance says about a control, because it is the same fact:
 * the column is real, the value is not there yet, and here is what it waits on. A bare blank would
 * read as a cost that has no files rather than as a product that cannot yet say.
 */
export function gapCellTitle(name: CostLedgerGapName): string {
  const gap = COST_LEDGER_GAPS[name];
  return `${gap.field} is not served yet. Waiting on ${gap.waitsOn}.`;
}

/** What a control waits on, as the noun phrase the Soon affordance takes. */
export function gapReason(name: CostLedgerGapName): string {
  return COST_LEDGER_GAPS[name].waitsOn;
}

/**
 * Whether this firm runs the review flow.
 *
 * It is a firm setting and nothing serves it to this app, so the surface takes the settled default:
 * off. Off means the review vocabulary is ABSENT rather than disabled — nothing solicits a
 * submission, no chain is drawn, and the lifecycle a reader sees runs draft to billed. A disabled
 * "Submit" would be soliciting a workflow this firm has never been asked about, and the Time tab
 * reads the same setting the same way, so one matter cannot show two different firms.
 *
 * When the setting is served, this constant becomes the read of it.
 */
export const REVIEW_GATE_ENABLED: boolean = false;
