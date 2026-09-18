/*
 * The judgments the firm's Trust screen makes, worked out away from the screen.
 *
 * WHAT A POSTURE SAYS IS A SENTENCE, NOT THREE FIELDS. The authorization policy arrives as a kind,
 * an amount and a flag, and a reader who has to assemble those three into "does this firm need a
 * second person on this payment" has been handed the firm's own rule as a puzzle. So the sentence
 * is built here, once, and the panel prints it. It is also the thing a change to the posture is
 * checked against, which only works while it is one function.
 *
 * WHO MAY ACT ON A REQUEST IS NOT THE BUTTON'S BUSINESS. A member may never settle their own
 * proposal — that is the whole point of a second person — so the queue offers Withdraw on a request
 * the reader raised and Approve and Reject on everybody else's. A member without the capability
 * sees the same verbs, disabled, carrying the reason: a control that vanishes teaches nobody that
 * the capability exists.
 *
 * A RECONCILIATION KNOWS ITS STATEMENT BY IDENTIFIER, AND A READER KNOWS IT BY ITS PERIOD. The two
 * reads are separate on the contract, so the join happens here; a reconciliation whose statement is
 * not among the ones read says so rather than printing a handle at somebody.
 *
 * IT IS PURE, so every one of these is asserted without a browser. A judgment that only exists
 * inside a component is a judgment nothing can check.
 */
import { permissionRefusal } from "$lib/access/refusal.ts";
import {
  TRUST_PERMISSIONS,
  type TrustAccountListing,
  type TrustAuthorizationPolicyVersion,
  type TrustBankStatement,
  type TrustPendingRequest,
  type TrustReconciliation,
} from "./trust-api.ts";
import { trustMoneyText } from "./firm-trust-vocabulary.ts";

// ---- the firm's authorization posture ------------------------------------------------------------

/**
 * The firm's posture as one sentence.
 *
 * Two clauses, because the contract carries two independent facts: WHETHER a second person is
 * needed (never, above an amount, always) and WHETHER whoever releases the money must hold the
 * authority capability. A firm can require a second person who is merely another member, and a firm
 * can require the capability with no second person at all, so collapsing the pair into one clause
 * would state a rule the firm did not set.
 */
export function postureSentence(
  version: TrustAuthorizationPolicyVersion,
  currency: string,
): string {
  const clause = version.requireAuthorizedApprover
    ? "whoever releases it must hold the authority"
    : "whoever releases it need not hold the authority";
  return `${postureRuleClause(version, currency)}; ${clause}.`;
}

/** The first clause on its own: what the posture asks for, with no word about who may release. */
function postureRuleClause(version: TrustAuthorizationPolicyVersion, currency: string): string {
  switch (version.policy) {
    case "off":
      return "Money leaving a client ledger never takes a second person";
    case "always":
      return "Money leaving a client ledger always takes a second person";
    default:
      return version.thresholdAmountMinor === null
        ? "Money leaving a client ledger takes a second person above an amount this version does not state"
        : `Money leaving a client ledger takes a second person above ${trustMoneyText(version.thresholdAmountMinor, currency)}`;
  }
}

/** How a version of the posture is cited: its number, and the shipped default's honest absence. */
export function postureVersionText(version: TrustAuthorizationPolicyVersion): string {
  return version.id === null
    ? `Version ${String(version.version)}, the shipped default`
    : `Version ${String(version.version)}`;
}

// ---- the approval queue ---------------------------------------------------------------------------

/** The three things a reader can do to a request that nobody has decided yet. */
export type TrustRequestVerb = "approve" | "reject" | "withdraw";

/** Who is looking at the queue, which is all it takes to decide what they may do. */
export interface TrustQueueViewer {
  /** The signed-in member's user identifier, or null while the session is still being read. */
  readonly sessionUserId: string | null;
  /** The capabilities the session holds, or null while it is still being read. */
  readonly permissions: readonly string[] | null;
}

/** One verb the queue offers, and why it cannot be pressed where it cannot. */
export interface TrustRequestAction {
  readonly verb: TrustRequestVerb;
  readonly label: string;
  /** Why the verb is refused, or undefined while it is available. */
  readonly refusal?: string;
}

const VERB_LABELS: Readonly<Record<TrustRequestVerb, string>> = {
  approve: "Approve",
  reject: "Reject",
  withdraw: "Withdraw",
};

/** What each verb is called when a refusal has to name the act it would have performed. */
const VERB_ACTS: Readonly<Record<TrustRequestVerb, string>> = {
  approve: "Approving a trust request",
  reject: "Rejecting a trust request",
  withdraw: "Withdrawing a trust request",
};

/**
 * The verbs this reader is offered on this request.
 *
 * The proposer gets Withdraw and nothing else: a member who could approve their own proposal is a
 * firm with no second person on any payment, however its posture reads. Everybody else gets Approve
 * and Reject. The set never changes with the capability — only the refusal does — because a reader
 * refused server-side should learn that here rather than at the commit.
 */
export function requestActions(
  request: TrustPendingRequest,
  viewer: TrustQueueViewer,
): readonly TrustRequestAction[] {
  const verbs: readonly TrustRequestVerb[] =
    viewer.sessionUserId !== null && request.requestedBy === viewer.sessionUserId
      ? ["withdraw"]
      : ["approve", "reject"];
  return verbs.map((verb) => {
    const refusal = verbRefusal(verb, viewer);
    return refusal === undefined
      ? { verb, label: VERB_LABELS[verb] }
      : { verb, label: VERB_LABELS[verb], refusal };
  });
}

function verbRefusal(verb: TrustRequestVerb, viewer: TrustQueueViewer): string | undefined {
  if (viewer.permissions === null) return "Reading your session.";
  if (!viewer.permissions.includes(TRUST_PERMISSIONS.manage)) {
    return permissionRefusal(VERB_ACTS[verb], TRUST_PERMISSIONS.manage);
  }
  return undefined;
}

/** The queue, oldest first: the request that has waited longest is the one somebody owes an answer. */
export function queueInOrder(
  requests: readonly TrustPendingRequest[],
): readonly TrustPendingRequest[] {
  return requests.toSorted((left, right) => left.requestedAt.localeCompare(right.requestedAt));
}

// ---- statements and reconciliations ---------------------------------------------------------------

/** The statements a reader reads, most recent period first. */
export function statementsInOrder(
  statements: readonly TrustBankStatement[],
): readonly TrustBankStatement[] {
  return statements.toSorted((left, right) => right.periodEnd.localeCompare(left.periodEnd));
}

/** One reconciliation with the statement it was run against, where that statement was read. */
export interface TrustReconciliationRow {
  readonly reconciliation: TrustReconciliation;
  /** The statement the period belongs to, or null where it is not among the ones read. */
  readonly statement: TrustBankStatement | null;
}

/**
 * The reconciliations, most recently opened first, each carrying its statement.
 *
 * A reconciliation whose statement is absent is not an error: the two reads are independent, and a
 * statement superseded by a later one can leave a closed reconciliation pointing at a period the
 * current listing no longer carries. The row says so rather than printing the identifier as though
 * it were a period.
 */
export function reconciliationRows(
  reconciliations: readonly TrustReconciliation[],
  statements: readonly TrustBankStatement[],
): readonly TrustReconciliationRow[] {
  const byIdentifier = new Map(statements.map((statement) => [statement.id, statement]));
  return reconciliations
    .toSorted((left, right) => right.openedAt.localeCompare(left.openedAt))
    .map((reconciliation) => ({
      reconciliation,
      statement: byIdentifier.get(reconciliation.statementId) ?? null,
    }));
}

// ---- narrowing the roster ---------------------------------------------------------------------

/**
 * The accounts a typed query reaches.
 *
 * The browser resolves this one, and honestly: the roster read walks the listing to its end, so
 * what is in hand IS the whole record and narrowing it answers the question a reader actually
 * asked. Where the walk stopped short the roster says `capped`, and the screen says so beside the
 * table rather than letting a search quietly speak for a fraction of the firm's accounts.
 */
export function accountsMatching(
  accounts: readonly TrustAccountListing[],
  query: string,
): readonly TrustAccountListing[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return accounts;
  return accounts.filter((account) =>
    [
      account.name,
      account.bankName ?? "",
      account.accountNumberLastFour ?? "",
      account.jurisdiction ?? "",
    ].some((field) => field.toLowerCase().includes(needle)),
  );
}
