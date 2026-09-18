/*
 * What the firm's Trust screen is designed to show and the platform cannot reach yet.
 *
 * THE SCREEN IS BUILT WHOLE AND SAYS WHERE IT IS THIN. The accounts register, the approval queue,
 * the statements, the reconciliations, the bank-charge cushion and the firm's authorization posture
 * are all served and all read. What is not served is named here, once, so a field that cannot be
 * filled says the same thing wherever it appears and a control that cannot be pressed completes the
 * same sentence as every other not-yet-served control in the product.
 *
 * TWO KINDS OF ENTRY, ONE SHAPE. Some of these are FIELDS the reader can see a place for and no
 * value in — an account's current balance, the matter behind a queued request. The rest are ACTS
 * whose anatomy renders disabled: reconciling a period, recording or importing a statement, and the
 * three cushion forms. Both answer the same question — what has to arrive before this works — so
 * both are written the same way and read through the same two functions.
 *
 * Each gap is named once, as the noun phrase the Soon composition completes into a sentence and a
 * cell hover states on its own. When one starts being served, its entry comes out of this file and
 * nothing else changes.
 *
 * Its sibling, trust-gaps.ts, holds the same register for a matter's own Trust section. The two are
 * separate because the surfaces are: a matter's ledger and the firm's roster of accounts wait on
 * different things, and one file naming both would make every reader check which half applied.
 */

/** A field or an act the surface shows, and what has to arrive before it works. */
export interface FirmTrustGap {
  /** The field or the act as the reader sees it named, so the sentence and the control agree. */
  readonly field: string;
  /** What it waits on, as a noun phrase. Completed into a sentence by the Soon composition. */
  readonly waitsOn: string;
}

export const FIRM_TRUST_GAPS = {
  accountBalance: {
    field: "Balance",
    waitsOn:
      "a read that states a trust account's balance as it stands today: the trust-compliance " +
      "pack states one for a period, and nothing states the figure at the moment of asking",
  },
  requestMatter: {
    field: "Matter",
    waitsOn:
      "the approval queue serving the matter behind a ledger node: a queued request carries the " +
      "node identifier alone, and nothing on this screen can resolve it to a matter",
  },
  reconcile: {
    field: "Reconcile",
    waitsOn:
      "the reconciliation workbench: opening a period, matching lines by hand, and closing the " +
      "proof",
  },
  recordStatement: {
    field: "Record Statement",
    waitsOn:
      "the statement forms: entering a period's opening and closing balances, its reference and " +
      "its dates by hand",
  },
  importStatement: {
    field: "Import Statement",
    waitsOn:
      "the statement import: reading a period out of the file the institution publishes, rather " +
      "than retyping it",
  },
  openCushion: {
    field: "Open Cushion",
    waitsOn: "the cushion forms, which are what these three acts are still missing",
  },
  fundCushion: {
    field: "Fund Cushion",
    waitsOn: "the cushion forms, which are what these three acts are still missing",
  },
  recordBankCharge: {
    field: "Record Bank Charge",
    waitsOn: "the cushion forms, which are what these three acts are still missing",
  },
} as const satisfies Readonly<Record<string, FirmTrustGap>>;

export type FirmTrustGapName = keyof typeof FIRM_TRUST_GAPS;

/**
 * What a field says where its value cannot be read.
 *
 * The same sentence the Soon composition says about a control, because it is the same fact: the
 * row is real, the value is not there yet, and here is what it waits on. A bare blank would read as
 * an account holding nothing rather than as a product that cannot yet say.
 */
export function firmTrustGapTitle(name: FirmTrustGapName): string {
  const gap = FIRM_TRUST_GAPS[name];
  return `${gap.field} is not served yet. Waiting on ${gap.waitsOn}.`;
}

/** What a control waits on, as the noun phrase the Soon composition takes. */
export function firmTrustGapReason(name: FirmTrustGapName): string {
  return FIRM_TRUST_GAPS[name].waitsOn;
}

/** What a field reads in place of a figure nothing serves. */
export const NOT_SERVED_YET = "Not served yet";
