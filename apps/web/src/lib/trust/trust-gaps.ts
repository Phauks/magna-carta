/*
 * What the Trust ledger is designed to show and the app cannot reach yet.
 *
 * ONE GAP DOMINATES THE REST: this surface cannot name a trust account. The matter's ledger read
 * names one, a deposit is posted into one, a payment out is proposed against one and a transfer
 * moves money inside one. The listing exists now (GET /api/v1/trust/accounts, read by the report
 * screen through $lib/reports/reports-api.ts) and this ledger is not yet wired to it; the routes
 * behind every one of those acts exist and are served, and what the screen still lacks is the one
 * identifier each of them takes.
 *
 * So this surface is built whole against the record a trust movement IS, the list stands empty
 * and says why, and every write renders where the design puts it, refused, naming this dependency
 * in its own words. The alternative, guessing an account or hiding the section, would state a
 * model the product does not hold or hide a surface the firm will use every week.
 *
 * Each gap is named once, as the noun phrase the Soon composition completes into a sentence and a
 * cell hover states on its own. When one starts being served, its entry comes out of this file and
 * nothing else changes.
 */

/** A field or an act the surface shows, and what has to arrive before it works. */
export interface TrustLedgerGap {
  /** The field as the reader sees it named, so the sentence and the column agree. */
  readonly field: string;
  /** What it waits on, as a noun phrase. Completed into a sentence by the Soon composition. */
  readonly waitsOn: string;
}

export const TRUST_LEDGER_GAPS = {
  account: {
    field: "Trust Account",
    waitsOn:
      "this ledger being wired to the firm's trust-account listing: the matter's ledger is read " +
      "against one account, and the listing the report screen picks from is not yet wired here",
  },
  deposit: {
    field: "Deposit",
    waitsOn:
      "the same read of the firm's trust accounts: a deposit is posted into one, and nothing on " +
      "this screen can name it yet",
  },
  disbursement: {
    field: "Disbursement",
    waitsOn:
      "the same read of the firm's trust accounts: a payment out is proposed against one, and " +
      "nothing on this screen can name it yet",
  },
  transfer: {
    field: "Transfer",
    waitsOn:
      "the same read of the firm's trust accounts: a transfer between two of this client's " +
      "matters moves money inside one, and nothing on this screen can name it yet",
  },
  memberNames: {
    field: "Recorded By",
    waitsOn:
      "the recorder and the authorizer being served as names: the ledger carries their user " +
      "identifiers",
  },
  disbursementRequest: {
    field: "Disbursement Request",
    waitsOn:
      "a route that reads one disbursement request by its identifier, so the request a payment " +
      "was approved from can open",
  },
  history: {
    field: "History",
    waitsOn: "an endpoint that serves a trust movement's recorded events",
  },
  screenshot: {
    field: "Screenshot",
    waitsOn: "screenshot capture in the problem report",
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
  return `${gap.field} is not served yet. Waiting on ${gap.waitsOn}.`;
}

/** What a control waits on, as the noun phrase the Soon composition takes. */
export function gapReason(name: TrustLedgerGapName): string {
  return TRUST_LEDGER_GAPS[name].waitsOn;
}
