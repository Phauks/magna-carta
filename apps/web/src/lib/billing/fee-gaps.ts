/*
 * What the Fees ledger is designed to show and the server does not answer yet.
 *
 * THE STORE ITSELF IS NO LONGER ONE OF THEM. `fee_entry` exists, the fee routes serve both listing
 * shapes and the whole chain, and a draft invoice claims a fee exactly as it claims a cost. Every
 * write on this surface writes. What is left below is the smaller set: facts the record does not
 * carry yet, and acts no route serves.
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
  entryNumber: {
    field: "Entry Number",
    waitsOn: "entry numbers on fees",
  },
  attachments: {
    field: "Attachments",
    waitsOn: "attached files on fees",
  },
  attachmentPicker: {
    field: "Attach File",
    waitsOn: "picking a matter's documents",
  },
  history: {
    field: "History",
    waitsOn: "fee history",
  },
  memo: {
    field: "Internal Memo",
    waitsOn: "editing memos safely",
  },
  reclassify: {
    field: "Move to Another Ledger",
    waitsOn: "moving entries between ledgers",
  },
  matterMove: {
    field: "Matter",
    waitsOn: "moving a draft to another matter",
  },
  reviewGate: {
    field: "Review",
    waitsOn: "the firm's review setting",
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
  return `Not built yet: ${gap.waitsOn}.`;
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
