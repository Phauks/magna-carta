import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type {
  MatterId,
  TrustAccountId,
  TrustAuthorizationPolicyId,
  TrustDisbursementDecisionId,
  TrustDisbursementRequestId,
  TrustLedgerNodeId,
  TrustMovementId,
  TrustTransferId,
  UserId,
} from "@magna-carta/identifiers/types";
import { currencyFromCode, money, type Money } from "@magna-carta/money/money";
import { assertTrustAccountOpen, loadTrustAccount, loadTrustNode } from "./account-tree.ts";
import {
  assertActorHoldsTrustAuthority,
  loadTrustAuthorizationPolicy,
  readCurrentTrustAuthorizationPolicy,
  resolveLoneTrustManagerException,
  resolveTrustAuthorizationDisposition,
  trustAuthorizationRequiresSecondPerson,
  type TrustAuthorizationDisposition,
} from "./authorization-policy.ts";
import { readTrustAvailableBalance } from "./holds.ts";
import {
  assertMovementCurrency,
  composeTrustDisbursement,
  mergeEffects,
  resolveTrustDisbursement,
  type ComposedTrustMovement,
  type TrustMovementOptions,
} from "./movements.ts";
import {
  insertTrustDisbursementDecisionStatement,
  insertTrustDisbursementRequestStatement,
  selectPendingTrustDisbursementRequestsStatement,
  selectTrustDisbursementRequestStatement,
} from "./statements.ts";
import { TrustValidationError } from "./trust-validation.ts";
import type {
  TrustAuthorizationPolicySnapshot,
  TrustDisbursementAuthorizationBasis,
  TrustDisbursementDecisionKind,
  TrustDisbursementMethod,
  TrustDisbursementRequestKind,
  TrustDisbursementRequestSnapshot,
  TrustPendingDisbursementRequestSnapshot,
} from "./types.ts";

// Authorization for money leaving a client ledger, under the FIRM'S OWN POLICY
// (authorization-policy.ts): a member PROPOSES a payment and — when the policy stamped on the
// request requires it — a second member APPROVES it; the posting is composed at the moment of
// approval, with the approver recorded as the authorizing member. When the stamped policy does not
// require a second person (off, or at-or-below the threshold), the submitter approves their own
// request and the decision says so on its face (`policy_exempt`). Either way the split the record
// enforces is between who wrote the record (`recorded_by`, the submitter) and who let the money go
// (`authorized_by`, the approver).
//
// ONE QUEUE, TWO KINDS. A `disbursement` request is approved here and posts a trust movement; an
// `earned_fee_application` request is submitted here (billing keeps its invoice lines beside it) and
// approved through billing, posting a trust-to-operating transfer. The decision table and its
// triggers govern both, which is what "the earned-fee application follows the same policy" means
// structurally.
//
// WHAT IS ENFORCED WHERE, on the same principle movements.ts states for the posting itself:
//
//   the decision table's triggers   an approval by the submitter under a policy that requires a
//                                   second person, a rejection by the submitter, a withdrawal by
//                                   anyone else, an exception basis that misdescribes the stamped
//                                   policy, a sole-manager approval in a firm with more than one
//                                   trust manager, and a deciding member without authority where the
//                                   policy requires it — each aborts the batch, including the ledger
//                                   posting it carried
//   the decision table's UNIQUE     a request is settled exactly once; two concurrent approvals both
//                                   compose a posting and the loser's whole batch rolls back
//   the account_balance floor       the ledger still cannot go negative, whatever this layer thinks
//   this module                     the named refusals a person can act on, and the re-check of
//                                   available balance AT APPROVAL TIME — never the guarantee itself
//
// THE POLICY IS READ FROM THE REQUEST'S STAMP, NEVER THE LATEST VERSION: an in-flight request keeps
// the rules it was submitted against, in both directions.
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
  // The proposal's amount in the ACCOUNT's minor units, as the request row stores it — so a caller
  // asking the authorization question about this proposal asks it about the same number the
  // triggers compare against the stamped threshold, never about a re-derived one.
  readonly amountMinor: number;
  // The policy version STAMPED on the request, for the same reason: a caller deciding what this
  // member may do with this proposal must ask it of the row the decision triggers will read, not of
  // a second read of "the current policy" that could have moved in between.
  readonly policy: TrustAuthorizationPolicySnapshot;
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
  // The stamp: the policy in force NOW is the one this request will be decided under, however the
  // firm's posture changes while it is pending. The stamp-is-current trigger holds this at the
  // database.
  const policy = await readCurrentTrustAuthorizationPolicy(database);

  const requestId = newIdentifier("trustDisbursementRequest", options.randomSource);
  return {
    requestId,
    trustAccountId: account.id,
    nodeId: node.id,
    amountMinor,
    policy,
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
          kind: "disbursement",
          operatingDescription: null,
          policyId: policy.id,
        }),
      ],
      outboxMessages: [],
    },
  };
}

export interface ComposedTrustDisbursementSubmission extends ComposedTrustDisbursementRequest {
  readonly disposition: TrustAuthorizationDisposition;
  // Present exactly when the disposition was `solo`: the payment was proposed and released in the
  // same act, by the same member, and this is what the record says about it.
  readonly released: {
    readonly decisionId: TrustDisbursementDecisionId;
    readonly authorizationBasis: TrustDisbursementAuthorizationBasis;
    readonly movement: ComposedTrustMovement;
  } | null;
}

// PROPOSING A PAYMENT, AND — WHEN THIS MEMBER MAY RELEASE IT ALONE — RELEASING IT, IN ONE ACT.
//
// The firm's posture decides which of the two happened, through the shared disposition read: a
// member holding the authority the firm requires releases an amount no second person is needed for
// by themselves; anybody else leaves a pending request behind for somebody who can. Both outcomes
// come out of ONE effect, so a solo release is one atomic write rather than a proposal followed by
// a second call — which matters beyond tidiness: between those two calls the request is pending, and
// another member could settle it as an ordinary two-person approval the submitter never asked for.
//
// The solo arm composes NOTHING new. It reuses the same request composer, the same
// `composeTrustDisbursement` an approval would have used, and the same decision statement, in the
// order the decision triggers need: the request row, then the posting, then the decision that names
// both. Every guard therefore still fires — the available-balance ceiling, the jurisdiction
// refusals, the method policy, the composition guard, and the decision table's whole trigger set —
// and if any of them refuses, the proposal goes down with the payment.
export async function composeTrustDisbursementSubmission(
  database: SqlDatabase,
  input: TrustDisbursementRequestInput,
  options: TrustMovementOptions,
): Promise<ComposedTrustDisbursementSubmission> {
  const request = await composeTrustDisbursementRequest(database, input, options);
  // Resolved against the version the request itself STAMPED, not a second read of "the current
  // policy": the answer this caller acts on and the row the decision triggers will read have to be
  // the same one, or a posture change landing between the two reads would produce a decision whose
  // basis its own stamp contradicts. The stamp-is-current trigger holds the other half at the
  // database.
  const disposition = await resolveTrustAuthorizationDisposition(database, {
    policy: request.policy,
    amountMinor: request.amountMinor,
    actor: input.requestedBy,
  });

  if (disposition.mode === "route" || disposition.authorizationBasis === null) {
    return { ...request, disposition, released: null };
  }

  const movement = await composeTrustDisbursement(
    database,
    {
      fromNodeId: request.nodeId,
      amount: input.amount,
      effectiveDate: input.effectiveDate,
      description: input.description,
      method: input.method,
      reference: input.reference ?? null,
      payee: input.payee,
      purpose: input.purpose,
      // One member did both, and the record says so plainly rather than leaving a reader to notice
      // that two handles match: the basis on the decision names the footing they acted on.
      recordedBy: input.requestedBy,
      authorizedBy: input.requestedBy,
    },
    options,
  );

  const decisionId = newIdentifier("trustDisbursementDecision", options.randomSource);
  return {
    ...request,
    disposition,
    released: {
      decisionId,
      authorizationBasis: disposition.authorizationBasis,
      movement,
    },
    effect: mergeEffects(request.effect, movement.effect, {
      statements: [
        insertTrustDisbursementDecisionStatement(database, {
          id: decisionId,
          requestId: request.requestId,
          decision: "approved",
          decidedBy: input.requestedBy,
          decidedAt: options.clock.now(),
          reason: null,
          authorizationBasis: disposition.authorizationBasis,
          movementId: movement.movementId,
          transferId: null,
        }),
      ],
      outboxMessages: [],
    }),
  };
}

export interface EarnedFeeApplicationAuthorizationRequestInput {
  readonly fromNodeId: TrustLedgerNodeId;
  readonly amount: Money;
  readonly effectiveDate: string; // YYYY-MM-DD civil date
  readonly description: string; // the trust leg's ledger-entry description on approval
  readonly operatingDescription: string; // the operating leg's
  readonly method: TrustDisbursementMethod; // how the money will physically move to the firm
  readonly reference?: string | null;
  readonly payee: string; // the firm, as it will appear on the client ledger
  readonly purpose: string;
  readonly requestedBy: UserId;
}

// Proposing an earned-fee application — the queue row for billing's "apply trust funds" when the
// firm's policy requires a second person (and available to any firm that wants the review step).
// Trust knows the money side only: the leaf, the amount, the descriptions both legs will carry.
// WHICH INVOICES the amount settles is billing's fact, stored by billing beside this request and
// re-resolved at approval; the lines-sum trigger holds the two sides equal at the database.
export async function composeEarnedFeeApplicationAuthorizationRequest(
  database: SqlDatabase,
  input: EarnedFeeApplicationAuthorizationRequestInput,
  options: TrustMovementOptions,
): Promise<ComposedTrustDisbursementRequest> {
  const node = await loadTrustNode(database, input.fromNodeId);
  const account = await loadTrustAccount(database, node.trustAccountId);
  assertTrustAccountOpen(account);
  const amountMinor = assertMovementCurrency(account, input.amount);

  // The same courtesy the disbursement proposal extends: tell the submitter NOW that the money is
  // not there, rather than through an approver. The re-check at approval is the one that counts.
  const available = await readTrustAvailableBalance(database, input.fromNodeId);
  if (amountMinor > available.availableMinor) {
    throw new TrustValidationError(
      "transfer-exceeds-available",
      `a transfer of ${amountMinor} exceeds the ${available.availableMinor} available on this client ledger`,
    );
  }

  const policy = await readCurrentTrustAuthorizationPolicy(database);
  const requestId = newIdentifier("trustDisbursementRequest", options.randomSource);
  return {
    requestId,
    trustAccountId: account.id,
    nodeId: node.id,
    amountMinor,
    policy,
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
          kind: "earned_fee_application",
          operatingDescription: input.operatingDescription,
          policyId: policy.id,
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
  kind: TrustDisbursementRequestKind;
  operating_description: string | null;
  policy_id: string | null;
  // Only the queue read joins the matter beside the request; every other read of this row leaves
  // these absent, which is why they are optional rather than nullable columns.
  matter_id?: string | null;
  matter_number?: string | null;
  matter_title?: string | null;
  decision_id?: string | null;
  decision?: TrustDisbursementDecisionKind | null;
  decided_by?: string | null;
  decided_at?: string | null;
  reason?: string | null;
  authorization_basis?: TrustDisbursementAuthorizationBasis | null;
  movement_id?: string | null;
  transfer_id?: string | null;
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
    kind: row.kind,
    operatingDescription: row.operating_description,
    policyId: (row.policy_id as TrustAuthorizationPolicyId | null) ?? null,
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
            transferId: (row.transfer_id as TrustTransferId | null) ?? null,
          }
        : null,
  };
}

// `.all()` + `results[0]`, never `.first()` — the one-row read convention (one sentinel for
// "no row"), stated in packages/data-access/src/idempotency-statements.ts.
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

function toPendingRequestSnapshot(
  row: TrustDisbursementRequestRow,
): TrustPendingDisbursementRequestSnapshot {
  const request = toRequestSnapshot(row);
  return {
    ...request,
    matterId: (row.matter_id as MatterId | null) ?? null,
    matterNumber: row.matter_number ?? null,
    matterTitle: row.matter_title ?? null,
  };
}

// Everything awaiting a decision on one trust account — the queue an approver works from, with the
// matter each request would take money from. The matter arrives on the same statement rather than
// through a read per row: a queue of forty requests must not be forty round trips, and an approver
// who cannot see whose ledger is being paid out is deciding on a payee and an amount alone.
export async function readPendingTrustDisbursementRequests(
  database: SqlDatabase,
  trustAccountId: TrustAccountId,
): Promise<readonly TrustPendingDisbursementRequestSnapshot[]> {
  const { results } = await selectPendingTrustDisbursementRequestsStatement(
    database,
    trustAccountId,
  ).all<TrustDisbursementRequestRow>();
  return results.map(toPendingRequestSnapshot);
}

export async function loadPendingTrustDisbursementRequest(
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

export interface TrustDisbursementApprovalInput {
  readonly requestId: TrustDisbursementRequestId;
  readonly approvedBy: UserId;
}

// THE SHARED APPROVAL RESOLUTION — one answer, for both kinds of request, to "on what footing may
// this member let this money go", with the named refusals in front of the triggers that guarantee
// it. Reads the policy STAMPED on the request (the in-flight rule), decides the basis, and asserts
// the authority option. The disbursement approval below and billing's application approval both run
// through here, so the policy has exactly one interpretation.
export async function resolveTrustAuthorizationApproval(
  database: SqlDatabase,
  request: TrustDisbursementRequestSnapshot,
  decidedBy: UserId,
): Promise<{
  readonly authorizationBasis: TrustDisbursementAuthorizationBasis;
  readonly policyId: TrustAuthorizationPolicyId | null;
}> {
  const policy = await loadTrustAuthorizationPolicy(database, request.policyId);
  const requiresSecondPerson = trustAuthorizationRequiresSecondPerson(policy, request.amountMinor);

  const deciderIsRequester = decidedBy === request.requestedBy;
  if (deciderIsRequester && requiresSecondPerson) {
    // The lone-holder exception, resolved through the one helper both this and the disposition read
    // use: available only when the firm has exactly one holder AND the decider IS that holder.
    const { available, managers } = await resolveLoneTrustManagerException(database, decidedBy);
    if (managers.length > 1) {
      // The refusal NAMES them. The trigger this mirrors counts a direct grant of `trust:manage`
      // whether or not it has expired, deliberately, because over-counting authorizers refuses the
      // sole-manager exception and that is the safe direction to be wrong in. A firm told only that
      // it "has other members" cannot find the lapsed grant that is speaking for a person who no
      // longer works there, and would be locked out of paying client money out at all.
      const others = managers
        .filter((manager) => manager.user_id !== decidedBy)
        .map((manager) => `${manager.display_name} (${manager.user_id})`)
        .join(", ");
      throw new TrustValidationError(
        "trust-disbursement-decider-is-requester",
        `${decidedBy} submitted this request, and this firm has other members who can authorize money leaving a client ledger; one of them must approve it: ${others}`,
      );
    }
    // The exception belongs to the one member the count found, not to whoever reached this line
    // while a lone holder exists: a member who can submit but not authorize must route the request
    // to the holder, or the recorded basis would assert a footing nobody had. The trigger holds the
    // same membership test.
    if (!available) {
      const holder = managers
        .map((manager) => `${manager.display_name} (${manager.user_id})`)
        .join(", ");
      throw new TrustValidationError(
        "trust-disbursement-decider-is-requester",
        managers.length === 0
          ? `no active member of this firm holds trust:manage, so nobody may authorize money leaving a client ledger; grant the capability first`
          : `${decidedBy} does not hold trust:manage; the sole-authorizer exception belongs to the firm's only member who does, and this request must be approved by: ${holder}`,
      );
    }
  }

  // The authority option binds whoever lets money go, second person or sole actor alike. The
  // trigger is the guarantee; this refusal names who can act instead.
  await assertActorHoldsTrustAuthority(database, policy, decidedBy);

  // The basis states the footing on its face: a second person; the sole manager of a firm with
  // nobody else where one was required; or the stamped policy not requiring one at this amount.
  return {
    authorizationBasis: deciderIsRequester
      ? requiresSecondPerson
        ? "sole_trust_manager"
        : "policy_exempt"
      : "second_person",
    policyId: policy.id,
  };
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
  const request = await loadPendingTrustDisbursementRequest(database, input.requestId);
  if (request.kind !== "disbursement") {
    // An application's approval must re-resolve its invoice lines and compose a transfer, which
    // this composer knows nothing about — billing owns that approval and merges it into one batch.
    throw new TrustValidationError(
      "trust-request-not-a-disbursement",
      `request ${request.id} is an earned-fee application; approve it through the billing application flow, which posts the transfer its invoices account for`,
    );
  }

  const { authorizationBasis } = await resolveTrustAuthorizationApproval(
    database,
    request,
    input.approvedBy,
  );

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
          transferId: null,
        }),
      ],
      outboxMessages: [],
    }),
  };
}

export interface EarnedFeeApplicationApprovalDecisionInput {
  readonly requestId: TrustDisbursementRequestId;
  readonly decidedBy: UserId;
  readonly authorizationBasis: TrustDisbursementAuthorizationBasis;
  readonly transferId: TrustTransferId;
}

export interface EarnedFeeApplicationApprovalDecision {
  readonly decisionId: TrustDisbursementDecisionId;
  readonly effect: EffectWrite;
}

// The decision row an approved earned-fee application rides out on. Billing composes the transfer
// (through trust's own transfer composer) and the invoice applications; trust composes the decision
// that settles the queue row, because the decision table and its discipline are trust's. The caller
// merges this into the ONE batch carrying the transfer — the triggers then hold the decision, the
// transfer, and the request in agreement or abort all of it together.
export function composeEarnedFeeApplicationApprovalDecision(
  database: SqlDatabase,
  input: EarnedFeeApplicationApprovalDecisionInput,
  options: TrustMovementOptions,
): EarnedFeeApplicationApprovalDecision {
  const decisionId = newIdentifier("trustDisbursementDecision", options.randomSource);
  return {
    decisionId,
    effect: {
      statements: [
        insertTrustDisbursementDecisionStatement(database, {
          id: decisionId,
          requestId: input.requestId,
          decision: "approved",
          decidedBy: input.decidedBy,
          decidedAt: options.clock.now(),
          reason: null,
          authorizationBasis: input.authorizationBasis,
          movementId: null,
          transferId: input.transferId,
        }),
      ],
      outboxMessages: [],
    },
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
  const request = await loadPendingTrustDisbursementRequest(database, input.requestId);
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
  const request = await loadPendingTrustDisbursementRequest(database, input.requestId);
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
          transferId: null,
        }),
      ],
      outboxMessages: [],
    },
  };
}
