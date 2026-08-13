import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type {
  MatterId,
  TrustAccountId,
  TrustLedgerNodeId,
  TrustMovementId,
  TrustUnclaimedFundsContactAttemptId,
  TrustUnclaimedFundsReviewClosureId,
  TrustUnclaimedFundsReviewId,
  UserId,
} from "@magna-carta/identifiers/types";
import { isValidCalendarDate } from "@magna-carta/ledger/validate";
import { loadTrustAccount, loadTrustNode, type TrustServiceOptions } from "./account-tree.ts";
import {
  insertTrustUnclaimedFundsContactAttemptStatement,
  insertTrustUnclaimedFundsReviewClosureStatement,
  insertTrustUnclaimedFundsReviewStatement,
  MAX_TRUST_RECONCILIATION_ROWS,
  selectDormantTrustBalancesStatement,
  selectOpenTrustUnclaimedFundsReviewForNodeStatement,
  selectTrustMovementStatement,
  selectTrustUnclaimedFundsContactAttemptsStatement,
  selectTrustUnclaimedFundsReviewClosureStatement,
  selectTrustUnclaimedFundsReviewStatement,
} from "./statements.ts";
import { TrustValidationError } from "./trust-validation.ts";
import type {
  TrustDormantBalance,
  TrustUnclaimedFundsContactAttemptSnapshot,
  TrustUnclaimedFundsContactChannel,
  TrustUnclaimedFundsContactOutcome,
  TrustUnclaimedFundsReviewClosureSnapshot,
  TrustUnclaimedFundsReviewOutcome,
  TrustUnclaimedFundsReviewSnapshot,
} from "./types.ts";

// UNCLAIMED CLIENT FUNDS — WHAT THIS IS, AND THE THREE THINGS IT DELIBERATELY IS NOT.
//
// A firm holding money for somebody it can no longer reach has a continuing duty: make reasonable
// efforts to locate the owner, distribute the funds, and be able to evidence both afterwards. The
// evidence is the part a platform can genuinely hold — attempt by attempt, at the time, in a form
// nobody can reconstruct two years later — and that is what these composers record.
//
// IT IS NOT AN ESCHEAT FEATURE. In the jurisdiction researched for this subsystem, designated client
// trust accounts are exempt from the state unclaimed-property presumption outright: nothing escheats,
// no dormancy period runs against them, and the one onward destination the rules name is permissive
// rather than compelled. A countdown to a deadline that does not exist would assert an obligation on
// a firm that no rule imposes.
//
// IT IS NOT A SWEEP. No timer fires, no queue drains, and no composer here moves money. A
// distribution to a located owner is an ordinary disbursement composed, authorized, and committed
// through the ordinary path; closing a review attaches the movement that ALREADY happened and has no
// route to create one. That is the whole of the manual-confirmation gate, and it is structural: the
// closure composer's inputs contain a movement identifier and contain nothing an entry could be
// built from.
//
// IT IS NOT A STORED FLAG. Dormancy is a comparison over the movement rows the ledger already has,
// made at read time against a window the reader states — the same posture the calendar holds for an
// overdue deadline. A stored flag would need a sweep to maintain, would be stale between sweeps, and
// would have the platform asserting something about the firm's conduct it cannot know: the firm may
// have spoken to the client this morning in a way this platform never saw.

interface DormantBalanceRow {
  node_id: string;
  trust_account_id: string;
  matter_id: string;
  client_entity_id: string;
  balance_minor: number;
  currency: string;
  earliest_receipt_date: string | null;
  last_activity_date: string | null;
  open_review_id: string | null;
}

interface ReviewRow {
  id: string;
  trust_account_id: string;
  node_id: string;
  observed_balance_minor: number;
  currency: string;
  observed_earliest_receipt_date: string | null;
  observed_last_activity_date: string | null;
  opened_by: string;
  opened_at: string;
  note: string | null;
}

interface AttemptRow {
  id: string;
  review_id: string;
  channel: TrustUnclaimedFundsContactChannel;
  attempted_on: string;
  contact_used: string | null;
  outcome: TrustUnclaimedFundsContactOutcome;
  note: string | null;
  recorded_by: string;
  recorded_at: string;
}

interface ClosureRow {
  id: string;
  review_id: string;
  outcome: TrustUnclaimedFundsReviewOutcome;
  movement_id: string | null;
  closed_by: string;
  closed_at: string;
  note: string | null;
}

interface MovementRow {
  id: string;
  node_id: string;
  kind: string;
}

export interface ReadDormantTrustBalancesInput {
  readonly trustAccountId: TrustAccountId;
  // The window, STATED BY THE READER and never defaulted to a jurisdiction's period. A ledger is
  // listed when its most recent movement is on or before this date. There is no default because
  // there is no number the platform is entitled to pick: the periods differ by jurisdiction, the
  // clocks they run from differ, and several of the ones that exist gate a permission rather than an
  // obligation.
  readonly quietOnOrBefore: string; // YYYY-MM-DD civil date
}

export interface DormantTrustBalancesResult {
  readonly quietOnOrBefore: string;
  readonly balances: readonly TrustDormantBalance[];
}

// THE DORMANCY READ. Matter ledgers under one trust account that still hold money and have been
// quiet since a date the caller names, with the two dates a firm's duty is measured from. It reports
// and concludes nothing: no row carries a verdict, and the absence of one is why this read can be
// wrong about a client without the platform having asserted anything.
//
// The list is capped and the cap is DETECTED rather than silent, on the same reasoning as the
// reconciliation's outstanding read: a firm working a truncated diligence list would believe it had
// worked the whole one.
export async function readDormantTrustBalances(
  database: SqlDatabase,
  input: ReadDormantTrustBalancesInput,
): Promise<DormantTrustBalancesResult> {
  if (!isValidCalendarDate(input.quietOnOrBefore)) {
    throw new TrustValidationError(
      "trust-unclaimed-funds-window-invalid",
      `${input.quietOnOrBefore} is not a calendar date; the dormancy window is a date the reader states, so it has to be one`,
    );
  }
  await loadTrustAccount(database, input.trustAccountId);
  const { results } = await selectDormantTrustBalancesStatement(
    database,
    input.trustAccountId,
    input.quietOnOrBefore,
  ).all<DormantBalanceRow>();
  if (results.length > MAX_TRUST_RECONCILIATION_ROWS) {
    throw new TrustValidationError(
      "trust-dormant-balances-truncated",
      `more than ${MAX_TRUST_RECONCILIATION_ROWS} client ledgers on this trust account have been quiet since ${input.quietOnOrBefore}, which is more than one list can honestly present: narrow the window`,
    );
  }
  return {
    quietOnOrBefore: input.quietOnOrBefore,
    balances: results.map((row) => ({
      nodeId: row.node_id as TrustLedgerNodeId,
      trustAccountId: row.trust_account_id as TrustAccountId,
      matterId: row.matter_id as MatterId,
      clientEntityId: row.client_entity_id,
      balanceMinor: row.balance_minor,
      currency: row.currency,
      earliestReceiptDate: row.earliest_receipt_date,
      lastActivityDate: row.last_activity_date,
      openReviewId: row.open_review_id as TrustUnclaimedFundsReviewId | null,
    })),
  };
}

export interface OpenTrustUnclaimedFundsReviewInput {
  readonly nodeId: TrustLedgerNodeId;
  // What the reader saw, passed in rather than re-read, because a review records the OBSERVATION a
  // person acted on. Re-reading here would store a figure nobody looked at, and the two would differ
  // exactly when a movement landed between the list and the decision — which is the moment the
  // record matters most.
  readonly observedBalanceMinor: number;
  readonly observedEarliestReceiptDate: string | null;
  readonly observedLastActivityDate: string | null;
  readonly openedBy: UserId;
  readonly note?: string | null;
}

export interface ComposedTrustUnclaimedFundsReview {
  readonly reviewId: TrustUnclaimedFundsReviewId;
  readonly effect: EffectWrite;
}

// Opens the diligence file over one dormant client ledger. It writes one row and moves nothing.
export async function composeTrustUnclaimedFundsReview(
  database: SqlDatabase,
  input: OpenTrustUnclaimedFundsReviewInput,
  options: TrustServiceOptions,
): Promise<ComposedTrustUnclaimedFundsReview> {
  const node = await loadTrustNode(database, input.nodeId);
  if (node.kind !== "matter") {
    throw new TrustValidationError(
      "movement-node-is-not-a-matter-leaf",
      `${node.id} is a ${node.kind} node; an unclaimed-funds review is about one client's matter ledger, which is the only tier that holds a balance`,
    );
  }
  if (input.observedBalanceMinor <= 0) {
    throw new TrustValidationError(
      "trust-unclaimed-funds-node-holds-no-balance",
      `client ledger ${node.id} holds nothing to be unclaimed; a review exists to locate the owner of money the firm is still holding`,
    );
  }
  const account = await loadTrustAccount(database, node.trustAccountId);

  // ONE OPEN REVIEW PER LEDGER. Two concurrent diligence files over one balance would split the
  // evidence trail in half, and the certification a firm eventually signs is about the whole search.
  // Open is derived from the absence of a closure row, so this is a read in front of the rows rather
  // than a flag that could disagree with them.
  const existing = await selectOpenTrustUnclaimedFundsReviewForNodeStatement(
    database,
    node.id,
  ).all<ReviewRow>();
  const openRow = existing.results[0];
  if (openRow) {
    throw new TrustValidationError(
      "trust-unclaimed-funds-review-already-open",
      `client ledger ${node.id} already has an open unclaimed-funds review (${openRow.id}); record the further attempts on that one`,
    );
  }

  const reviewId = newIdentifier("trustUnclaimedFundsReview", options.randomSource);
  return {
    reviewId,
    effect: {
      statements: [
        insertTrustUnclaimedFundsReviewStatement(database, {
          id: reviewId,
          trustAccountId: account.id,
          nodeId: node.id,
          observedBalanceMinor: input.observedBalanceMinor,
          currency: account.currency,
          observedEarliestReceiptDate: input.observedEarliestReceiptDate,
          observedLastActivityDate: input.observedLastActivityDate,
          openedBy: input.openedBy,
          openedAt: options.clock.now(),
          note: input.note ?? null,
        }),
      ],
      outboxMessages: [],
    },
  };
}

export interface RecordTrustUnclaimedFundsContactAttemptInput {
  readonly reviewId: TrustUnclaimedFundsReviewId;
  readonly channel: TrustUnclaimedFundsContactChannel;
  readonly attemptedOn: string; // YYYY-MM-DD civil date
  // The address, number, or mailbox actually used. Required on every channel but a review of the
  // firm's own records, because the certification has to reproduce it: "we wrote to the client" is
  // not evidence, and "we wrote to 14 Elm Street on 3 March, returned undelivered" is.
  readonly contactUsed?: string | null;
  readonly outcome: TrustUnclaimedFundsContactOutcome;
  readonly note?: string | null;
  readonly recordedBy: UserId;
}

export interface ComposedTrustUnclaimedFundsContactAttempt {
  readonly attemptId: TrustUnclaimedFundsContactAttemptId;
  readonly effect: EffectWrite;
}

// One locate attempt, recorded when it was made. Append-only: an attempt that happened cannot be
// un-happened, and a correction is a further row saying so.
export async function composeTrustUnclaimedFundsContactAttempt(
  database: SqlDatabase,
  input: RecordTrustUnclaimedFundsContactAttemptInput,
  options: TrustServiceOptions,
): Promise<ComposedTrustUnclaimedFundsContactAttempt> {
  const review = await readTrustUnclaimedFundsReview(database, input.reviewId);
  if (review.closure !== null) {
    throw new TrustValidationError(
      "trust-unclaimed-funds-review-already-closed",
      `review ${review.id} was closed on ${review.closure.closedAt}; a further attempt belongs to a new review, which is what makes each round of diligence readable as a round`,
    );
  }
  if (!isValidCalendarDate(input.attemptedOn)) {
    throw new TrustValidationError(
      "trust-unclaimed-funds-window-invalid",
      `${input.attemptedOn} is not a calendar date`,
    );
  }

  const attemptId = newIdentifier("trustUnclaimedFundsContactAttempt", options.randomSource);
  return {
    attemptId,
    effect: {
      statements: [
        insertTrustUnclaimedFundsContactAttemptStatement(database, {
          id: attemptId,
          reviewId: review.id,
          channel: input.channel,
          attemptedOn: input.attemptedOn,
          contactUsed: input.channel === "record_review" ? null : (input.contactUsed ?? null),
          outcome: input.outcome,
          note: input.note ?? null,
          recordedBy: input.recordedBy,
          recordedAt: options.clock.now(),
        }),
      ],
      outboxMessages: [],
    },
  };
}

export interface CloseTrustUnclaimedFundsReviewInput {
  readonly reviewId: TrustUnclaimedFundsReviewId;
  readonly outcome: TrustUnclaimedFundsReviewOutcome;
  // THE MANUAL-CONFIRMATION GATE, EXPRESSED AS A TYPE. On a distribution this names a
  // `trust_movement` that already exists — a disbursement somebody composed, authorized under the
  // firm's policy, and committed through the ordinary path. There is no amount here, no payee, no
  // effective date, and no method: nothing this composer receives could be assembled into a ledger
  // entry, so closing a review can attach money that moved and can never be the thing that moved it.
  readonly movementId?: TrustMovementId | null;
  readonly closedBy: UserId;
  readonly note?: string | null;
}

export interface ComposedTrustUnclaimedFundsReviewClosure {
  readonly closureId: TrustUnclaimedFundsReviewClosureId;
  readonly effect: EffectWrite;
}

// Ends one round of diligence. Writes exactly one row and posts nothing.
export async function composeTrustUnclaimedFundsReviewClosure(
  database: SqlDatabase,
  input: CloseTrustUnclaimedFundsReviewInput,
  options: TrustServiceOptions,
): Promise<ComposedTrustUnclaimedFundsReviewClosure> {
  const review = await readTrustUnclaimedFundsReview(database, input.reviewId);
  if (review.closure !== null) {
    throw new TrustValidationError(
      "trust-unclaimed-funds-review-already-closed",
      `review ${review.id} was already closed on ${review.closure.closedAt}`,
    );
  }

  const movementId = input.outcome === "distributed_to_owner" ? (input.movementId ?? null) : null;
  if (input.outcome === "distributed_to_owner") {
    if (movementId === null) {
      throw new TrustValidationError(
        "trust-unclaimed-funds-movement-is-not-this-ledger",
        "closing a review as distributed names the disbursement that paid the owner; there is deliberately no path here that composes one",
      );
    }
    // THE MOVEMENT HAS TO BE THIS LEDGER'S. A closure naming somebody else's payment would record a
    // client as paid out of another client's money — and it would read, on the diligence file a firm
    // hands an examiner, as though the search had succeeded.
    const { results } = await selectTrustMovementStatement(database, movementId).all<MovementRow>();
    const movement = results[0];
    if (!movement || movement.node_id !== review.nodeId || movement.kind !== "disbursement") {
      throw new TrustValidationError(
        "trust-unclaimed-funds-movement-is-not-this-ledger",
        `movement ${movementId} is not a disbursement from client ledger ${review.nodeId}, so it cannot be what settled this review`,
      );
    }
  }

  const closureId = newIdentifier("trustUnclaimedFundsReviewClosure", options.randomSource);
  return {
    closureId,
    effect: {
      statements: [
        insertTrustUnclaimedFundsReviewClosureStatement(database, {
          id: closureId,
          reviewId: review.id,
          outcome: input.outcome,
          movementId,
          closedBy: input.closedBy,
          closedAt: options.clock.now(),
          note: input.note ?? null,
        }),
      ],
      outboxMessages: [],
    },
  };
}

// One review with its whole evidence trail: the observations it was opened on, every attempt in the
// order they were made, and the closure if there is one. This is the shape a certification is
// assembled from, which is why the attempts come back with the review rather than through a second
// call a caller could forget to make.
export async function readTrustUnclaimedFundsReview(
  database: SqlDatabase,
  reviewId: TrustUnclaimedFundsReviewId,
): Promise<TrustUnclaimedFundsReviewSnapshot> {
  const { results } = await selectTrustUnclaimedFundsReviewStatement(
    database,
    reviewId,
  ).all<ReviewRow>();
  const row = results[0];
  if (!row) {
    throw new TrustValidationError(
      "unknown-trust-unclaimed-funds-review",
      `no such unclaimed-funds review: ${reviewId}`,
    );
  }
  const [attemptRows, closureRows] = await Promise.all([
    selectTrustUnclaimedFundsContactAttemptsStatement(database, reviewId).all<AttemptRow>(),
    selectTrustUnclaimedFundsReviewClosureStatement(database, reviewId).all<ClosureRow>(),
  ]);
  const closureRow = closureRows.results[0];
  return {
    id: row.id as TrustUnclaimedFundsReviewId,
    trustAccountId: row.trust_account_id as TrustAccountId,
    nodeId: row.node_id as TrustLedgerNodeId,
    observedBalanceMinor: row.observed_balance_minor,
    currency: row.currency,
    observedEarliestReceiptDate: row.observed_earliest_receipt_date,
    observedLastActivityDate: row.observed_last_activity_date,
    openedBy: row.opened_by as UserId,
    openedAt: row.opened_at,
    note: row.note,
    attempts: attemptRows.results.map(toAttemptSnapshot),
    closure: closureRow ? toClosureSnapshot(closureRow) : null,
  };
}

function toAttemptSnapshot(row: AttemptRow): TrustUnclaimedFundsContactAttemptSnapshot {
  return {
    id: row.id as TrustUnclaimedFundsContactAttemptId,
    reviewId: row.review_id as TrustUnclaimedFundsReviewId,
    channel: row.channel,
    attemptedOn: row.attempted_on,
    contactUsed: row.contact_used,
    outcome: row.outcome,
    note: row.note,
    recordedBy: row.recorded_by as UserId,
    recordedAt: row.recorded_at,
  };
}

function toClosureSnapshot(row: ClosureRow): TrustUnclaimedFundsReviewClosureSnapshot {
  return {
    id: row.id as TrustUnclaimedFundsReviewClosureId,
    outcome: row.outcome,
    movementId: row.movement_id as TrustMovementId | null,
    closedBy: row.closed_by as UserId,
    closedAt: row.closed_at,
    note: row.note,
  };
}
