import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type {
  TrustAccountId,
  TrustDisbursementDecisionId,
  TrustDisbursementRequestId,
  TrustLedgerNodeId,
  TrustMovementId,
  UserId,
} from "@magna-carta/identifiers/types";
import { currencyFromCode, money, type Money } from "@magna-carta/money/money";
import {
  composeTrustDisbursement,
  mergeEffects,
  resolveTrustDisbursement,
  type ComposedTrustMovement,
  type TrustMovementOptions,
} from "./movements.ts";
import {
  insertTrustDisbursementDecisionStatement,
  insertTrustDisbursementRequestStatement,
  selectActiveTrustManagerCountStatement,
  selectPendingTrustDisbursementRequestsStatement,
  selectTrustDisbursementRequestStatement,
} from "./statements.ts";
import { TrustValidationError } from "./trust-validation.ts";
import type {
  TrustDisbursementAuthorizationBasis,
  TrustDisbursementDecisionKind,
  TrustDisbursementMethod,
  TrustDisbursementRequestSnapshot,
} from "./types.ts";

// Two-person authorization for money leaving a client ledger. A member PROPOSES a disbursement and a
// second member APPROVES it; the trust movement is composed and posted at the moment of approval,
// with the approver recorded as the authorizing member. The whole point of the control is that the
// two acts are separate people, so the split it enforces is between who wrote the record
// (`recorded_by`, the submitter) and who let the money go (`authorized_by`, the approver).
//
// WHAT IS ENFORCED WHERE, on the same principle movements.ts states for the posting itself:
//
//   the decision table's triggers   an approval or a rejection by the member who submitted the
//                                   request, a withdrawal by anyone else, and a sole-manager
//                                   approval in a firm that has more than one trust manager — each
//                                   aborts the batch, including the ledger posting it carried
//   the decision table's UNIQUE     a request is settled exactly once; two concurrent approvals both
//                                   compose a movement and the loser's whole batch rolls back
//   the account_balance floor       the ledger still cannot go negative, whatever this layer thinks
//   this module                     the named refusals a person can act on, and the re-check of
//                                   available balance AT APPROVAL TIME — never the guarantee itself
//
// A PENDING REQUEST IS NOT A MOVEMENT. Until a decision row exists there is no ledger entry, no
// balance change, and no trust_movement row: a request that is rejected, withdrawn, or simply never
// answered leaves the client ledger exactly as it found it.

export interface TrustDisbursementRequestInput {
  readonly fromNodeId: TrustLedgerNodeId;
  readonly amount: Money;
  readonly effectiveDate: string; // YYYY-MM-DD civil date
  readonly description: string;
  readonly method: TrustDisbursementMethod;
  readonly reference?: string | null;
  readonly payee: string;
  readonly purpose: string;
  readonly requestedBy: UserId;
}

export interface ComposedTrustDisbursementRequest {
  readonly requestId: TrustDisbursementRequestId;
  readonly trustAccountId: TrustAccountId;
  readonly nodeId: TrustLedgerNodeId;
  readonly effect: EffectWrite;
}

// Proposing a payment. The same refusals the posting itself earns are raised here, against the
// ledger as it stands now, so a submitter learns immediately that the account is closed, the office
// recorded no jurisdiction, the method is forbidden, or the money is not there — rather than
// discovering it through an approver. None of that makes the check at approval redundant: this one
// is a courtesy about a proposal, and the ledger can change before anyone acts on it.
export async function composeTrustDisbursementRequest(
  database: SqlDatabase,
  input: TrustDisbursementRequestInput,
  options: TrustMovementOptions,
): Promise<ComposedTrustDisbursementRequest> {
  const { node, account, amountMinor } = await resolveTrustDisbursement(database, input, options);

  const requestId = newIdentifier("trustDisbursementRequest", options.randomSource);
  return {
    requestId,
    trustAccountId: account.id,
    nodeId: node.id,
    effect: {
      statements: [
        insertTrustDisbursementRequestStatement(database, {
          id: requestId,
          trustAccountId: account.id,
          nodeId: node.id,
          amountMinor,
          currency: account.currency,
          method: input.method,
          reference: input.reference ?? null,
          payee: input.payee,
          purpose: input.purpose,
          description: input.description,
          effectiveDate: input.effectiveDate,
          requestedBy: input.requestedBy,
          requestedAt: options.clock.now(),
        }),
      ],
      outboxMessages: [],
    },
  };
}

interface TrustDisbursementRequestRow {
  id: string;
  trust_account_id: string;
  node_id: string;
  amount_minor: number;
  currency: string;
  method: TrustDisbursementMethod;
  reference: string | null;
  payee: string;
  purpose: string;
  description: string;
  effective_date: string;
  requested_by: string;
  requested_at: string;
  decision_id?: string | null;
  decision?: TrustDisbursementDecisionKind | null;
  decided_by?: string | null;
  decided_at?: string | null;
  reason?: string | null;
  authorization_basis?: TrustDisbursementAuthorizationBasis | null;
  movement_id?: string | null;
}

function toRequestSnapshot(row: TrustDisbursementRequestRow): TrustDisbursementRequestSnapshot {
  return {
    id: row.id as TrustDisbursementRequestId,
    trustAccountId: row.trust_account_id as TrustAccountId,
    nodeId: row.node_id as TrustLedgerNodeId,
    amountMinor: row.amount_minor,
    currency: row.currency,
    method: row.method,
    reference: row.reference,
    payee: row.payee,
    purpose: row.purpose,
    description: row.description,
    effectiveDate: row.effective_date,
    requestedBy: row.requested_by as UserId,
    requestedAt: row.requested_at,
    // Pending is the ABSENCE of a decision row, never a stored state — the derivation the hold model
    // already uses for "still active".
    decision:
      row.decision_id && row.decision
        ? {
            id: row.decision_id as TrustDisbursementDecisionId,
            decision: row.decision,
            decidedBy: row.decided_by as UserId,
            decidedAt: row.decided_at ?? "",
            reason: row.reason ?? null,
            authorizationBasis: row.authorization_basis ?? null,
            movementId: (row.movement_id as TrustMovementId | null) ?? null,
          }
        : null,
  };
}

// `.all()` + `results[0]`, never `.first()` — the node-sqlite test adapter has no `.first()`.
export async function loadTrustDisbursementRequest(
  database: SqlDatabase,
  requestId: TrustDisbursementRequestId,
): Promise<TrustDisbursementRequestSnapshot> {
  const { results } = await selectTrustDisbursementRequestStatement(
    database,
    requestId,
  ).all<TrustDisbursementRequestRow>();
  const row = results[0];
  if (!row) {
    throw new TrustValidationError(
      "unknown-trust-disbursement-request",
      `no such trust disbursement request: ${requestId}`,
    );
  }
  return toRequestSnapshot(row);
}

// Everything awaiting a decision on one trust account — the queue an approver works from.
export async function readPendingTrustDisbursementRequests(
  database: SqlDatabase,
  trustAccountId: TrustAccountId,
): Promise<readonly TrustDisbursementRequestSnapshot[]> {
  const { results } = await selectPendingTrustDisbursementRequestsStatement(
    database,
    trustAccountId,
  ).all<TrustDisbursementRequestRow>();
  return results.map(toRequestSnapshot);
}

async function loadPendingRequest(
  database: SqlDatabase,
  requestId: TrustDisbursementRequestId,
): Promise<TrustDisbursementRequestSnapshot> {
  const request = await loadTrustDisbursementRequest(database, requestId);
  if (request.decision) {
    throw new TrustValidationError(
      "trust-disbursement-request-already-decided",
      `trust disbursement request ${requestId} was already ${request.decision.decision} by ${request.decision.decidedBy}; a settled request is never re-decided`,
    );
  }
  return request;
}

// How many members could possibly authorize a disbursement in this firm. Read only to turn the
// sole-authorizer trigger's abort into a sentence — the trigger is what actually holds, because this
// read and the write that follows it cannot be one atomic act.
async function readActiveTrustManagerCount(database: SqlDatabase): Promise<number> {
  const { results } = await selectActiveTrustManagerCountStatement(database).all<{
    manager_count: number;
  }>();
  return results[0]?.manager_count ?? 0;
}

export interface TrustDisbursementApprovalInput {
  readonly requestId: TrustDisbursementRequestId;
  readonly approvedBy: UserId;
}

export interface ApprovedTrustDisbursement {
  readonly requestId: TrustDisbursementRequestId;
  readonly decisionId: TrustDisbursementDecisionId;
  readonly authorizationBasis: TrustDisbursementAuthorizationBasis;
  readonly movement: ComposedTrustMovement;
  readonly effect: EffectWrite;
}

// Approval — the only path on which client money actually leaves. The movement is composed HERE,
// through the same `composeTrustDisbursement` an unauthorized payment would have used, so there is
// no second posting path to keep in step with the first: the available-balance ceiling, the
// jurisdiction refusal, the method policy, and the composition guard all apply again, now, against
// the ledger as it stands at the moment of approval. A request written when the client ledger held
// enough and approved after the money went elsewhere refuses, naming the shortfall.
//
// The movement records the SUBMITTER as `recorded_by` and the APPROVER as `authorized_by`. That is
// the whole reason those are two columns: who wrote the payee down and who let the money go are
// different facts, and a rule requiring a second person is worth nothing if the record cannot tell
// them apart.
export async function composeTrustDisbursementApproval(
  database: SqlDatabase,
  input: TrustDisbursementApprovalInput,
  options: TrustMovementOptions,
): Promise<ApprovedTrustDisbursement> {
  const request = await loadPendingRequest(database, input.requestId);

  const approverIsRequester = input.approvedBy === request.requestedBy;
  if (approverIsRequester && (await readActiveTrustManagerCount(database)) > 1) {
    throw new TrustValidationError(
      "trust-disbursement-decider-is-requester",
      `${input.approvedBy} submitted this disbursement request, and this firm has other members who can authorize a trust disbursement; one of them must approve it`,
    );
  }
  const authorizationBasis: TrustDisbursementAuthorizationBasis = approverIsRequester
    ? "sole_trust_manager"
    : "second_person";

  const movement = await composeTrustDisbursement(
    database,
    {
      fromNodeId: request.nodeId,
      amount: money(request.amountMinor, currencyFromCode(request.currency)),
      effectiveDate: request.effectiveDate,
      description: request.description,
      method: request.method,
      reference: request.reference,
      payee: request.payee,
      purpose: request.purpose,
      recordedBy: request.requestedBy,
      authorizedBy: input.approvedBy,
    },
    options,
  );

  const decisionId = newIdentifier("trustDisbursementDecision", options.randomSource);
  return {
    requestId: request.id,
    decisionId,
    authorizationBasis,
    movement,
    // ONE batch: the entry, its lines, the balance updates, the movement record, and this decision.
    // The decision comes last so it names a movement the same batch has already written, and if any
    // of the table's triggers refuses it — the approver is the submitter, the sole-manager basis is
    // unavailable, a decision already exists — the posting goes with it.
    effect: mergeEffects(movement.effect, {
      statements: [
        insertTrustDisbursementDecisionStatement(database, {
          id: decisionId,
          requestId: request.id,
          decision: "approved",
          decidedBy: input.approvedBy,
          decidedAt: options.clock.now(),
          reason: null,
          authorizationBasis,
          movementId: movement.movementId,
        }),
      ],
      outboxMessages: [],
    }),
  };
}

export interface TrustDisbursementRejectionInput {
  readonly requestId: TrustDisbursementRequestId;
  readonly rejectedBy: UserId;
  readonly reason: string;
}

export interface SettledTrustDisbursementRequest {
  readonly requestId: TrustDisbursementRequestId;
  readonly decisionId: TrustDisbursementDecisionId;
  readonly decision: TrustDisbursementDecisionKind;
  readonly effect: EffectWrite;
}

// A refusal, recorded. It carries a reason because the submitter has to be able to answer it, and it
// is a row rather than a deletion because "this payment was proposed and refused, by this member, on
// this date" is exactly the fact a firm needs later. Nothing reaches the ledger.
export async function composeTrustDisbursementRejection(
  database: SqlDatabase,
  input: TrustDisbursementRejectionInput,
  options: TrustMovementOptions,
): Promise<SettledTrustDisbursementRequest> {
  const request = await loadPendingRequest(database, input.requestId);
  if (input.rejectedBy === request.requestedBy) {
    throw new TrustValidationError(
      "trust-disbursement-decider-is-requester",
      `${input.rejectedBy} submitted this disbursement request; taking back your own request is a withdrawal, not a rejection`,
    );
  }
  return settle(database, request.id, "rejected", input.rejectedBy, input.reason, options);
}

export interface TrustDisbursementWithdrawalInput {
  readonly requestId: TrustDisbursementRequestId;
  readonly withdrawnBy: UserId;
  readonly reason?: string | null;
}

// The submitter taking their own proposal back — the one decision the person who wrote the request
// may make about it. Anyone else who wants it stopped rejects it, which is a refusal with a reason
// rather than a request that quietly disappears.
export async function composeTrustDisbursementWithdrawal(
  database: SqlDatabase,
  input: TrustDisbursementWithdrawalInput,
  options: TrustMovementOptions,
): Promise<SettledTrustDisbursementRequest> {
  const request = await loadPendingRequest(database, input.requestId);
  if (input.withdrawnBy !== request.requestedBy) {
    throw new TrustValidationError(
      "trust-disbursement-withdrawal-not-by-requester",
      `only ${request.requestedBy} may withdraw this disbursement request; another member records a rejection with a reason instead`,
    );
  }
  return settle(
    database,
    request.id,
    "withdrawn",
    input.withdrawnBy,
    input.reason ?? null,
    options,
  );
}

function settle(
  database: SqlDatabase,
  requestId: TrustDisbursementRequestId,
  decision: TrustDisbursementDecisionKind,
  decidedBy: UserId,
  reason: string | null,
  options: TrustMovementOptions,
): SettledTrustDisbursementRequest {
  const decisionId = newIdentifier("trustDisbursementDecision", options.randomSource);
  return {
    requestId,
    decisionId,
    decision,
    effect: {
      statements: [
        insertTrustDisbursementDecisionStatement(database, {
          id: decisionId,
          requestId,
          decision,
          decidedBy,
          decidedAt: options.clock.now(),
          reason,
          authorizationBasis: null,
          movementId: null,
        }),
      ],
      outboxMessages: [],
    },
  };
}
