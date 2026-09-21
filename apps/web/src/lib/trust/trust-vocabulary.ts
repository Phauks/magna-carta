/*
 * The words the trust ledger uses, and the small judgments behind them.
 *
 * A MOVEMENT IS IMMUTABLE. Client money that moved is a fact on a ledger the firm answers for, so
 * nothing here is a draft, nothing is edited and nothing is voided; a mistake is corrected by a
 * further movement. That is why this file has no chain, no status register key and no "can it be
 * worked" question: every word describes what happened, never what somebody may still do.
 *
 * DIRECTION IS THE KIND'S, NEVER THE SIGN'S. An amount is stored positive and the kind says which
 * way it went, except a transfer, which appears on BOTH matters' ledgers as one record: the node
 * it is stored against is the one the money left. Reading it as In or Out therefore needs to know
 * which node the reader is standing on, and that is the one input this vocabulary takes.
 *
 * WHAT A WORD MEANS RIDES A HOVER, NEVER A PRINTED SENTENCE. The authorization basis in particular
 * is a fact a reader must not have to infer from two user handles matching, so it is spelled out
 * on the hover of the person who released the money.
 */
import { UNRECORDED_PERSON } from "@magna-carta/design-system/formatters";
import type {
  TrustAuthorizationBasis,
  TrustBankMovementMethod,
  TrustMovementKind,
  TrustMovementMethod,
  TrustMovementRecord,
} from "./trust-api.ts";

/** The three kinds, in the order a filter offers them. */
export const TRUST_MOVEMENT_KINDS: readonly TrustMovementKind[] = [
  "deposit",
  "disbursement",
  "matter_transfer",
];

/** The six methods, in the order a filter offers them. */
export const TRUST_MOVEMENT_METHODS: readonly TrustMovementMethod[] = [
  "check",
  "cash",
  "wire",
  "electronic_transfer",
  "card",
  "internal",
];

/**
 * The methods a person may STATE, in the order a form offers them.
 *
 * `internal` is missing on purpose: it is a transfer's own method, set by the server because
 * nothing left the bank, and offering it on a deposit or a payment out would invite somebody to
 * record money as having moved inside an account when it crossed the institution's counter.
 */
export const TRUST_BANK_MOVEMENT_METHODS: readonly TrustBankMovementMethod[] = [
  "check",
  "cash",
  "wire",
  "electronic_transfer",
  "card",
];

/** What a movement is called in a cell, a filter list and the panel: one wording, one home. */
export function kindLabel(kind: TrustMovementKind): string {
  switch (kind) {
    case "deposit":
      return "Deposit";
    case "disbursement":
      return "Disbursement";
    default:
      return "Matter Transfer";
  }
}

/** What a kind MEANS, on the hover. */
export function kindSentence(kind: TrustMovementKind): string {
  switch (kind) {
    case "deposit":
      return "Deposit: client money paid into this matter's trust ledger.";
    case "disbursement":
      return "Disbursement: client money paid out of this matter's trust ledger to a payee.";
    default:
      return (
        "Matter transfer: client money moved between two of this client's matters inside the " +
        "same trust account. It appears on both matters' ledgers."
      );
  }
}

/** How the money moved, in the reader's words. */
export function methodLabel(method: TrustMovementMethod): string {
  switch (method) {
    case "check":
      return "Check";
    case "cash":
      return "Cash";
    case "wire":
      return "Wire";
    case "electronic_transfer":
      return "Electronic Transfer";
    case "card":
      return "Card";
    default:
      return "Internal";
  }
}

/** The footing a release stood on, as the short word a fact row carries. */
export function basisLabel(basis: TrustAuthorizationBasis): string {
  switch (basis) {
    case "second_person":
      return "Second person";
    case "sole_trust_manager":
      return "Sole trust manager";
    default:
      return "Policy did not require a second person";
  }
}

/** What the footing MEANS, on the hover of whoever released the money. */
export function basisSentence(basis: TrustAuthorizationBasis): string {
  switch (basis) {
    case "second_person":
      return "Released by a second person, as the firm's authorization policy requires.";
    case "sole_trust_manager":
      return (
        "The firm had nobody else who could approve, so the person who proposed the payment " +
        "released it themselves."
      );
    default:
      return "The firm's authorization policy did not require a second person for this amount.";
  }
}

/** Which way the money went, from where the reader stands. */
export type TrustMovementDirection = "in" | "out";

/**
 * Which way a movement went on THIS matter's ledger.
 *
 * A deposit is always in and a disbursement always out. A transfer is stored against the node the
 * money left, so it reads Out on that matter and In on the other; a reader whose own node is not
 * known yet is standing on the node the movement is stored against, which is the honest default
 * because the ledger read that would say otherwise is the same read that would have named the node.
 */
export function direction(
  movement: TrustMovementRecord,
  ownTrustLedgerNodeId: string | null,
): TrustMovementDirection {
  switch (movement.kind) {
    case "deposit":
      return "in";
    case "disbursement":
      return "out";
    default:
      return ownTrustLedgerNodeId !== null &&
        movement.counterpartyTrustLedgerNodeId === ownTrustLedgerNodeId
        ? "in"
        : "out";
  }
}

/**
 * Who was on the other side: the payer or payee the movement names, or on a transfer the other
 * matter's node, which is the only handle the record carries for it.
 */
export function counterpartyText(
  movement: TrustMovementRecord,
  ownTrustLedgerNodeId: string | null,
): string {
  if (movement.counterpartyName !== null) return movement.counterpartyName;
  if (movement.kind === "matter_transfer") {
    return direction(movement, ownTrustLedgerNodeId) === "in"
      ? movement.trustLedgerNodeId
      : (movement.counterpartyTrustLedgerNodeId ?? UNRECORDED_PERSON);
  }
  return UNRECORDED_PERSON;
}

/** What the Authorized By cell reads where nobody released the movement: a deposit takes no one. */
export const NO_AUTHORIZER = "Not required";

export function authorizedByText(movement: TrustMovementRecord): string {
  return movement.authorizedBy ?? NO_AUTHORIZER;
}

/** What the hover over the authorizer says: the footing where there is one, the fact where not. */
export function authorizedByTitle(movement: TrustMovementRecord): string {
  if (movement.authorizationBasis !== null) return basisSentence(movement.authorizationBasis);
  if (movement.authorizedBy !== null) return "The person who released this movement.";
  return "A deposit takes no second person: it puts money in and pays nothing out.";
}

/**
 * What the In or Out cell says where the money went the other way.
 *
 * A movement lands on one side of the ledger and the other side is blank; the dash says the cell is
 * deliberately empty, and the hover says why, the way a cost's unserved cell does.
 */
export const NO_AMOUNT_ON_THIS_SIDE =
  "This movement went the other way, so it carries no amount on this side of the ledger.";

/**
 * What both Trust surfaces say where the roster read stopped short of the firm's whole record.
 *
 * One wording, because it is one fact: a matter reading its ledger against an account and the
 * firm's own register of accounts are both looking at a page of the roster rather than all of it,
 * and two sentences for one fact is how a reader learns the two screens are two products.
 */
export const ROSTER_CAPPED_WARNING =
  "The roster stopped short of the end, so these are some of the firm's trust accounts rather than all of them.";

/**
 * What the notices band says about payments nobody has decided yet.
 *
 * The queue itself lives in the details panel, where a request states its whole terms; the band
 * carries the COUNT alone, because a reader passing the ledger needs to know somebody is owed an
 * answer without the ledger giving its room up to a list of requests. One sentence, in the count's
 * own grammar, so the line never reads "1 payments".
 */
export function waitingOnApprovalSentence(count: number): string {
  return count === 1
    ? "1 payment is waiting on approval."
    : `${count} payments are waiting on approval.`;
}

/** The movements a figure is allowed to count. Every movement counts: none is a draft or a void. */
export function sumAmountMinor(movements: readonly TrustMovementRecord[]): number {
  return movements.reduce((total, movement) => total + movement.amountMinor, 0);
}
