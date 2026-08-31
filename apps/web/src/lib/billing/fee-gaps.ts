/*
 * What the Fees ledger is designed to show and the server does not answer yet.
 *
 * ONE GAP DOMINATES THE REST: there is no fee work-in-progress store. A fee is a flat charge for
 * professional services, recorded by hand as its own dated draft — date, timekeeper, description,
 * amount, billing disposition — riding the same chain as time and costs and claimed onto a draft
 * invoice like any work in progress. It is never computed from time entries, never derived from
 * them, and never drawn out of them. Nothing on the wire carries such a record today: the billing
 * routes serve invoices and their lines, which is the OUTPUT of billing a fee rather than the fee
 * itself.
 *
 * So this surface is built whole against the record a fee IS, and every write on it renders where
 * the design puts it, refused, naming this dependency. The alternative — showing invoice lines and
 * calling them fees — is the shape this ledger used to have, and it stated a model the product does
 * not hold.
 *
 * Each gap is named once, as the noun phrase the Soon composition completes into a sentence and a
 * cell hover states on its own. When one starts being served, its entry comes out of this file and
 * nothing else changes.
 */

/** A field or an act the surface shows, and what has to arrive before it works. */
export interface FeeLedgerGap {
  /** The field as the reader sees it named, so the sentence and the column agree. */
  readonly field: string;
  /** What it waits on, as a noun phrase. Completed into a sentence by the Soon composition. */
  readonly waitsOn: string;
}

export const FEE_LEDGER_GAPS = {
  store: {
    field: "Fees",
    waitsOn:
      "the fee work-in-progress store — capture, update, void and delete routes over a fee " +
      "record carrying its date, timekeeper, description, amount, status and billing " +
      "disposition, plus the claim path that lets a draft invoice take one up",
  },
  entryNumber: {
    field: "Entry Number",
    waitsOn: "a matter-scoped entry number on the fee record",
  },
  dateEntered: {
    field: "Date Entered",
    waitsOn: "the entered date being served on the fee listing",
  },
  attachments: {
    field: "Attachments",
    waitsOn: "a fee's attached files being served, with an attach and a detach route",
  },
  attachmentPicker: {
    field: "Attach File",
    waitsOn: "a picker that reaches the matter's own documents and points a record at one",
  },
  history: {
    field: "History",
    waitsOn: "an endpoint that serves a fee's recorded events",
  },
  memo: {
    field: "Internal Memo",
    waitsOn: "an internal memo column on the fee record, kept out of every client-facing read",
  },
  invoice: {
    field: "Invoice",
    waitsOn: "the invoice a billed fee rides being served on the fee listing",
  },
  reclassify: {
    field: "Move to Another Ledger",
    waitsOn:
      "a cross-ledger move route that writes both tables in one transaction, keeps the entry " +
      "number, records the move, and refuses anything claimed, billed or past draft",
  },
  matterMove: {
    field: "Matter",
    waitsOn: "a route that refiles a draft onto another matter, which is a write to both ledgers",
  },
  deleteDraft: {
    field: "Delete Draft",
    waitsOn: "a route that removes a draft that never entered review",
  },
  reviewGate: {
    field: "Review",
    waitsOn: "the firm's review setting being served",
  },
} as const satisfies Readonly<Record<string, FeeLedgerGap>>;

export type FeeLedgerGapName = keyof typeof FEE_LEDGER_GAPS;

/**
 * What a cell says where its value cannot be read.
 *
 * The same sentence the Soon composition says about a control, because it is the same fact: the
 * column is real, the value is not there yet, and here is what it waits on. A bare blank would read
 * as a fee that has no files rather than as a product that cannot yet say.
 */
export function gapCellTitle(name: FeeLedgerGapName): string {
  const gap = FEE_LEDGER_GAPS[name];
  return `${gap.field} is not served yet. Waiting on ${gap.waitsOn}.`;
}

/** What a control waits on, as the noun phrase the Soon composition takes. */
export function gapReason(name: FeeLedgerGapName): string {
  return FEE_LEDGER_GAPS[name].waitsOn;
}

/**
 * Whether this firm runs the review flow.
 *
 * A firm setting, and nothing serves it to this app, so the surface takes the settled default: off.
 * Off means the review vocabulary is ABSENT rather than disabled — nothing solicits a submission and
 * no chain is drawn — because a disabled "Submit" solicits a workflow the firm has never been asked
 * about. The Time tab reads the same setting the same way, so one matter cannot show two firms.
 */
export const REVIEW_GATE_ENABLED: boolean = false;
