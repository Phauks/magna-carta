/*
 * What the unclaimed-funds panels put on the wire, worked out away from the panels.
 *
 * EVERY REFUSAL IS THE CLIENT'S OWN, AND IT SAYS WHICH FACT IS MISSING. The same discipline
 * trust-write-requests.ts holds to, for the same reason: on this surface a reader must never press
 * a commit and then find out. So each reading answers either the request to send or the one
 * sentence to show, and the panels hold no validation of their own.
 *
 * NOTHING ON THIS PATH MOVES MONEY, and the refusals are written so that nobody could think it
 * does. Opening a file records an observation; recording an attempt records something that already
 * happened; closing a round ATTACHES a payment that already posted through the ordinary authorized
 * path. That is why a closure takes no amount, no payee, no day and no method: there is no movement
 * here to compose, only one to name.
 *
 * TWO FIELDS ARE CONDITIONALLY REQUIRED, and the condition is a function rather than a branch
 * inside a panel. A review of the firm's own records reaches nobody, so it is the one channel that
 * needs no address; a distribution to the owner is the one outcome that names a movement. A panel
 * asks these functions what to refuse and what to disable, so the rule and the sentence cannot
 * drift apart.
 *
 * IT IS PURE, so the bodies these panels compose can be asserted without a browser.
 */
import type { TrustRequestReading } from "./trust-write-requests.ts";
import type {
  TrustContactAttemptEntry,
  TrustContactChannel,
  TrustContactOutcome,
  TrustDormantBalance,
  TrustReviewOutcome,
  TrustUnclaimedFundsReviewOpening,
} from "./trust-api.ts";

/**
 * The empty string an optional box is left holding means the field was not answered.
 *
 * Spelled here rather than shared with trust-write-requests.ts, whose own copy is private to it:
 * exporting one file's helper to reach it from another is a wider seam than the three lines are
 * worth, and both say the same thing about the same kind of box.
 */
function orNull(text: string): string | null {
  const trimmed = text.trim();
  return trimmed === "" ? null : trimmed;
}

// ---- what the reader is looking at ----------------------------------------------------------------

/**
 * The quiet ledgers, in the order a reviewer works them.
 *
 * OLDEST RECEIPT FIRST, because the rules' clocks run from receipt rather than from the last time
 * anything happened: the ledger whose money has been with the firm longest is the one closest to
 * being reportable, whatever has moved on it since. A ledger whose earliest receipt is not known
 * cannot be placed on that clock, so it goes last rather than first, where it would read as the
 * most urgent thing on the list. Ties fall to the larger balance, and then to the node's own
 * identifier so the order is stable across reads.
 */
export function dormantBalancesInOrder(
  balances: readonly TrustDormantBalance[],
): readonly TrustDormantBalance[] {
  return [...balances].sort((left, right) => {
    if (left.earliestReceiptDate !== right.earliestReceiptDate) {
      if (left.earliestReceiptDate === null) return 1;
      if (right.earliestReceiptDate === null) return -1;
      return left.earliestReceiptDate < right.earliestReceiptDate ? -1 : 1;
    }
    // Compared rather than subtracted: a comparator only needs the ORDER, and subtracting two
    // minor-unit figures is arithmetic on money, which belongs in @magna-carta/money.
    if (left.balanceMinor !== right.balanceMinor) {
      return left.balanceMinor < right.balanceMinor ? 1 : -1;
    }
    return left.trustLedgerNodeId < right.trustLedgerNodeId ? -1 : 1;
  });
}

// ---- opening a file --------------------------------------------------------------------------------

/** What the opening panel holds while it is being filled in. */
export interface TrustUnclaimedFundsReviewOpeningEntry {
  readonly trustAccountId: string;
  readonly matterId: string;
  /** The observation, exactly as the dormant-balances read served it. */
  readonly observedBalanceMinor: number;
  readonly observedEarliestReceiptDate: string | null;
  readonly observedLastActivityDate: string | null;
  readonly note: string;
}

export function readTrustUnclaimedFundsReviewOpening(
  entry: TrustUnclaimedFundsReviewOpeningEntry,
): TrustRequestReading<TrustUnclaimedFundsReviewOpening> {
  if (entry.trustAccountId === "" || entry.matterId === "") {
    return { kind: "refused", reason: "Choose the ledger this file is opened over." };
  }
  if (entry.observedBalanceMinor <= 0) {
    return {
      kind: "refused",
      reason: "This ledger holds nothing, so there is nothing to look for an owner for.",
    };
  }
  return {
    kind: "request",
    request: {
      trustAccountId: entry.trustAccountId,
      matterId: entry.matterId,
      observedBalanceMinor: entry.observedBalanceMinor,
      observedEarliestReceiptDate: entry.observedEarliestReceiptDate,
      observedLastActivityDate: entry.observedLastActivityDate,
      note: orNull(entry.note),
    },
  };
}

// ---- one attempt to reach the owner -----------------------------------------------------------------

/**
 * Whether this channel needs the address or the number it used.
 *
 * Every channel does but one: a review of the firm's own records reaches nobody, so there is
 * nothing it could name. The contract says the same thing about the field, and this is where a
 * panel reads it from rather than writing the exception out again beside a control.
 */
export function contactUsedIsRequired(channel: TrustContactChannel): boolean {
  return channel !== "record_review";
}

/** What the attempt panel holds while it is being filled in. */
export interface TrustContactAttemptDraft {
  readonly channel: TrustContactChannel;
  readonly attemptedOn: string;
  readonly contactUsed: string;
  readonly outcome: TrustContactOutcome;
  readonly note: string;
}

export function readTrustContactAttemptEntry(
  draft: TrustContactAttemptDraft,
): TrustRequestReading<TrustContactAttemptEntry> {
  if (draft.attemptedOn === "") {
    return { kind: "refused", reason: "Say which day the attempt was made." };
  }
  if (contactUsedIsRequired(draft.channel) && draft.contactUsed.trim() === "") {
    return {
      kind: "refused",
      reason: "Say the address or the number the attempt used.",
    };
  }
  return {
    kind: "request",
    request: {
      channel: draft.channel,
      attemptedOn: draft.attemptedOn,
      // An address typed under a channel that reaches nobody is dropped rather than sent: the
      // reader answered the field and then changed the channel, and the file has to record the
      // attempt they ended on rather than the one they started composing.
      contactUsed: contactUsedIsRequired(draft.channel) ? orNull(draft.contactUsed) : null,
      outcome: draft.outcome,
      note: orNull(draft.note),
    },
  };
}

// ---- ending a round ----------------------------------------------------------------------------------

/** What closing a round states. No amount, no payee, no day: nothing here moves money. */
export interface TrustUnclaimedFundsClosureRequest {
  readonly outcome: TrustReviewOutcome;
  readonly trustMovementId: string | null;
  readonly note: string | null;
}

/**
 * Whether this outcome names a payment.
 *
 * Only a distribution does, and the movement it names is one that already posted through the
 * ordinary authorized path. The other three close the file without one, which is why the field
 * stands refused on them rather than disappearing and reflowing the panel.
 */
export function trustMovementIsRequired(outcome: TrustReviewOutcome): boolean {
  return outcome === "distributed_to_owner";
}

/** What the closing panel holds while it is being filled in. */
export interface TrustUnclaimedFundsClosureDraft {
  readonly outcome: TrustReviewOutcome;
  readonly trustMovementId: string;
  readonly note: string;
}

export function readTrustUnclaimedFundsClosure(
  draft: TrustUnclaimedFundsClosureDraft,
): TrustRequestReading<TrustUnclaimedFundsClosureRequest> {
  const movement = orNull(draft.trustMovementId);
  if (trustMovementIsRequired(draft.outcome) && movement === null) {
    return {
      kind: "refused",
      reason:
        "Name the trust movement that paid the owner. Closing attaches a payment that already posted; it moves nothing.",
    };
  }
  return {
    kind: "request",
    request: {
      outcome: draft.outcome,
      // A movement named under an outcome that does not take one is dropped rather than sent: the
      // reader answered the field and then changed the outcome, and the file must record what they
      // ended on.
      trustMovementId: trustMovementIsRequired(draft.outcome) ? movement : null,
      note: orNull(draft.note),
    },
  };
}
