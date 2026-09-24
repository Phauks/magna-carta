import { CIVIL_DATE_PATTERN, todayInUtc } from "@magna-carta/civil-time/civil-date";
import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import type { LocationId, MatterId, TrustAccountId, UserId } from "@magna-carta/identifiers/types";
import { isValidCalendarDate, LedgerValidationError } from "@magna-carta/ledger/validate";
import { selectLocationStatement } from "@magna-carta/locations/statements";
import { readMatterClientEntityId } from "@magna-carta/matters/matter-party";
import { currencyFromCode, money } from "@magna-carta/money/money";
import { timeZoneForLocation } from "@magna-carta/document-assembly/resolve";
import {
  listTrustAccounts,
  loadMatterTrustLeaf,
  openTrustAccount,
} from "@magna-carta/trust/account-tree";
import {
  composeTrustAuthorizationPolicyChange,
  readCurrentTrustAuthorizationPolicy,
  readTrustAuthorizationPolicyHistory,
} from "@magna-carta/trust/authorization-policy";
import {
  composeTrustDisbursementApproval,
  composeTrustDisbursementRejection,
  composeTrustDisbursementSubmission,
  composeTrustDisbursementWithdrawal,
  readPendingTrustDisbursementRequests,
} from "@magna-carta/trust/disbursement-authorization";
import { readTrustAvailableBalance } from "@magna-carta/trust/holds";
import {
  composeMatterToMatterTransfer,
  composeTrustDeposit,
  type ComposedTrustMovement,
  type TrustMovementOptions,
} from "@magna-carta/trust/movements";
import { selectTrustMovementsForNodeStatement } from "@magna-carta/trust/statements";
import { TrustValidationError } from "@magna-carta/trust/trust-validation";
import type { TrustDisbursementRequestSnapshot } from "@magna-carta/trust/types";
import type { Context } from "hono";
import type { Bindings } from "../../../bindings.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointIdempotency,
  requireChokepointUserId,
} from "../../chokepoint/context-accessors.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import {
  idempotencyKeyHeader,
  identifierField,
  identifierPathParam,
} from "../../contracts/common.ts";
import { cursorQuery, paginated } from "../../contracts/pagination.ts";
import { Problem, problemJson, type ProblemResponse } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";
import { problemResponseForIdempotencyConflict } from "../../idempotency-conflict-problems.ts";
import { problemResponseForLedgerRefusal } from "../../ledger-refusal-problems.ts";
import { problemResponseForTrustRefusal } from "../../trust-refusal-problems.ts";

// Trust movements: client money into a matter's trust ledger, out of it, and reallocated between two
// matters of one client. Every one of them is idempotency-REQUIRED, because a retried request that
// posted a second entry would be a second real movement of somebody else's money.
//
// Money going OUT is proposed on one endpoint and, when it needs somebody else, released on
// another. Which of the two happens is the FIRM'S posture, not this module's: a member holding the
// authority the firm requires releases an amount that takes no second person in the same atomic
// write as the proposal, and everybody else leaves a pending request the approval endpoint settles.
// This module never decides that — it asks @magna-carta/trust for the disposition and reports the
// answer, including WHO can approve when the caller cannot, so a member is never invited to attempt
// a decision the database is going to refuse.
//
// This module composes and commits; it decides nothing. The rules live one layer down in
// @magna-carta/trust, whose composition guard is the only supported way to build an entry touching
// client money, and one layer below that in the account_balance floor, which is what actually aborts
// an overdrawing batch. What belongs here is the mapping from a refusal to an HTTP status, and the
// resolution of names the domain will not invent for itself: which member is on the session, and
// what to call a ledger account the firm's chart of accounts has not been built to name yet.

const READ = "trust:read" as const;
const MANAGE = "trust:manage" as const;
// Changing the firm's money-movement posture is itself an act of authority over client money, so the
// policy write takes the authority capability rather than the bookkeeping one.
const AUTHORIZE = "trust:authorize" as const;

// The movement methods a client may state. `internal` is absent deliberately: it is what a
// matter-to-matter reallocation IS, set server-side, never a method a deposit or a disbursement may
// claim — the schema refuses it on either, and leaving it out of the contract means a caller never
// gets that far.
const BankMovementMethod = z.enum(["check", "cash", "wire", "electronic_transfer", "card"]);

// A real calendar date, not a shape. The bare regex accepts 2026-02-30 and next week alike, and both
// reach the ledger's own check as an error class this module does not map — so the member gets a 500
// for a typo. Refusing at the schema means the common cases never travel that far, and the ones that
// do (a backdated entry that is still in the future in UTC) surface as the 422 the contract declares.
const civilDate = z
  .string()
  .regex(CIVIL_DATE_PATTERN)
  .refine(isValidCalendarDate, { message: "not a calendar date" });

const DepositRequest = z
  .object({
    trustAccountId: identifierField("trustAccount"),
    // The matter, and nothing about the client. Whose money this is follows from the matter's own
    // client party — the link billing already resolves an invoice's client through — and is derived
    // server-side. A caller-supplied client handle was the answer to the question the sub-ledger
    // tree exists to ask, so naming another client's handle beside this matter was enough to file
    // this receipt on that client's ledger.
    matterId: identifierField("matter"),
    amountMinor: z.number().int().positive(),
    currency: z.literal("USD"),
    effectiveDate: civilDate,
    description: z.string().min(1),
    method: BankMovementMethod,
    reference: z.string().min(1).nullable().optional(),
    source: z.string().min(1),
    purpose: z.string().min(1),
  })
  .openapi("TrustDepositRequest");

const DisbursementRequestSubmission = z
  .object({
    trustAccountId: identifierField("trustAccount"),
    matterId: identifierField("matter"),
    amountMinor: z.number().int().positive(),
    currency: z.literal("USD"),
    effectiveDate: civilDate,
    description: z.string().min(1),
    method: BankMovementMethod,
    reference: z.string().min(1).nullable().optional(),
    payee: z.string().min(1),
    purpose: z.string().min(1),
  })
  .openapi("TrustDisbursementRequestSubmission");

const DisbursementRejection = z
  .object({
    // Required, and not defaulted: a refusal the submitter cannot answer is a refusal that costs
    // them a second round of guessing.
    reason: z.string().min(1),
  })
  .openapi("TrustDisbursementRejection");

const DisbursementWithdrawal = z
  .object({ reason: z.string().min(1).nullable().optional() })
  .openapi("TrustDisbursementWithdrawal");

const MatterTransferRequest = z
  .object({
    trustAccountId: identifierField("trustAccount"),
    fromMatterId: identifierField("matter"),
    // The destination matter, and nothing about its client. Each end's client is resolved from its
    // own matter, so a destination belonging to another client is refused by the one-client rule
    // against that matter's REAL client — rather than against a handle the caller chose to make the
    // two ends agree, which is how $5,000 of one client's money reached another client's matter.
    toMatterId: identifierField("matter"),
    amountMinor: z.number().int().positive(),
    currency: z.literal("USD"),
    effectiveDate: civilDate,
    description: z.string().min(1),
    purpose: z.string().min(1),
  })
  .openapi("TrustMatterTransferRequest");

const MovementAck = z
  .object({
    trustMovementId: z.string(),
    ledgerEntryId: z.string(),
    trustLedgerNodeId: z.string(),
    counterpartyTrustLedgerNodeId: z.string().nullable(),
  })
  .openapi("TrustMovementAck");

const AuthorizationBasis = z.enum(["second_person", "sole_trust_manager", "policy_exempt"]);

const MovementRecord = z
  .object({
    id: z.string(),
    kind: z.enum(["deposit", "disbursement", "matter_transfer"]),
    trustLedgerNodeId: z.string(),
    counterpartyTrustLedgerNodeId: z.string().nullable(),
    amountMinor: z.number().int(),
    currency: z.string(),
    ledgerEntryId: z.string(),
    method: z.enum(["check", "cash", "wire", "electronic_transfer", "card", "internal"]),
    reference: z.string().nullable(),
    counterpartyName: z.string().nullable(),
    purpose: z.string(),
    recordedBy: z.string(),
    authorizedBy: z.string().nullable(),
    // The disbursement request this movement was approved from, and on what footing. Present only on
    // a disbursement. `sole_trust_manager` says plainly that the firm had nobody else who could
    // approve and the submitter authorized their own payment; `policy_exempt` says the firm's
    // authorization policy did not require a second person for the amount — facts a reader must not
    // have to infer from noticing that two user handles match.
    disbursementRequestId: z.string().nullable(),
    authorizationBasis: AuthorizationBasis.nullable(),
    effectiveDate: z.string(),
    recordedAt: z.string(),
  })
  .openapi("TrustMovementRecord");

const PendingDisbursementRequest = z
  .object({
    id: z.string(),
    // What the approval will post: a `disbursement` pays an external payee and is approved on the
    // trust approval endpoint; an `earned_fee_application` pays the firm's own finalized invoices
    // and is approved on the billing application endpoint, which re-resolves its invoice lines.
    kind: z.enum(["disbursement", "earned_fee_application"]),
    trustLedgerNodeId: z.string(),
    amountMinor: z.number().int(),
    currency: z.string(),
    method: BankMovementMethod,
    reference: z.string().nullable(),
    payee: z.string(),
    purpose: z.string(),
    description: z.string(),
    effectiveDate: z.string(),
    requestedBy: z.string(),
    requestedAt: z.string(),
  })
  .openapi("TrustPendingDisbursementRequest");

const PendingDisbursementRequestsResponse = z
  .object({ requests: z.array(PendingDisbursementRequest) })
  .openapi("TrustPendingDisbursementRequestsResponse");

// A member the firm has given the authority to act on client money, named so a pending request can
// say who is able to settle it rather than only that somebody must.
const AuthorizedMember = z
  .object({ userId: z.string(), displayName: z.string() })
  .openapi("TrustAuthorizedMember");

// What became of a proposed payment. `approved` means the submitting member held the authority the
// firm requires and the amount needed no second person, so the payment was proposed and released in
// the same atomic write — the movement fields are then present. `pending` means somebody else has to
// settle it, and `eligibleApprovers` says who; nothing has reached the ledger.
const DisbursementRequestAck = z
  .object({
    trustDisbursementRequestId: z.string(),
    status: z.enum(["pending", "approved"]),
    authorizationBasis: AuthorizationBasis.nullable(),
    trustMovementId: z.string().nullable(),
    ledgerEntryId: z.string().nullable(),
    trustLedgerNodeId: z.string(),
    eligibleApprovers: z.array(AuthorizedMember),
  })
  .openapi("TrustDisbursementRequestAck");

const DisbursementApprovalAck = z
  .object({
    trustDisbursementRequestId: z.string(),
    authorizationBasis: AuthorizationBasis,
    trustMovementId: z.string(),
    ledgerEntryId: z.string(),
    trustLedgerNodeId: z.string(),
  })
  .openapi("TrustDisbursementApprovalAck");

const DisbursementDecisionAck = z
  .object({
    trustDisbursementRequestId: z.string(),
    decision: z.enum(["rejected", "withdrawn"]),
  })
  .openapi("TrustDisbursementDecisionAck");

// One version of the firm's disbursement-authorization posture. Version 0 with null id, setBy, and
// setAt is the shipped default — always two-person, no authority requirement — which stands until
// the firm writes a version.
const AuthorizationPolicyVersion = z
  .object({
    id: z.string().nullable(),
    version: z.number().int(),
    policy: z.enum(["off", "threshold", "always"]),
    thresholdAmountMinor: z.number().int().nullable(),
    requireAuthorizedApprover: z.boolean(),
    setBy: z.string().nullable(),
    setAt: z.string().nullable(),
  })
  .openapi("TrustAuthorizationPolicyVersion");

const AuthorizationPolicyResponse = z
  .object({
    current: AuthorizationPolicyVersion,
    // Every version the firm has written, newest first — who changed the posture, when, from what to
    // what. Empty while the shipped default stands.
    history: z.array(AuthorizationPolicyVersion),
  })
  .openapi("TrustAuthorizationPolicyResponse");

const AuthorizationPolicyChange = z
  .object({
    policy: z.enum(["off", "threshold", "always"]),
    // Required exactly when the posture is `threshold`: amounts strictly above it take a second
    // person, amounts at or below it do not.
    thresholdAmountMinor: z.number().int().nonnegative().nullable().optional(),
    requireAuthorizedApprover: z.boolean(),
  })
  .openapi("TrustAuthorizationPolicyChange");

const ClientLedgerResponse = z
  .object({
    trustLedgerNodeId: z.string(),
    balanceMinor: z.number().int(),
    heldMinor: z.number().int(),
    availableMinor: z.number().int(),
    movements: z.array(MovementRecord),
  })
  .openapi("TrustClientLedgerResponse");

const matterLedgerParam = z.object({ matterId: identifierPathParam("matter", "matterId") });
const matterLedgerQuery = z.object({ trustAccountId: identifierField("trustAccount") });
const disbursementRequestParam = z.object({
  requestId: identifierPathParam("trustDisbursementRequest", "requestId"),
});
const trustAccountQuery = z.object({ trustAccountId: identifierField("trustAccount") });

const errorResponses = {
  400: {
    description: "Missing Idempotency-Key (this operation requires one)",
    content: { "application/problem+json": { schema: Problem } },
  },
  401: {
    description: "No valid session",
    content: { "application/problem+json": { schema: Problem } },
  },
  403: {
    description: "The session member lacks the required capability",
    content: { "application/problem+json": { schema: Problem } },
  },
  404: {
    description:
      "The firm is unreachable, the member is deactivated, or the trust account or matter ledger is unknown",
    content: { "application/problem+json": { schema: Problem } },
  },
  409: {
    description:
      "A request with this Idempotency-Key is in progress, the movement exceeds the client ledger's available balance, or the disbursement request has already been decided",
    content: { "application/problem+json": { schema: Problem } },
  },
  422: {
    description:
      "The request is invalid, the Idempotency-Key was reused with a different payload, the trust rules refuse the movement, the account's jurisdiction cannot be resolved, or this member may not make this decision about this disbursement request",
    content: { "application/problem+json": { schema: Problem } },
  },
  429: {
    description: "Rate limit exceeded",
    content: { "application/problem+json": { schema: Problem } },
  },
} as const;

const readErrorResponses = {
  401: errorResponses[401],
  403: errorResponses[403],
  404: errorResponses[404],
  422: errorResponses[422],
  429: errorResponses[429],
} as const;

function movementMeta(operationId: string): RouteMeta {
  return {
    operationId,
    surface: "app",
    authenticated: true,
    permission: MANAGE,
    // A trust account belongs to an office and its ledger spans many matters, so the capability is
    // firm-scoped even though every movement names a matter.
    resource: "firm",
    audited: true,
    // Money moving is never replayable: a retried deposit that posted twice is a second real
    // movement of a client's funds.
    idempotency: "required",
    idempotencyStore: "firm",
    rateLimit: "default",
  };
}

const depositRoute = defineOpenAPIRoute(movementMeta("trust.deposit"), {
  method: "post",
  path: "/api/v1/trust/deposits",
  description:
    "Records client money received into a matter's trust ledger. The matter's ledger is created on its first deposit, together with its zero floor and this posting, in one atomic write. The deposit lands gross — a processor or bank fee can never be netted out of it.",
  request: {
    headers: idempotencyKeyHeader,
    body: { content: { "application/json": { schema: DepositRequest } }, required: true },
  },
  responses: {
    201: {
      description: "The deposit was recorded",
      content: { "application/json": { schema: MovementAck } },
    },
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
    409: errorResponses[409],
    422: errorResponses[422],
    429: errorResponses[429],
  },
});

const requestDisbursementRoute = defineOpenAPIRoute(movementMeta("trust.requestDisbursement"), {
  method: "post",
  path: "/api/v1/trust/disbursement-requests",
  description:
    "Proposes a payment of client money out of a matter's trust ledger, and — when the firm's posture lets this member release it alone — makes the payment in the same atomic write. The firm decides which: a member holding the authority to act on client money releases an amount that needs no second person by themselves, and the response says `approved` with the movement it posted; anybody else leaves a pending request that somebody who holds the authority has to approve, and the response says `pending`, names who can approve it, and moves no money at all — no ledger entry, no balance change, no movement record. Either way the proposal is checked against the ledger's AVAILABLE balance (the stored balance less any disputed-funds holds), and a request that stays pending is checked again when it is approved.",
  request: {
    headers: idempotencyKeyHeader,
    body: {
      content: { "application/json": { schema: DisbursementRequestSubmission } },
      required: true,
    },
  },
  responses: {
    201: {
      description:
        "The disbursement was released by the submitting member, or recorded and awaiting approval",
      content: { "application/json": { schema: DisbursementRequestAck } },
    },
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
    409: errorResponses[409],
    422: errorResponses[422],
    429: errorResponses[429],
  },
});

const approveDisbursementRoute = defineOpenAPIRoute(movementMeta("trust.approveDisbursement"), {
  method: "post",
  path: "/api/v1/trust/disbursement-requests/{requestId}/approval",
  description:
    "Approves a pending disbursement request and posts the trust movement, in one atomic write. The approving member must be somebody other than the member who submitted the request, and is recorded on the movement as the authorizing member; the submitter stays recorded as the member who entered the record. The available balance is measured again HERE, against the ledger as it stands now, so a request that has been overtaken by other activity is refused rather than posted.",
  request: {
    headers: idempotencyKeyHeader,
    params: disbursementRequestParam,
  },
  responses: {
    201: {
      description: "The disbursement was approved and the movement posted",
      content: { "application/json": { schema: DisbursementApprovalAck } },
    },
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
    409: errorResponses[409],
    422: errorResponses[422],
    429: errorResponses[429],
  },
});

const rejectDisbursementRoute = defineOpenAPIRoute(movementMeta("trust.rejectDisbursement"), {
  method: "post",
  path: "/api/v1/trust/disbursement-requests/{requestId}/rejection",
  description:
    "Refuses a pending disbursement request, recording who refused it and why. Nothing reaches the ledger. The refusing member must be somebody other than the one who submitted it — taking back your own request is a withdrawal.",
  request: {
    headers: idempotencyKeyHeader,
    params: disbursementRequestParam,
    body: { content: { "application/json": { schema: DisbursementRejection } }, required: true },
  },
  responses: {
    201: {
      description: "The rejection was recorded",
      content: { "application/json": { schema: DisbursementDecisionAck } },
    },
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
    409: errorResponses[409],
    422: errorResponses[422],
    429: errorResponses[429],
  },
});

const withdrawDisbursementRoute = defineOpenAPIRoute(movementMeta("trust.withdrawDisbursement"), {
  method: "post",
  path: "/api/v1/trust/disbursement-requests/{requestId}/withdrawal",
  description:
    "Takes back a pending disbursement request the calling member submitted. Recorded rather than deleted — that a payment was proposed and then withdrawn is itself part of the record. Only the submitting member may withdraw; anyone else records a rejection with a reason.",
  request: {
    headers: idempotencyKeyHeader,
    params: disbursementRequestParam,
    body: { content: { "application/json": { schema: DisbursementWithdrawal } }, required: true },
  },
  responses: {
    201: {
      description: "The withdrawal was recorded",
      content: { "application/json": { schema: DisbursementDecisionAck } },
    },
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
    409: errorResponses[409],
    422: errorResponses[422],
    429: errorResponses[429],
  },
});

// One of the firm's trust accounts as a person picks it: the label the firm gave it, the office, the
// bank and the last four of the number. Nothing a movement needs, and no full account number — the
// schema stores none, so there is none to serve.
const TrustAccountListing = z
  .object({
    id: z.string(),
    name: z.string(),
    locationId: z.string(),
    jurisdiction: z.string().nullable(),
    bankName: z.string().nullable(),
    accountNumberLastFour: z.string().nullable(),
    currency: z.string(),
    iolta: z.boolean(),
    status: z.enum(["open", "closed"]),
    openedOn: z.string(),
    closedAt: z.string().nullable(),
    // The holding office's IANA time zone, resolved: an office recorded before the column existed
    // reads as the platform's normalized zone rather than as nothing. A report asked "as at the end
    // of a day" resolves that day here.
    timeZone: z.string(),
  })
  .openapi("TrustAccountListing");

const TrustAccountPage = paginated(TrustAccountListing).openapi("TrustAccountPage");

const listTrustAccountsRoute = defineOpenAPIRoute(
  {
    operationId: "trust.listTrustAccounts",
    surface: "app",
    authenticated: true,
    permission: READ,
    resource: "firm",
    audited: false,
    idempotency: "optional",
    rateLimit: "default",
  },
  {
    method: "get",
    path: "/api/v1/trust/accounts",
    description:
      "Lists the firm's trust accounts alphabetically by the name the firm gave each one, closed accounts included: a compliance report is asked about the period an account was live, which is often after it closed, and a listing that hid closed accounts would make that report impossible to ask for. Cursor-paginated. Each row carries the identity a person picks an account by and the last four digits of its number, which is all the platform stores of it.",
    request: { query: cursorQuery },
    responses: {
      200: {
        description: "One page of the firm's trust accounts",
        content: { "application/json": { schema: TrustAccountPage } },
      },
      401: readErrorResponses[401],
      403: readErrorResponses[403],
      404: readErrorResponses[404],
      429: readErrorResponses[429],
    },
  },
);

// What a firm states to open a trust account. The jurisdiction is deliberately absent: it is the
// holding office's, read from the office row, never chosen here.
const TrustAccountOpening = z
  .object({
    name: z.string().min(1),
    locationId: identifierField("location"),
    bankName: z.string().min(1).nullable().optional(),
    // The last four digits, and there is no field for the rest: the schema has no column for a full
    // account number, so the last four is the whole of what the platform ever holds.
    accountNumberLastFour: z
      .string()
      .regex(/^\d{4}$/)
      .nullable()
      .optional(),
    // Absent means pooled interest-bearing, which is what a firm's ordinary client trust account is.
    iolta: z.boolean().optional(),
    openedOn: civilDate,
    currency: z.literal("USD"),
  })
  .openapi("TrustAccountOpening");

const openTrustAccountRoute = defineOpenAPIRoute(
  {
    operationId: "trust.openAccount",
    surface: "app",
    authenticated: true,
    permission: MANAGE,
    // A trust account belongs to an office and its ledger spans many matters, so the capability is
    // firm-scoped.
    resource: "firm",
    audited: true,
    // A retried open that opened a second account would leave the firm holding two accounts where it
    // asked for one, and a trust account cannot simply be deleted once it exists.
    idempotency: "required",
    idempotencyStore: "firm",
    rateLimit: "default",
  },
  {
    method: "post",
    path: "/api/v1/trust/accounts",
    description:
      "Opens a trust account and binds it to one of the firm's offices. The jurisdiction is the office's own and is never chosen here, because the rules require a trust account to sit in the state of the lawyer's office — naming it separately would be a second answer to a question the office already settles. An office that has no jurisdiction recorded still opens an account, and every movement on that account is refused until the office records one, so recording the office's state is what makes the account usable rather than something to redo here. Only the last four digits of the bank account number are taken, because that is all the platform stores of it. The account is pooled interest-bearing unless the firm says otherwise. A retried open returns the account the first call opened rather than opening a second one, which is why the idempotency key is required.",
    request: {
      headers: idempotencyKeyHeader,
      body: { content: { "application/json": { schema: TrustAccountOpening } }, required: true },
    },
    responses: {
      201: {
        description: "The trust account is open",
        content: { "application/json": { schema: TrustAccountListing } },
      },
      400: errorResponses[400],
      401: errorResponses[401],
      403: errorResponses[403],
      404: errorResponses[404],
      409: errorResponses[409],
      422: errorResponses[422],
      429: errorResponses[429],
    },
  },
);

const pendingDisbursementRequestsRoute = defineOpenAPIRoute(
  {
    operationId: "trust.listDisbursementRequests",
    surface: "app",
    authenticated: true,
    permission: READ,
    resource: "firm",
    audited: false,
    idempotency: "optional",
    rateLimit: "default",
  },
  {
    method: "get",
    path: "/api/v1/trust/disbursement-requests",
    description:
      "Lists the disbursement requests on one trust account that nobody has decided yet, oldest first — the queue an approving member works from. A request leaves this list the moment it is approved, rejected, or withdrawn.",
    request: { query: trustAccountQuery },
    responses: {
      200: {
        description: "The pending disbursement requests",
        content: { "application/json": { schema: PendingDisbursementRequestsResponse } },
      },
      401: readErrorResponses[401],
      403: readErrorResponses[403],
      404: readErrorResponses[404],
      422: readErrorResponses[422],
      429: readErrorResponses[429],
    },
  },
);

const readAuthorizationPolicyRoute = defineOpenAPIRoute(
  {
    operationId: "trust.readAuthorizationPolicy",
    surface: "app",
    authenticated: true,
    permission: READ,
    resource: "firm",
    audited: false,
    idempotency: "optional",
    rateLimit: "default",
  },
  {
    method: "get",
    path: "/api/v1/trust/authorization-policy",
    description:
      "Returns the firm's disbursement-authorization posture — whether money leaving a client ledger takes a second person (off, above a threshold amount, or always) and whether whoever authorizes it must hold the authority capability — together with every version the firm has ever written. A firm that has never written one has the shipped default: always two-person, no authority requirement.",
    responses: {
      200: {
        description: "The firm's authorization policy, current and history",
        content: { "application/json": { schema: AuthorizationPolicyResponse } },
      },
      401: readErrorResponses[401],
      403: readErrorResponses[403],
      404: readErrorResponses[404],
      422: readErrorResponses[422],
      429: readErrorResponses[429],
    },
  },
);

const changeAuthorizationPolicyRoute = defineOpenAPIRoute(
  {
    operationId: "trust.changeAuthorizationPolicy",
    surface: "app",
    authenticated: true,
    permission: AUTHORIZE,
    resource: "firm",
    audited: true,
    // Replaying a posture change must not write a second version, and a concurrent change must lose
    // loudly rather than interleave.
    idempotency: "required",
    idempotencyStore: "firm",
    rateLimit: "default",
  },
  {
    method: "put",
    path: "/api/v1/trust/authorization-policy",
    description:
      "Changes the firm's disbursement-authorization posture, as a new immutable version recording who changed it, when, and from what. The change governs NEW authorizations only: a request already pending keeps the policy version it was submitted under, in both directions. Requires the authority capability — relaxing how the firm's client money moves is itself an act of authority over it.",
    request: {
      headers: idempotencyKeyHeader,
      body: {
        content: { "application/json": { schema: AuthorizationPolicyChange } },
        required: true,
      },
    },
    responses: {
      201: {
        description: "The new policy version is in force for new authorizations",
        content: { "application/json": { schema: AuthorizationPolicyVersion } },
      },
      400: errorResponses[400],
      401: errorResponses[401],
      403: errorResponses[403],
      404: errorResponses[404],
      409: errorResponses[409],
      422: errorResponses[422],
      429: errorResponses[429],
    },
  },
);

const matterTransferRoute = defineOpenAPIRoute(movementMeta("trust.transferBetweenMatters"), {
  method: "post",
  path: "/api/v1/trust/matter-transfers",
  description:
    "Moves trust funds between two matters of the SAME client. No bank movement happens, so no bank line is posted and no reconciliation item is created. A destination matter belonging to a different client is refused.",
  request: {
    headers: idempotencyKeyHeader,
    body: { content: { "application/json": { schema: MatterTransferRequest } }, required: true },
  },
  responses: {
    201: {
      description: "The transfer was recorded",
      content: { "application/json": { schema: MovementAck } },
    },
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
    409: errorResponses[409],
    422: errorResponses[422],
    429: errorResponses[429],
  },
});

const clientLedgerRoute = defineOpenAPIRoute(
  {
    operationId: "trust.matterLedger",
    surface: "app",
    authenticated: true,
    permission: READ,
    resource: "firm",
    audited: false,
    idempotency: "optional",
    rateLimit: "default",
  },
  {
    method: "get",
    path: "/api/v1/trust/matters/{matterId}/ledger",
    description:
      "Returns one matter's trust ledger: its stored balance, the amount under disputed-funds holds, what is available, and every movement that touched it in effective-date order. A transfer between two matters appears on both.",
    request: { params: matterLedgerParam, query: matterLedgerQuery },
    responses: {
      200: {
        description: "The matter's trust ledger",
        content: { "application/json": { schema: ClientLedgerResponse } },
      },
      401: readErrorResponses[401],
      403: readErrorResponses[403],
      404: readErrorResponses[404],
      422: readErrorResponses[422],
      429: readErrorResponses[429],
    },
  },
);

// A refusal's HTTP status is a property of what the refusal MEANS, so the mapping lives in ONE
// place — src/http/trust-refusal-problems.ts — rather than at the call sites that would drift. Billing's
// apply-funds route composes trust's transfer through trust's own composer and inherits every one of
// these refusals, so the mapping is shared with it rather than copied.
const trustErrorResponse = problemResponseForTrustRefusal;

type TrustApp = OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>;

interface MatterNamingRow {
  title: string;
  matter_number: string | null;
  client_display_name: string | null;
}

// Trust does not own the firm's chart of accounts and invents no numbering scheme, so the names for
// a lazily created client node and matter leaf are resolved here, from the matter the firm already
// named. A matter without a number is named by its handle — a ledger account has to be identifiable
// on a report from the day it exists, and a matter draws its number only when it opens.
async function resolveLeafNames(
  database: SqlDatabase,
  matterId: MatterId,
): Promise<{ clientNodeName: string; matterLeafName: string }> {
  // `.all()` + `results[0]`, never `.first()` — the node-sqlite adapter the fixtures run on has no
  // `.first()`, so the whole platform reads this way.
  const { results } = await database
    .prepare("SELECT title, matter_number, client_display_name FROM matter WHERE id = ?1")
    .bind(matterId)
    .all<MatterNamingRow>();
  const row = results[0];
  if (!row) {
    // Raised as a trust refusal so it travels the same path to a 404 as every other unknown handle
    // on these routes; the detail names the matter, so the code's vocabulary never reaches a client.
    // Without it the movement would fail later on the node's foreign key, as an opaque batch abort.
    throw new TrustValidationError("unknown-trust-node", `no such matter: ${matterId}`);
  }
  // The display name is what a person reads on a report. When the matter carries none, the account
  // falls back to the client's Directory handle — resolved from the matter's client party, the same
  // link the ledger's attribution comes from, so the name on the account and the client the account
  // belongs to can never name two different entities.
  const clientNodeLabel =
    row.client_display_name ?? (await readMatterClientEntityId(database, matterId)) ?? matterId;
  return {
    clientNodeName: `Trust — ${clientNodeLabel}`,
    matterLeafName: `Trust — ${row.matter_number ?? matterId} — ${row.title}`,
  };
}

interface TrustAccountOfficeRow {
  jurisdiction: string | null;
  time_zone: string | null;
}

interface TrustAccountOffice {
  readonly jurisdiction: string | null;
  readonly timeZone: string | null;
}

// The office a trust account is bound to, read for the two facts opening one takes from it: the
// jurisdiction the account sits in, which the law fixes to the office rather than leaving to a
// choice, and the zone in which a day on that account resolves. Undefined when this firm has no such
// office — there is then nothing to bind the account to and nothing to take a jurisdiction from.
async function readTrustAccountOffice(
  database: SqlDatabase,
  locationId: LocationId,
): Promise<TrustAccountOffice | undefined> {
  // `.all()` + `results[0]`, never `.first()` — the platform's one-row read convention.
  const { results } = await selectLocationStatement(
    database,
    locationId,
  ).all<TrustAccountOfficeRow>();
  const row = results[0];
  if (!row) return undefined;
  return { jurisdiction: row.jurisdiction, timeZone: row.time_zone };
}

interface MovementRow {
  id: string;
  kind: "deposit" | "disbursement" | "matter_transfer";
  node_id: string;
  counterparty_node_id: string | null;
  amount_minor: number;
  currency: string;
  entry_id: string;
  method: "check" | "cash" | "wire" | "electronic_transfer" | "card" | "internal";
  reference: string | null;
  counterparty_name: string | null;
  purpose: string;
  recorded_by: string;
  authorized_by: string | null;
  disbursement_request_id: string | null;
  authorization_basis: "second_person" | "sole_trust_manager" | "policy_exempt" | null;
  effective_date: string;
  recorded_at: string;
}

function rowToMovement(row: MovementRow): z.infer<typeof MovementRecord> {
  return {
    id: row.id,
    kind: row.kind,
    trustLedgerNodeId: row.node_id,
    counterpartyTrustLedgerNodeId: row.counterparty_node_id,
    amountMinor: row.amount_minor,
    currency: row.currency,
    ledgerEntryId: row.entry_id,
    method: row.method,
    reference: row.reference,
    counterpartyName: row.counterparty_name,
    purpose: row.purpose,
    recordedBy: row.recorded_by,
    authorizedBy: row.authorized_by,
    disbursementRequestId: row.disbursement_request_id,
    authorizationBasis: row.authorization_basis,
    effectiveDate: row.effective_date,
    recordedAt: row.recorded_at,
  };
}

function toPendingRequest(
  request: TrustDisbursementRequestSnapshot,
): z.infer<typeof PendingDisbursementRequest> {
  return {
    id: request.id,
    kind: request.kind,
    trustLedgerNodeId: request.nodeId,
    amountMinor: request.amountMinor,
    currency: request.currency,
    method: request.method,
    reference: request.reference,
    payee: request.payee,
    purpose: request.purpose,
    description: request.description,
    effectiveDate: request.effectiveDate,
    requestedBy: request.requestedBy,
    requestedAt: request.requestedAt,
  };
}

export function registerTrustRoutes(app: TrustApp, chokepoint: Chokepoint): void {
  // The shared idempotent commit for a movement: one batch carrying the ledger entry, its lines,
  // the balance updates, the movement record, the idempotency record, and the outbox message. The
  // account_balance floor aborts all of it together on an overdraw, which is exactly the atomicity
  // the no-negative guarantee depends on.
  async function commitTrustWrite<Body>(
    c: Context,
    compose: (actor: UserId) => Promise<{ write: EffectWrite; body: Body }>,
  ) {
    const firm = requireChokepointFirmContext(c);
    const userId = requireChokepointUserId(c);
    const idempotency = requireChokepointIdempotency(c);
    const now = () => new Date().toISOString();
    let result;
    try {
      result = await runIdempotentEffect({
        database: firm.firmDatabase,
        key: idempotency.key,
        fingerprint: idempotency.fingerprint,
        now,
        effect: async () => {
          const composed = await compose(userId);
          return {
            write: composed.write,
            responseCode: 201,
            responseBody: canonicalJsonStringify(composed.body),
          };
        },
      });
    } catch (caught) {
      if (caught instanceof TrustValidationError) return trustErrorResponse(c, caught);
      // The ledger refuses on its own terms too, and its refusals are ordinary bad input on these
      // routes — a future effective date, a date that is not a date. They are a different error
      // class from the trust package's, so without this arm they reach the app's error boundary and
      // a member gets a 500 with an Error ID for a typo.
      if (caught instanceof LedgerValidationError)
        return problemResponseForLedgerRefusal(c, caught);
      throw caught;
    }
    if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch")
      return problemResponseForIdempotencyConflict(c, result);
    if (result.kind === "replayed") c.header("Idempotency-Replayed", "true");
    return c.json(JSON.parse(result.responseBody ?? "{}") as Body, 201);
  }

  const commitMovement = (
    c: Context,
    compose: (recordedBy: UserId) => Promise<ComposedTrustMovement>,
  ) =>
    commitTrustWrite<z.infer<typeof MovementAck>>(c, async (recordedBy) => {
      const movement = await compose(recordedBy);
      return {
        write: movement.effect satisfies EffectWrite,
        body: {
          trustMovementId: movement.movementId,
          ledgerEntryId: movement.entryId,
          trustLedgerNodeId: movement.nodeId,
          counterpartyTrustLedgerNodeId: movement.counterpartyNodeId,
        },
      };
    });

  // POST /api/v1/trust/deposits — client money in
  app.openapi(
    { ...depositRoute, middleware: chokepointMiddleware(chokepoint, depositRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const request = c.req.valid("json");
      return commitMovement(c, async (recordedBy) => {
        const names = await resolveLeafNames(firm.firmDatabase, request.matterId);
        return composeTrustDeposit(
          firm.firmDatabase,
          {
            trustAccountId: request.trustAccountId,
            to: {
              matterId: request.matterId,
              ...names,
            },
            amount: money(request.amountMinor, currencyFromCode(request.currency)),
            effectiveDate: request.effectiveDate,
            description: request.description,
            method: request.method,
            reference: request.reference ?? null,
            source: request.source,
            purpose: request.purpose,
            recordedBy,
          },
          trustOptions(),
        );
      });
    },
  );

  // POST /api/v1/trust/disbursement-requests — propose a payment; NOTHING moves yet
  app.openapi(
    {
      ...requestDisbursementRoute,
      middleware: chokepointMiddleware(chokepoint, requestDisbursementRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const request = c.req.valid("json");
      return commitTrustWrite<z.infer<typeof DisbursementRequestAck>>(c, async (requestedBy) => {
        const node = await loadMatterTrustLeaf(
          firm.firmDatabase,
          request.trustAccountId,
          request.matterId,
        );
        const composed = await composeTrustDisbursementSubmission(
          firm.firmDatabase,
          {
            fromNodeId: node.id,
            amount: money(request.amountMinor, currencyFromCode(request.currency)),
            effectiveDate: request.effectiveDate,
            description: request.description,
            method: request.method,
            reference: request.reference ?? null,
            payee: request.payee,
            purpose: request.purpose,
            requestedBy,
          },
          trustOptions(),
        );
        return {
          write: composed.effect,
          body: {
            trustDisbursementRequestId: composed.requestId,
            status: composed.released ? ("approved" as const) : ("pending" as const),
            authorizationBasis: composed.released?.authorizationBasis ?? null,
            trustMovementId: composed.released?.movement.movementId ?? null,
            ledgerEntryId: composed.released?.movement.entryId ?? null,
            trustLedgerNodeId: composed.nodeId,
            // Who can settle it if this member could not. Empty on a release, because nobody is
            // waiting on anybody.
            eligibleApprovers: composed.disposition.eligibleApprovers.map((approver) => ({
              userId: approver.userId,
              displayName: approver.displayName,
            })),
          },
        };
      });
    },
  );

  // POST /api/v1/trust/disbursement-requests/{requestId}/approval — the second person, and the
  // only path on which client money actually leaves
  app.openapi(
    {
      ...approveDisbursementRoute,
      middleware: chokepointMiddleware(chokepoint, approveDisbursementRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { requestId } = c.req.valid("param");
      return commitTrustWrite<z.infer<typeof DisbursementApprovalAck>>(c, async (approvedBy) => {
        const approved = await composeTrustDisbursementApproval(
          firm.firmDatabase,
          { requestId, approvedBy },
          trustOptions(),
        );
        return {
          write: approved.effect,
          body: {
            trustDisbursementRequestId: approved.requestId,
            authorizationBasis: approved.authorizationBasis,
            trustMovementId: approved.movement.movementId,
            ledgerEntryId: approved.movement.entryId,
            trustLedgerNodeId: approved.movement.nodeId,
          },
        };
      });
    },
  );

  // POST /api/v1/trust/disbursement-requests/{requestId}/rejection — refused, and why
  app.openapi(
    {
      ...rejectDisbursementRoute,
      middleware: chokepointMiddleware(chokepoint, rejectDisbursementRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { requestId } = c.req.valid("param");
      const { reason } = c.req.valid("json");
      return commitTrustWrite<z.infer<typeof DisbursementDecisionAck>>(c, async (rejectedBy) => {
        const settled = await composeTrustDisbursementRejection(
          firm.firmDatabase,
          { requestId, rejectedBy, reason },
          trustOptions(),
        );
        return {
          write: settled.effect,
          body: {
            trustDisbursementRequestId: settled.requestId,
            decision: "rejected" as const,
          },
        };
      });
    },
  );

  // POST /api/v1/trust/disbursement-requests/{requestId}/withdrawal — the submitter's own retraction
  app.openapi(
    {
      ...withdrawDisbursementRoute,
      middleware: chokepointMiddleware(chokepoint, withdrawDisbursementRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { requestId } = c.req.valid("param");
      const { reason } = c.req.valid("json");
      return commitTrustWrite<z.infer<typeof DisbursementDecisionAck>>(c, async (withdrawnBy) => {
        const settled = await composeTrustDisbursementWithdrawal(
          firm.firmDatabase,
          { requestId, withdrawnBy, reason: reason ?? null },
          trustOptions(),
        );
        return {
          write: settled.effect,
          body: {
            trustDisbursementRequestId: settled.requestId,
            decision: "withdrawn" as const,
          },
        };
      });
    },
  );

  // GET /api/v1/trust/accounts — the firm's trust accounts, for anything that has to name one
  app.openapi(
    {
      ...listTrustAccountsRoute,
      middleware: chokepointMiddleware(chokepoint, listTrustAccountsRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { cursor } = c.req.valid("query");
      const page = await listTrustAccounts(
        firm.firmDatabase,
        cursor === undefined ? {} : { cursor },
      );
      return c.json(
        {
          data: page.data.map(({ locationTimeZone, ...account }) => ({
            ...account,
            timeZone: timeZoneForLocation({ timeZone: locationTimeZone }),
          })),
          nextCursor: page.nextCursor,
        },
        200,
      );
    },
  );

  // POST /api/v1/trust/accounts — a new trust account, bound to the office it takes its rules from
  app.openapi(
    {
      ...openTrustAccountRoute,
      middleware: chokepointMiddleware(chokepoint, openTrustAccountRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const request = c.req.valid("json");
      // Read outside the idempotent effect: an office the firm does not have is a fact about the
      // request, not a refusal the trust rules raise, and it must not be recorded as the settled
      // outcome of this key.
      const office = await readTrustAccountOffice(firm.firmDatabase, request.locationId);
      if (office === undefined) {
        return problemJson(c, {
          type: "not-found",
          title: "Not found",
          status: 404,
          detail: `no such office: ${request.locationId}`,
        });
      }
      return commitTrustWrite<z.infer<typeof TrustAccountListing>>(c, async () => {
        const opened = await openTrustAccount(
          firm.firmDatabase,
          {
            name: request.name,
            locationId: request.locationId,
            // The office's, always. An office with none recorded opens an account that refuses every
            // movement until it has one — which is the honest state, and better than a baseline
            // jurisdiction nobody chose.
            jurisdiction: office.jurisdiction,
            currency: request.currency,
            bankName: request.bankName ?? null,
            accountNumberLastFour: request.accountNumberLastFour ?? null,
            iolta: request.iolta,
            openedOn: request.openedOn,
          },
          trustOptions(),
        );
        return {
          write: opened.effect,
          // The row exactly as the listing serves one, so a caller that just opened an account and a
          // caller that listed them are reading the same shape.
          body: {
            id: opened.trustAccountId,
            name: request.name,
            locationId: request.locationId,
            jurisdiction: office.jurisdiction,
            bankName: request.bankName ?? null,
            accountNumberLastFour: request.accountNumberLastFour ?? null,
            currency: request.currency,
            iolta: request.iolta !== false,
            status: "open" as const,
            openedOn: request.openedOn,
            closedAt: null,
            timeZone: timeZoneForLocation({ timeZone: office.timeZone }),
          },
        };
      });
    },
  );

  // GET /api/v1/trust/disbursement-requests — the approval queue
  app.openapi(
    {
      ...pendingDisbursementRequestsRoute,
      middleware: chokepointMiddleware(chokepoint, pendingDisbursementRequestsRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { trustAccountId } = c.req.valid("query");
      const pending = await readPendingTrustDisbursementRequests(
        firm.firmDatabase,
        trustAccountId as TrustAccountId,
      );
      return c.json({ requests: pending.map(toPendingRequest) }, 200);
    },
  );

  // GET /api/v1/trust/authorization-policy — the firm's posture, current and history
  app.openapi(
    {
      ...readAuthorizationPolicyRoute,
      middleware: chokepointMiddleware(chokepoint, readAuthorizationPolicyRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const current = await readCurrentTrustAuthorizationPolicy(firm.firmDatabase);
      const history = await readTrustAuthorizationPolicyHistory(firm.firmDatabase);
      return c.json({ current, history: [...history] }, 200);
    },
  );

  // PUT /api/v1/trust/authorization-policy — a new immutable version of the posture
  app.openapi(
    {
      ...changeAuthorizationPolicyRoute,
      middleware: chokepointMiddleware(chokepoint, changeAuthorizationPolicyRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const request = c.req.valid("json");
      return commitTrustWrite<z.infer<typeof AuthorizationPolicyVersion>>(c, async (setBy) => {
        const change = await composeTrustAuthorizationPolicyChange(
          firm.firmDatabase,
          {
            policy: request.policy,
            thresholdAmountMinor: request.thresholdAmountMinor ?? null,
            requireAuthorizedApprover: request.requireAuthorizedApprover,
            setBy,
          },
          trustOptions(),
        );
        return {
          write: change.effect,
          body: {
            id: change.policyId,
            version: change.version,
            policy: request.policy,
            thresholdAmountMinor: request.thresholdAmountMinor ?? null,
            requireAuthorizedApprover: request.requireAuthorizedApprover,
            setBy,
            setAt: change.setAt,
          },
        };
      });
    },
  );

  // POST /api/v1/trust/matter-transfers — a reallocation inside one client's funds
  app.openapi(
    { ...matterTransferRoute, middleware: chokepointMiddleware(chokepoint, matterTransferRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const request = c.req.valid("json");
      return commitMovement(c, async (recordedBy) => {
        const from = await loadMatterTrustLeaf(
          firm.firmDatabase,
          request.trustAccountId,
          request.fromMatterId,
        );
        const names = await resolveLeafNames(firm.firmDatabase, request.toMatterId);
        return composeMatterToMatterTransfer(
          firm.firmDatabase,
          {
            fromNodeId: from.id,
            to: {
              matterId: request.toMatterId,
              ...names,
            },
            amount: money(request.amountMinor, currencyFromCode(request.currency)),
            effectiveDate: request.effectiveDate,
            description: request.description,
            purpose: request.purpose,
            recordedBy,
            authorizedBy: recordedBy,
          },
          trustOptions(),
        );
      });
    },
  );

  // GET /api/v1/trust/matters/{matterId}/ledger — the client ledger the record-keeping rules name
  app.openapi(
    { ...clientLedgerRoute, middleware: chokepointMiddleware(chokepoint, clientLedgerRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { matterId } = c.req.valid("param");
      const { trustAccountId } = c.req.valid("query");
      // The only refusal a read can raise is "this matter holds no trust ledger", which is a 404 —
      // spelled out here rather than routed through the write-path mapping, whose other statuses
      // this route does not declare and could not honestly return.
      let node;
      try {
        node = await loadMatterTrustLeaf(
          firm.firmDatabase,
          trustAccountId as TrustAccountId,
          matterId,
        );
      } catch (caught) {
        if (caught instanceof TrustValidationError) {
          return problemJson(c, {
            type: "not-found",
            title: "Not found",
            status: 404,
            detail: caught.message,
          });
        }
        throw caught;
      }
      const balance = await readTrustAvailableBalance(firm.firmDatabase, node.id);
      const { results } = await selectTrustMovementsForNodeStatement(
        firm.firmDatabase,
        node.id,
      ).all<MovementRow>();
      return c.json(
        {
          trustLedgerNodeId: node.id,
          balanceMinor: balance.balanceMinor,
          heldMinor: balance.heldMinor,
          availableMinor: balance.availableMinor,
          movements: results.map(rowToMovement),
        },
        200,
      );
    },
  );
}

// The ledger's future-dating check compares against a civil date. The Worker has no user time zone
// on a request, so UTC is the resolution — and it is the same resolution the rest of the platform
// uses for a server-side "today".

// The trust package reads no wall clock of its own, so every composer takes one. Built per request
// rather than once at module scope so a long-lived isolate cannot freeze "now".
const trustOptions = (): TrustMovementOptions => ({
  clock: { now: () => new Date().toISOString(), today: todayInUtc },
});
