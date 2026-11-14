/*
 * What the Trust ledger is designed to show and the app cannot reach yet.
 *
 * WHAT USED TO DOMINATE THIS FILE IS GONE. The surface could not name a trust account, so the
 * ledger read, the deposit, the payment out and the transfer were all one dependency wearing four
 * names. The account listing is wired now (trust-account-choice.ts chooses one, matter-trust.svelte.ts
 * reads against it), every one of those acts writes, and the members on a movement are resolved to
 * names through the firm's own roster (trust-member-names.ts). Those five entries came out.
 *
 * What is left is two genuine holes, each one a route that does not exist rather than a wire that
 * was not run, and each one RENDERED: a gap nothing on the surface draws is a gap nobody can see,
 * which is the opposite of what this register is for. Each is named once, as the noun phrase the
 * Soon composition completes into a sentence and a cell hover states on its own. When one starts
 * being served, its entry comes out of this file and nothing else changes.
 */

/** A field or an act the surface shows, and what has to arrive before it works. */
export interface TrustLedgerGap {
  /** The field as the reader sees it named, so the sentence and the column agree. */
  readonly field: string;
  /** What it waits on, as a noun phrase. Completed into a sentence by the Soon composition. */
  readonly waitsOn: string;
}

export const TRUST_LEDGER_GAPS = {
  disbursementRequest: {
    field: "Disbursement Request",
    waitsOn: "opening the request a payment was approved from",
  },
  history: {
    field: "History",
    waitsOn: "trust movement history",
  },
} as const satisfies Readonly<Record<string, TrustLedgerGap>>;

export type TrustLedgerGapName = keyof typeof TRUST_LEDGER_GAPS;

/**
 * What a cell says where its value cannot be read.
 *
 * The same sentence the Soon composition says about a control, because it is the same fact: the
 * column is real, the value is not there yet, and here is what it waits on. A bare blank would
 * read as a ledger with nothing on it rather than as a product that cannot yet say.
 */
export function gapCellTitle(name: TrustLedgerGapName): string {
  const gap = TRUST_LEDGER_GAPS[name];
  return `Not built yet: ${gap.waitsOn}.`;
}

/** What a control waits on, as the noun phrase the Soon composition takes. */
export function gapReason(name: TrustLedgerGapName): string {
  return TRUST_LEDGER_GAPS[name].waitsOn;
}
