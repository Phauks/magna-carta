/*
 * The judgments the firm's Trust screen makes, worked out away from the screen.
 *
 * WHAT A POSTURE SAYS IS A SENTENCE, NOT THREE FIELDS. The authorization policy arrives as a kind,
 * an amount and a flag, and a reader who has to assemble those three into "does this firm need a
 * second person on this payment" has been handed the firm's own rule as a puzzle. So the sentence
 * is built here, once, and the panel prints it. It is also the thing a change to the posture is
 * checked against, which only works while it is one function.
 *
 * WHO MAY ACT ON A REQUEST IS SHARED WITH THE MATTER'S OWN LEDGER, so it lives beside both rather
 * than here: trust-request-verbs.ts holds it, and this file re-exports it so a reader of the firm's
 * screen still finds the verbs where the rest of that screen's judgments are.
 *
 * A POSITION IS SIX FIGURES, AND ONE OF THEM CAN BE ABSENT RATHER THAN NOTHING. Which of them is
 * which is a judgment about client money — a zero and an absence read alike on a screen and mean
 * entirely different things on a trust account — so it is decided here, where it can be asserted,
 * rather than inside the markup that prints it.
 *
 * A RECONCILIATION KNOWS ITS STATEMENT BY IDENTIFIER, AND A READER KNOWS IT BY ITS PERIOD. The two
 * reads are separate on the contract, so the join happens here; a reconciliation whose statement is
 * not among the ones read says so rather than printing a handle at somebody.
 *
 * IT IS PURE, so every one of these is asserted without a browser. A judgment that only exists
 * inside a component is a judgment nothing can check.
 */
import type {
  TrustAccountListing,
  TrustAccountPosition,
  TrustAuthorizationPolicyVersion,
  TrustBankStatement,
  TrustPendingRequest,
  TrustReconciliation,
} from "./trust-api.ts";
import { trustMoneyText } from "./firm-trust-vocabulary.ts";
import { matterNameText } from "./trust-vocabulary.ts";

/* The verb policy is the matter's ledger's as much as this screen's; both import it from here. */
export {
  requestActions,
  type TrustQueueViewer,
  type TrustRequestAction,
  type TrustRequestVerb,
} from "./trust-request-verbs.ts";

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
    ? "the person who releases it must have the authority"
    : "the person who releases it doesn't need the authority";
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

/** The queue, oldest first: the request that has waited longest is the one somebody owes an answer. */
export function queueInOrder(
  requests: readonly TrustPendingRequest[],
): readonly TrustPendingRequest[] {
  return requests.toSorted((left, right) => left.requestedAt.localeCompare(right.requestedAt));
}

// ---- what an account holds today -----------------------------------------------------------------

/** One figure of the Position section: its name, and the figure in the words a reader reads. */
export interface TrustPositionFigure {
  readonly label: string;
  readonly text: string;
}

/**
 * The Position section, decided away from the panel.
 *
 * FIVE FIGURES ARE ALWAYS ANSWERABLE AND THE SIXTH IS NOT. The book balance, what the client
 * ledgers come to, what is under hold, how many matter ledgers there are and how many requests are
 * waiting are facts of every account, zeroes included — a zero is an answer, and a row that stood
 * empty rather than saying "$0.00" would read as a figure nobody could reach. The firm's own
 * cushion is the exception: an account where the carve-out was never opened has no balance at all,
 * which is a different statement from a balance of nothing, so it answers null here and the section
 * says the cushion is not open rather than printing a zero the firm never put there.
 */
export interface TrustPositionReading {
  /** The civil day the figures are as of, in the account's own zone. */
  readonly asOfDate: string;
  readonly figures: readonly TrustPositionFigure[];
  /** The cushion's balance, or null where the carve-out was never opened on this account. */
  readonly firmFundsText: string | null;
}

export function positionReading(
  position: TrustAccountPosition,
  money: (amountMinor: number) => string,
): TrustPositionReading {
  return {
    asOfDate: position.asOfDate,
    figures: [
      { label: "Book Balance", text: money(position.bookBalanceMinor) },
      { label: "Client Ledgers", text: money(position.clientLedgerTotalMinor) },
      { label: "Held", text: money(position.heldMinor) },
      { label: "Matter Ledgers", text: String(position.matterLedgerCount) },
      { label: "Awaiting", text: String(position.pendingRequestCount) },
    ],
    firmFundsText: position.firmFundsMinor === null ? null : money(position.firmFundsMinor),
  };
}

/**
 * The matter behind a queued request, as one line: its number, then its title.
 *
 * The assembly is the one every Trust surface shares (trust-vocabulary.ts). What this adds is the
 * stand-in: where the queue served neither — a request whose matter the read could not name — the
 * line says what it is rather than printing the ledger node's handle at somebody, and the row is
 * still a link, because the matter is still there to open.
 */
export function requestMatterText(request: TrustPendingRequest): string {
  return matterNameText(request.matterNumber, request.matterTitle) ?? "The matter";
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
