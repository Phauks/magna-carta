/*
 * What the reconciliation screen says, worked out away from the screen.
 *
 * THE PROOF IS READ, NEVER COMPUTED HERE. Every figure in the three-way proof arrives from the
 * server, which derives it from dated rows at the moment of asking; this module arranges those
 * figures into rows and gives each one its words. A screen that added two of them together would
 * be a second answer to what a trust account holds, and the one place two answers about client
 * money must never exist is the proof a firm attests to.
 *
 * A CLOSED RECONCILIATION HAS TWO PROOFS AND THEY ARE NOT THE SAME FACT. What the firm attested to
 * is frozen at the moment of closing; what the same period comes to today may differ, because an
 * entry can be recorded against a past day afterwards. Both are rendered, each under its own name,
 * and the recomputed one is never presented as the attestation. That is why the two shapes are
 * arranged by the same function from different sources rather than by two functions that could
 * drift into labelling them alike.
 *
 * NOTHING IS MATCHED AUTOMATICALLY. A suggestion says why a line and a recorded item could be the
 * same event; it never asserts that they are, because a wrong automatic match is a wrong assertion
 * about a client's money that nobody would have read. So the signals are spelled out in words on
 * the candidate row and a person records every match.
 *
 * IT IS PURE, so the words a firm's books are read through can be asserted without a browser.
 */
import type {
  TrustBankItem,
  TrustFrozenProof,
  TrustMatchSignal,
  TrustMatchSuggestion,
  TrustProofDisagreement,
  TrustReconciliation,
  TrustReconciliationMatch,
  TrustThreeWayProof,
} from "./trust-api.ts";

/** How an amount is written where this module composes a sentence around one. */
export type MoneyText = (amountMinor: number) => string;

// ---- the proof, as rows ------------------------------------------------------------------------

/** One figure of the three-way proof, named and explained. */
export interface ProofFigure {
  /** Stable across re-renders, so a list of figures is keyed by identity rather than position. */
  readonly identifier: string;
  readonly label: string;
  /** The figure as a reader reads it, or null where this proof does not carry one yet. */
  readonly value: string | null;
  /** What the figure IS, on the hover. */
  readonly meaning: string;
}

/** The six figures, in the order the proof is read: down the bank side, then the book side. */
const PROOF_FIGURE_MEANINGS = [
  {
    identifier: "statementClosing",
    label: "Statement Closing",
    meaning: "What the bank said the account held at the end of the period.",
  },
  {
    identifier: "outstandingDeposits",
    label: "Outstanding Deposits",
    meaning: "Money the firm recorded as paid in that the bank had not posted by the period's end.",
  },
  {
    identifier: "outstandingDisbursements",
    label: "Outstanding Disbursements",
    meaning:
      "Money the firm recorded as paid out that the bank had not posted by the period's end.",
  },
  {
    identifier: "adjustedBank",
    label: "Adjusted Bank",
    meaning:
      "The statement's closing balance adjusted for what the firm recorded and the bank had not posted.",
  },
  {
    identifier: "bookBalance",
    label: "Book Balance",
    meaning: "What the firm's own record of the bank account comes to at the period's end.",
  },
  {
    identifier: "clientLedgers",
    label: "Client Ledgers",
    meaning: "What every client ledger on this account adds up to at the period's end.",
  },
] as const;

/** The six amounts a proof carries, in the order above, from whichever proof is being shown. */
function proofAmounts(
  proof: TrustThreeWayProof | TrustFrozenProof,
): readonly [number, number, number, number, number, number] {
  return [
    proof.statementClosingMinor,
    proof.outstandingDepositsMinor,
    proof.outstandingDisbursementsMinor,
    proof.adjustedBankMinor,
    proof.bookBalanceMinor,
    proof.clientLedgerTotalMinor,
  ];
}

/**
 * The proof as figures, or the same six terms standing empty before a proof has arrived.
 *
 * The empty shape is the point: the structure a reader will read the answer in renders first, so
 * the figures land in a frame they already have rather than arriving as a block of new furniture.
 */
export function proofFigures(
  proof: TrustThreeWayProof | TrustFrozenProof | null,
  money: MoneyText,
): readonly ProofFigure[] {
  const amounts = proof === null ? null : proofAmounts(proof);
  return PROOF_FIGURE_MEANINGS.map((figure, index) => ({
    identifier: figure.identifier,
    label: figure.label,
    value: amounts === null ? null : money(amounts[index] ?? 0),
    meaning: figure.meaning,
  }));
}

/** Which side of the three-way proof a disagreement is on, in the reader's words. */
export function disagreementLegLabel(leg: TrustProofDisagreement["leg"]): string {
  return leg === "bank-to-book" ? "Bank to Book" : "Book to Client Ledgers";
}

/** What that leg compares, on the hover. */
export function disagreementLegMeaning(leg: TrustProofDisagreement["leg"]): string {
  return leg === "bank-to-book"
    ? "The adjusted bank balance set against the firm's own record of the account."
    : "The firm's record of the account set against what the client ledgers add up to.";
}

/** One disagreement as a row: which legs disagree, and by how much. */
export interface DisagreementRow {
  readonly identifier: string;
  readonly label: string;
  readonly meaning: string;
  readonly difference: string;
}

export function disagreementRows(
  proof: TrustThreeWayProof | null,
  money: MoneyText,
): readonly DisagreementRow[] {
  if (proof === null) return [];
  return proof.disagreements.map((disagreement) => ({
    identifier: disagreement.leg,
    label: disagreementLegLabel(disagreement.leg),
    meaning: disagreementLegMeaning(disagreement.leg),
    difference: money(disagreement.differenceMinor),
  }));
}

/** What a proof's verdict is called: two words, the same two for either proof. */
export function verdictLabel(balanced: boolean): string {
  return balanced ? "Balanced" : "Did Not Balance";
}

/** What the verdict means, on the hover. */
export function verdictMeaning(balanced: boolean): string {
  return balanced
    ? "The bank, the firm's record of the account and the client ledgers all agree for this period."
    : "At least one of the three legs disagrees. The legs and their differences are stated beside this.";
}

// ---- the two sides -----------------------------------------------------------------------------

/** Which way a recorded entry moved the bank balance. The sign is the record's, never inferred. */
export function bankItemDirectionLabel(item: TrustBankItem): string {
  return item.bankDeltaMinor < 0 ? "Out" : "In";
}

/** What a recorded entry IS, from what the record carries about it. */
export function bankItemKindLabel(item: TrustBankItem): string {
  if (item.trustTransferId !== null) return "Earned Fees";
  switch (item.movementKind) {
    case "deposit":
      return "Deposit";
    case "disbursement":
      return "Disbursement";
    case "matter_transfer":
      return "Matter Transfer";
    default:
      return "Recorded Entry";
  }
}

/** What each signal says about why a line and an item could be the same event. */
export function matchSignalLabel(signal: TrustMatchSignal): string {
  switch (signal) {
    case "amount-equal":
      return "amount equal";
    case "same-day":
      return "same day";
    case "within-window":
      return "within a few days";
    case "reference-equal":
      return "reference equal";
    default:
      return "counterparty similar";
  }
}

/** The signals as one reading, in the order the server gave them. */
export function matchSignalsText(signals: readonly TrustMatchSignal[]): string {
  return signals.map(matchSignalLabel).join(" · ");
}

/** What a candidate row says about itself, beside the item it marks. */
export interface CandidateMark {
  readonly signals: readonly TrustMatchSignal[];
  readonly text: string;
  /** Days between the bank's posting and the recorded effective date. */
  readonly dayGap: number;
}

/**
 * The candidates for ONE selected line, by the recorded entry each points at.
 *
 * Keyed by the item rather than returned as a list, because the right-hand table asks the question
 * per row: "is this one a candidate for the line I have chosen, and why". With no line chosen the
 * map is empty and the table marks nothing, which is the honest answer to a question nobody asked.
 */
export function candidatesForLine(
  suggestions: readonly TrustMatchSuggestion[],
  selectedStatementLineId: string | null,
): ReadonlyMap<string, CandidateMark> {
  const marks = new Map<string, CandidateMark>();
  if (selectedStatementLineId === null) return marks;
  for (const suggestion of suggestions) {
    if (suggestion.statementLineId !== selectedStatementLineId) continue;
    marks.set(suggestion.ledgerEntryId, {
      signals: suggestion.signals,
      text: matchSignalsText(suggestion.signals),
      dayGap: suggestion.dayGap,
    });
  }
  return marks;
}

// ---- the matches -------------------------------------------------------------------------------

/** Whether a recorded match still stands, or was taken back. */
export function matchStandingLabel(match: TrustReconciliationMatch): string {
  return match.withdrawnAt === null ? "Standing" : "Withdrawn";
}

/** What that standing means, on the hover. */
export function matchStandingMeaning(match: TrustReconciliationMatch): string {
  return match.withdrawnAt === null
    ? "A member asserted that this line and this recorded entry are the same event."
    : "The assertion was taken back. It stays on the record and the item is outstanding again.";
}

// ---- closing -----------------------------------------------------------------------------------

/** What the panel that closes a reconciliation states before it is pressed. */
export interface CloseReading {
  /** Why the act cannot happen, or undefined where it can. */
  readonly refusal: string | undefined;
  /** What closing will record, in the words the confirm panel states. */
  readonly sentence: string;
}

/**
 * What closing this reconciliation would do, said before it is done.
 *
 * A period that did not balance closes exactly as readily as one that did — a firm that cannot
 * record an unreconciled month has to choose between a false attestation and no record at all —
 * so the sentence states the verdict and the counts rather than standing in the way of them.
 */
export function closeReading(
  reconciliation: TrustReconciliation | null,
  proof: TrustThreeWayProof | null,
  unmatchedLineCount: number,
  unmatchedItemCount: number,
): CloseReading {
  const counts =
    `${countedPhrase(unmatchedLineCount, "statement line", "statement lines")} and ` +
    `${countedPhrase(unmatchedItemCount, "recorded item", "recorded items")} are unmatched.`;
  if (reconciliation === null || proof === null) {
    return { refusal: "Reading this reconciliation.", sentence: counts };
  }
  const verdict = proof.balanced
    ? "This period balances."
    : "This period does not balance, and closing records that it did not tie out.";
  const sentence =
    `${verdict} ${counts} Closing freezes the proof as it stands now and writes nothing else: ` +
    "no entry is moved, no match is made, and a correction afterwards is a new reconciliation " +
    "that supersedes this one.";
  if (reconciliation.status === "closed") {
    return { refusal: "This reconciliation is already closed.", sentence };
  }
  return { refusal: undefined, sentence };
}

/** A count in its own grammar, so a sentence never reads "1 statement lines". */
export function countedPhrase(count: number, singular: string, plural: string): string {
  return `${String(count)} ${count === 1 ? singular : plural}`;
}

// ---- recording a match -------------------------------------------------------------------------

/**
 * Why the Match control cannot be pressed yet, or undefined where it can.
 *
 * The sentence carries the fact a reader most needs about this surface: nothing is matched
 * automatically. It is stated on the control that does the matching, where the reader is standing
 * when the question occurs to them, rather than as a line of prose beside the two tables.
 */
export function matchRefusal(options: {
  /** Why this account may not record a match at all, where that is the answer. */
  readonly permissionRefusal: string | undefined;
  readonly selectedStatementLineId: string | null;
  readonly selectedLedgerEntryId: string | null;
}): string | undefined {
  if (options.permissionRefusal !== undefined) return options.permissionRefusal;
  if (options.selectedStatementLineId === null && options.selectedLedgerEntryId === null) {
    return (
      "Choose a statement line on the left and the recorded item it is. Nothing is matched " +
      "automatically: a member records every match."
    );
  }
  if (options.selectedStatementLineId === null) {
    return "Choose the statement line this recorded item is.";
  }
  if (options.selectedLedgerEntryId === null) {
    return "Choose the recorded item this statement line is.";
  }
  return undefined;
}
