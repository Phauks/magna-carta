import type { EffectWrite, EffectStatement } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type {
  MatterId,
  TrustAccountId,
  TrustDisbursementDecisionId,
  TrustDisbursementRequestId,
  TrustLedgerNodeId,
  UserId,
} from "@magna-carta/identifiers/types";
import { readMatterClientEntityId } from "@magna-carta/matters/matter-party";
import { currencyFromCode, money } from "@magna-carta/money/money";
import { loadMatterTrustLeaf, loadTrustNode } from "@magna-carta/trust/account-tree";
import {
  readCurrentTrustAuthorizationPolicy,
  resolveTrustAuthorizationDisposition,
  type TrustAuthorizationDisposition,
} from "@magna-carta/trust/authorization-policy";
import {
  composeEarnedFeeApplicationApprovalDecision,
  composeEarnedFeeApplicationAuthorizationRequest,
  loadPendingTrustDisbursementRequest,
  resolveTrustAuthorizationApproval,
} from "@magna-carta/trust/disbursement-authorization";
import type { TrustDisbursementMethod } from "@magna-carta/trust/types";
import { applyTrustFundsToInvoices, type AppliedTrustFunds } from "./apply-trust-funds.ts";
import { BillingValidationError } from "./billing-validation.ts";
import { resolveEarnedFeeApplications, type EarnedFeeApplicationRequest } from "./earned-fee.ts";
import {
  insertInvoiceTrustApplicationLineStatement,
  readInvoiceTrustApplicationLines,
  type InvoiceTrustApplicationLineSnapshot,
} from "./statements.ts";
import type { BillingServiceOptions } from "./types.ts";

// THE PENDING EARNED-FEE APPLICATION — how a firm whose authorization policy requires a second
// person takes its earned fees, and the review step any firm may choose to use. The queue row is a
// trust_disbursement_request with kind 'earned_fee_application' (one approval queue, one decision
// discipline for every way money leaves a client ledger — trust owns that row and its triggers);
// billing's side is the invoice_trust_application_line rows recording WHICH invoices the amount
// settles, because that is a billing fact trust deliberately never learns.
//
// SUBMISSION VALIDATES, APPROVAL RE-VALIDATES. Submitting resolves every named invoice — finalized,
// this client's, this matter's, within the unpaid balance — so the submitter learns of a problem
// now rather than through an approver. The approval resolves all of it AGAIN, against the invoices
// and the ledger as they stand THEN, through the same `applyTrustFundsToInvoices` a direct
// application uses: there is no second posting path to keep in step with the first. A request
// overtaken by a payment, a credit note, or another transfer refuses at approval, naming what
// changed.
//
// REJECTION AND WITHDRAWAL need nothing from this module: they are kind-agnostic decisions on the
// shared queue row, composed by trust's own rejection and withdrawal composers.

export interface SubmitTrustApplicationRequestInput {
  readonly trustAccountId: TrustAccountId;
  // The matter whose client ledger the money would leave; whose money it is follows from this
  // matter's own client party, never from a client handle in the request.
  readonly matterId: MatterId;
  readonly applications: readonly EarnedFeeApplicationRequest[];
  readonly currency: string;
  readonly effectiveDate: string; // YYYY-MM-DD civil date
  readonly trustDescription: string;
  readonly operatingDescription: string;
  readonly method: TrustDisbursementMethod; // how the money will physically move to the firm
  readonly reference?: string | null;
  readonly payee: string; // the firm, as the client ledger will name it
  readonly purpose: string;
  readonly requestedBy: UserId;
}

export interface SubmittedTrustApplicationRequest {
  readonly requestId: TrustDisbursementRequestId;
  readonly nodeId: TrustLedgerNodeId;
  readonly totalMinor: number;
  readonly effect: EffectWrite;
}

export async function submitTrustApplicationRequest(
  database: SqlDatabase,
  input: SubmitTrustApplicationRequestInput,
  options: BillingServiceOptions,
): Promise<SubmittedTrustApplicationRequest> {
  // The same resolution the direct apply path runs, for the same reasons — see apply-trust-funds.ts
  // for why each piece is derived rather than accepted.
  const leaf = await loadMatterTrustLeaf(database, input.trustAccountId, input.matterId);
  const clientEntityId = await readMatterClientEntityId(database, input.matterId);
  if (!clientEntityId) {
    throw new BillingValidationError(
      "matter-has-no-client",
      `matter ${input.matterId} has no client party, so there is nobody whose bill this money could be paying: record the client on the matter first`,
    );
  }
  const resolution = await resolveEarnedFeeApplications(database, {
    nodeId: leaf.id,
    matterId: input.matterId,
    clientEntityId,
    currency: input.currency,
    applications: input.applications,
  });

  const request = await composeEarnedFeeApplicationAuthorizationRequest(
    database,
    {
      fromNodeId: leaf.id,
      amount: money(resolution.totalMinor, currencyFromCode(input.currency)),
      effectiveDate: input.effectiveDate,
      description: input.trustDescription,
      operatingDescription: input.operatingDescription,
      method: input.method,
      reference: input.reference ?? null,
      payee: input.payee,
      purpose: input.purpose,
      requestedBy: input.requestedBy,
    },
    options,
  );

  // The lines ride the request's own batch, so a proposal is never stored half-described. The
  // lines-sum trigger re-proves their total against the request at approval.
  const statements: EffectStatement[] = [...request.effect.statements];
  for (const application of resolution.applications) {
    statements.push(
      insertInvoiceTrustApplicationLineStatement(database, {
        id: newIdentifier("invoiceTrustApplicationLine", options.randomSource),
        requestId: request.requestId,
        invoiceId: application.invoiceId,
        amountMinor: application.amountMinor,
        currency: application.currency,
      }),
    );
  }

  return {
    requestId: request.requestId,
    nodeId: request.nodeId,
    totalMinor: resolution.totalMinor,
    effect: { statements, outboxMessages: [...request.effect.outboxMessages] },
  };
}

export type AppliedOrQueuedEarnedFees =
  | ({
      readonly outcome: "applied";
      readonly disposition: TrustAuthorizationDisposition;
    } & AppliedTrustFunds)
  | ({
      readonly outcome: "queued";
      readonly disposition: TrustAuthorizationDisposition;
    } & SubmittedTrustApplicationRequest);

// TAKING EARNED FEES, UNDER THE FIRM'S POSTURE — the one entrance, which decides for itself whether
// this member may take them now or has to ask.
//
// The choice is made from the SAME disposition the guards enforce, before anything is composed,
// rather than by attempting the direct application and catching its refusal. That refusal stays
// exactly where it is: `composeTrustToOperatingTransfer` is the last guard before a posting and must
// never turn into a route, or a composer meant to move money would start writing queue rows. What
// changes is only that the caller no longer walks into it — a member without the firm's authority
// raising fees for somebody else to release has done nothing wrong, and a refusal is the wrong face
// for an ordinary outcome.
//
// The invoice resolution runs here to learn the AMOUNT the authorization question is about — the
// same total the chosen path re-resolves and the trigger compares against the stamped threshold —
// and then again inside that path, against the invoices as they stand at composition. Two reads of
// the same rows, deliberately: the answer this function acts on must not become a fact the path it
// delegates to trusts instead of re-deriving.
export async function applyEarnedFeesUnderAuthorizationPolicy(
  database: SqlDatabase,
  input: SubmitTrustApplicationRequestInput,
  options: BillingServiceOptions,
): Promise<AppliedOrQueuedEarnedFees> {
  const leaf = await loadMatterTrustLeaf(database, input.trustAccountId, input.matterId);
  const clientEntityId = await readMatterClientEntityId(database, input.matterId);
  if (!clientEntityId) {
    throw new BillingValidationError(
      "matter-has-no-client",
      `matter ${input.matterId} has no client party, so there is nobody whose bill this money could be paying: record the client on the matter first`,
    );
  }
  const resolution = await resolveEarnedFeeApplications(database, {
    nodeId: leaf.id,
    matterId: input.matterId,
    clientEntityId,
    currency: input.currency,
    applications: input.applications,
  });

  const policy = await readCurrentTrustAuthorizationPolicy(database);
  const disposition = await resolveTrustAuthorizationDisposition(database, {
    policy,
    amountMinor: resolution.totalMinor,
    actor: input.requestedBy,
  });

  if (disposition.mode === "route") {
    const submitted = await submitTrustApplicationRequest(database, input, options);
    return { outcome: "queued", disposition, ...submitted };
  }

  const applied = await applyTrustFundsToInvoices(
    database,
    {
      trustAccountId: input.trustAccountId,
      matterId: input.matterId,
      applications: input.applications,
      currency: input.currency,
      effectiveDate: input.effectiveDate,
      trustDescription: input.trustDescription,
      operatingDescription: input.operatingDescription,
      appliedBy: input.requestedBy,
    },
    options,
  );
  return { outcome: "applied", disposition, ...applied };
}

export async function readTrustApplicationRequestLines(
  database: SqlDatabase,
  requestId: TrustDisbursementRequestId,
): Promise<readonly InvoiceTrustApplicationLineSnapshot[]> {
  return readInvoiceTrustApplicationLines(database, requestId);
}

export interface TrustApplicationApprovalInput {
  readonly requestId: TrustDisbursementRequestId;
  readonly approvedBy: UserId;
}

export interface ApprovedTrustApplication extends AppliedTrustFunds {
  readonly requestId: TrustDisbursementRequestId;
  readonly decisionId: TrustDisbursementDecisionId;
  readonly authorizationBasis: "second_person" | "sole_trust_manager" | "policy_exempt";
}

// Approval — the application flow's only path onto the ledger, and ONE batch end to end: trust's
// two linked entries and the transfer row, billing's application rows and balance deltas, and the
// decision that settles the queue row. The decision comes last so it names a transfer the same
// batch has already written; any trigger that refuses it — a second decision, a basis the stamped
// policy contradicts, a deciding member without required authority — takes the whole posting down
// with it.
export async function composeTrustApplicationApproval(
  database: SqlDatabase,
  input: TrustApplicationApprovalInput,
  options: BillingServiceOptions,
): Promise<ApprovedTrustApplication> {
  const request = await loadPendingTrustDisbursementRequest(database, input.requestId);
  if (request.kind !== "earned_fee_application") {
    throw new BillingValidationError(
      "request-not-an-earned-fee-application",
      `request ${request.id} is a trust disbursement to an external payee; approve it through the trust disbursement flow, which posts the movement it proposes`,
    );
  }
  if (request.operatingDescription === null) {
    // The kind-shape trigger makes this unrepresentable; refusing loudly beats inventing a
    // description for an operating ledger entry.
    throw new BillingValidationError(
      "application-request-malformed",
      `request ${request.id} carries no operating-leg description`,
    );
  }

  // On what footing this member may let this money go, under the policy STAMPED on the request —
  // trust's one answer for both kinds of request.
  const approval = await resolveTrustAuthorizationApproval(database, request, input.approvedBy);

  const lines = await readInvoiceTrustApplicationLines(database, request.id);
  if (lines.length === 0) {
    throw new BillingValidationError(
      "application-request-malformed",
      `request ${request.id} names no invoices; nothing states what the money would pay`,
    );
  }

  const node = await loadTrustNode(database, request.nodeId);
  if (node.matterId === null) {
    throw new BillingValidationError(
      "application-request-malformed",
      `request ${request.id} draws on ${request.nodeId}, which is not a matter leaf`,
    );
  }

  // The whole direct path, re-run NOW: invoice finality, client identity, matter share, unpaid
  // balance, the composition guard, the available-balance ceiling — none of it is trusted from
  // submission time.
  const applied = await applyTrustFundsToInvoices(
    database,
    {
      trustAccountId: request.trustAccountId,
      matterId: node.matterId,
      applications: lines.map((line) => ({
        invoiceId: line.invoiceId,
        amountMinor: line.amountMinor,
      })),
      currency: request.currency,
      effectiveDate: request.effectiveDate,
      trustDescription: request.description,
      operatingDescription: request.operatingDescription,
      appliedBy: request.requestedBy,
      authorizedBy: input.approvedBy,
      approvedRequest: { id: request.id, policyId: request.policyId },
    },
    options,
  );

  const decision = composeEarnedFeeApplicationApprovalDecision(
    database,
    {
      requestId: request.id,
      decidedBy: input.approvedBy,
      authorizationBasis: approval.authorizationBasis,
      transferId: applied.transferId,
    },
    options,
  );

  return {
    ...applied,
    requestId: request.id,
    decisionId: decision.decisionId,
    authorizationBasis: approval.authorizationBasis,
    effect: {
      statements: [...applied.effect.statements, ...decision.effect.statements],
      outboxMessages: [...applied.effect.outboxMessages, ...decision.effect.outboxMessages],
    },
  };
}
