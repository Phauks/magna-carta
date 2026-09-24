import { CIVIL_DATE_PATTERN, todayInUtc } from "@magna-carta/civil-time/civil-date";
import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import type { UserId } from "@magna-carta/identifiers/types";
import { isValidCalendarDate, LedgerValidationError } from "@magna-carta/ledger/validate";
import { loadMatterTrustLeaf } from "@magna-carta/trust/account-tree";
import { TrustValidationError } from "@magna-carta/trust/trust-validation";
import type {
  TrustDormantBalance,
  TrustUnclaimedFundsReviewSnapshot,
} from "@magna-carta/trust/types";
import {
  composeTrustUnclaimedFundsContactAttempt,
  composeTrustUnclaimedFundsReview,
  composeTrustUnclaimedFundsReviewClosure,
  readDormantTrustBalances,
  readTrustUnclaimedFundsReview,
} from "@magna-carta/trust/unclaimed-funds";
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
import { Problem, problemJson, type ProblemResponse } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";
import { problemResponseForIdempotencyConflict } from "../../idempotency-conflict-problems.ts";
import { problemResponseForLedgerRefusal } from "../../ledger-refusal-problems.ts";

// UNCLAIMED CLIENT FUNDS — a read and an evidence trail. NOTHING ON THIS SURFACE MOVES MONEY.
//
// A firm holding money for somebody it can no longer reach has a continuing duty to make reasonable
// efforts to locate the owner and distribute the funds, and to be able to evidence both afterwards.
// The evidence is what a platform can genuinely hold — attempt by attempt, at the time, in a form
// nobody can reconstruct two years later — and these routes are the surface over it.
//
// THREE THINGS THIS SURFACE DELIBERATELY IS NOT, each of which a route layer is the likeliest place
// to undo:
//
//   1. IT IS NOT A DEADLINE. In the jurisdiction researched for this subsystem a designated client
//      trust account is exempt from the state unclaimed-property presumption outright, and the one
//      onward destination the rules name is permissive. So no response here carries a countdown, an
//      eligibility flag, or a "required by" date: that would assert an obligation no rule imposes,
//      on a record a disciplinary body may one day read.
//   2. THE DORMANCY WINDOW IS A REQUIRED ARGUMENT, NEVER A DEFAULT. The periods differ by
//      jurisdiction, the clocks they run from differ, and several of the ones that exist gate a
//      permission rather than an obligation — so there is no number this platform is entitled to
//      pick, and a defaulted window would quietly answer a different question from the one the
//      caller asked.
//   3. THE CLOSURE COMPOSES NOTHING. Closing a review as a distribution names a movement that ALREADY
//      POSTED through the ordinary authorized path. This route accepts no amount, no payee, no
//      effective date and no method — that absence IS the manual-confirmation gate, and it is why
//      there is deliberately no "close and pay" convenience here: one would be the composer this
//      whole design refuses to have.

const READ = "trust:read" as const;
const MANAGE = "trust:manage" as const;

// A real calendar date, not a shape. The dormancy window is compared against stored effective dates,
// so a bare regex would let 2026-02-30 select a set nobody asked for.
const civilDate = z
  .string()
  .regex(CIVIL_DATE_PATTERN)
  .refine(isValidCalendarDate, { message: "not a calendar date" });

const ContactChannel = z.enum([
  "regular_mail",
  "certified_mail",
  "telephone",
  "email",
  "record_review",
  "other",
]);

const ContactOutcome = z.enum([
  "no_response",
  "undeliverable",
  "reached",
  "declined",
  "wrong_contact",
  "other",
]);

// Four outcomes, and `search_continues` is a first-class one rather than a failure: it is the honest
// end of most rounds of diligence, and an evidence trail needs it to exist rather than forcing a firm
// to record a conclusion it did not reach.
const ReviewOutcome = z.enum([
  "distributed_to_owner",
  "resolved_without_distribution",
  "not_dormant",
  "search_continues",
]);

const DormantBalanceRecord = z
  .object({
    trustLedgerNodeId: z.string(),
    matterId: z.string(),
    clientEntityId: z.string(),
    balanceMinor: z.number().int(),
    currency: z.string(),
    // The effective date of the EARLIEST receipt still sitting on this ledger, reported beside the
    // last activity because they answer different questions: the rules' clocks run from receipt of
    // the property, so a ledger topped up last year may still hold money received five years ago.
    // The window filters on activity and never on this.
    earliestReceiptDate: z.string().nullable(),
    lastActivityDate: z.string().nullable(),
    // Derived from the absence of a closure row, never a stored flag on the ledger.
    openReviewId: z.string().nullable(),
  })
  .openapi("TrustDormantBalanceRecord");

const DormantBalancesResponse = z
  .object({
    // Echoed back so a reader can never mistake which question was answered — the same list against
    // a wider window is a different answer with no state having changed.
    quietOnOrBefore: z.string(),
    balances: z.array(DormantBalanceRecord),
  })
  .openapi("TrustDormantBalancesResponse");

const OpenReviewRequest = z
  .object({
    trustAccountId: identifierField("trustAccount"),
    matterId: identifierField("matter"),
    // What the reader saw, stated rather than re-read: a review records the OBSERVATION a person
    // acted on, and re-reading here would store a figure nobody looked at — differing from what they
    // saw exactly when a movement landed between the list and the decision, which is the moment the
    // record matters most.
    observedBalanceMinor: z.number().int().positive(),
    observedEarliestReceiptDate: civilDate.nullable(),
    observedLastActivityDate: civilDate.nullable(),
    note: z.string().min(1).nullable().optional(),
  })
  .openapi("TrustOpenUnclaimedFundsReviewRequest");

const ContactAttemptRequest = z
  .object({
    channel: ContactChannel,
    attemptedOn: civilDate,
    // The address, number, or mailbox actually used. It is the whole evidentiary point — "we wrote to
    // the client" is not evidence, and "we wrote to 14 Elm Street on 3 March, returned undelivered"
    // is. A review of the firm's own records carries none, and the composer drops whatever is sent on
    // that channel rather than storing a contact nobody used.
    contactUsed: z.string().min(1).nullable().optional(),
    outcome: ContactOutcome,
    note: z.string().min(1).nullable().optional(),
  })
  .openapi("TrustUnclaimedFundsContactAttemptRequest");

// THE CLOSING PAYLOAD, AND WHAT IS NOT IN IT. There is no amount, no payee, no effective date and no
// method here, and there must never be: on a distribution the movement identifier names a
// disbursement that already posted through the ordinary authorized path, and the absence of every
// other field is what makes it impossible for this endpoint to become the thing that moved the money.
// A field added here would not be a convenience; it would be the manual-confirmation gate removed.
const CloseReviewRequest = z
  .object({
    outcome: ReviewOutcome,
    trustMovementId: identifierField("trustMovement").nullable().optional(),
    note: z.string().min(1).nullable().optional(),
  })
  .openapi("TrustCloseUnclaimedFundsReviewRequest");

const ContactAttemptRecord = z
  .object({
    id: z.string(),
    channel: ContactChannel,
    attemptedOn: z.string(),
    contactUsed: z.string().nullable(),
    outcome: ContactOutcome,
    note: z.string().nullable(),
    recordedBy: z.string(),
    recordedAt: z.string(),
  })
  .openapi("TrustUnclaimedFundsContactAttemptRecord");

const ReviewClosureRecord = z
  .object({
    id: z.string(),
    outcome: ReviewOutcome,
    // The disbursement that already paid the owner — never a movement the closure composed.
    trustMovementId: z.string().nullable(),
    closedBy: z.string(),
    closedAt: z.string(),
    note: z.string().nullable(),
  })
  .openapi("TrustUnclaimedFundsReviewClosureRecord");

// One review with its whole evidence trail. The attempts come back WITH the review rather than
// through a second call a caller could forget to make, because this is the shape a certification is
// assembled from and a half-assembled one is worse than none.
const ReviewResponse = z
  .object({
    id: z.string(),
    trustAccountId: z.string(),
    trustLedgerNodeId: z.string(),
    observedBalanceMinor: z.number().int(),
    currency: z.string(),
    observedEarliestReceiptDate: z.string().nullable(),
    observedLastActivityDate: z.string().nullable(),
    openedBy: z.string(),
    openedAt: z.string(),
    note: z.string().nullable(),
    attempts: z.array(ContactAttemptRecord),
    // Null while the review is open — open is derived from the absence of this row, never stored.
    closure: ReviewClosureRecord.nullable(),
  })
  .openapi("TrustUnclaimedFundsReviewResponse");

const OpenReviewAck = z
  .object({ trustUnclaimedFundsReviewId: z.string(), trustLedgerNodeId: z.string() })
  .openapi("TrustOpenUnclaimedFundsReviewAck");

const ContactAttemptAck = z
  .object({ trustUnclaimedFundsContactAttemptId: z.string() })
  .openapi("TrustUnclaimedFundsContactAttemptAck");

const CloseReviewAck = z
  .object({ trustUnclaimedFundsReviewClosureId: z.string(), outcome: ReviewOutcome })
  .openapi("TrustCloseUnclaimedFundsReviewAck");

const dormantBalancesQuery = z.object({
  trustAccountId: identifierField("trustAccount"),
  // REQUIRED, and never defaulted to a jurisdiction's period. There is no number the platform is
  // entitled to pick, so the reader states the window they are asking about and the answer says which
  // one it answered.
  quietOnOrBefore: civilDate,
});

const reviewParam = z.object({
  reviewId: identifierPathParam("trustUnclaimedFundsReview", "reviewId"),
});

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
      "The firm is unreachable, the member is deactivated, or the trust account, matter ledger, or review is unknown",
    content: { "application/problem+json": { schema: Problem } },
  },
  409: {
    description:
      "A request with this Idempotency-Key is in progress, the client ledger already carries an open review, or the review has already been closed",
    content: { "application/problem+json": { schema: Problem } },
  },
  422: {
    description:
      "The request is invalid, the Idempotency-Key was reused with a different payload, the ledger holds nothing to be unclaimed, or the movement named is not a disbursement from the ledger under review",
    content: { "application/problem+json": { schema: Problem } },
  },
  429: {
    description: "Rate limit exceeded",
    content: { "application/problem+json": { schema: Problem } },
  },
} as const;

// Recording the search is bookkeeping over a client ledger, so it takes the bookkeeping capability.
// It is deliberately NOT the authority capability: nothing on this surface releases money, and
// requiring the authority to release money in order to write down that a letter came back
// undelivered would price the evidence trail out of the firms most likely to need it.
function diligenceWriteMeta(operationId: string): RouteMeta {
  return {
    operationId,
    surface: "app",
    authenticated: true,
    permission: MANAGE,
    resource: "firm",
    audited: true,
    // Nothing here moves money, but every one of these rows is append-only evidence: a retried
    // request that wrote a second attempt would put a locate attempt that happened once into the
    // record twice, on a file a firm may have to certify.
    idempotency: "required",
    idempotencyStore: "firm",
    rateLimit: "default",
  };
}

const dormantBalancesRoute = defineOpenAPIRoute(
  {
    operationId: "trust.dormantBalances",
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
    path: "/api/v1/trust/unclaimed-funds/dormant-balances",
    description:
      "Lists the client ledgers on one trust account that still hold money and have had no movement since a date the caller states. The date is required and has no default: dormancy is a comparison made at read time, not a stored flag, and the periods that exist differ by jurisdiction and often gate a permission rather than an obligation — so there is no window the platform can pick on a firm's behalf. Each row reports the earliest receipt still on the ledger separately from the last activity, because the conduct rules' clocks run from receipt of the property. Nothing here is a verdict: no row says a balance is abandoned, and the firm may have spoken to that client this morning in a way this platform never saw.",
    request: { query: dormantBalancesQuery },
    responses: {
      200: {
        description: "The client ledgers quiet since the stated date",
        content: { "application/json": { schema: DormantBalancesResponse } },
      },
      401: errorResponses[401],
      403: errorResponses[403],
      404: errorResponses[404],
      422: errorResponses[422],
      429: errorResponses[429],
    },
  },
);

const openReviewRoute = defineOpenAPIRoute(diligenceWriteMeta("trust.openUnclaimedFundsReview"), {
  method: "post",
  path: "/api/v1/trust/unclaimed-funds/reviews",
  description:
    "Opens a diligence file over one client's matter ledger: the record of a firm's efforts to locate the owner of money it is still holding. It stores the observation the reviewer acted on — the balance, the earliest receipt, the last activity — and moves nothing. One ledger carries one open review at a time, because the certification a firm eventually signs is about the whole search and two concurrent files would split the evidence in half.",
  request: {
    headers: idempotencyKeyHeader,
    body: { content: { "application/json": { schema: OpenReviewRequest } }, required: true },
  },
  responses: {
    201: {
      description: "The diligence file is open",
      content: { "application/json": { schema: OpenReviewAck } },
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

const recordContactAttemptRoute = defineOpenAPIRoute(
  diligenceWriteMeta("trust.recordUnclaimedFundsContactAttempt"),
  {
    method: "post",
    path: "/api/v1/trust/unclaimed-funds/reviews/{reviewId}/contact-attempts",
    description:
      "Records one attempt to reach the owner, as it was made: the channel, the date, the address or number actually used, and what came of it. The contact used is required on every channel but a review of the firm's own records — it is the part of the evidence nobody can reconstruct two years later, and a record that says only that the firm wrote to the client is not evidence of anything. Attempts are append-only: one that happened cannot be un-happened, and a correction is a further attempt saying so.",
    request: {
      headers: idempotencyKeyHeader,
      params: reviewParam,
      body: { content: { "application/json": { schema: ContactAttemptRequest } }, required: true },
    },
    responses: {
      201: {
        description: "The attempt was recorded",
        content: { "application/json": { schema: ContactAttemptAck } },
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

const closeReviewRoute = defineOpenAPIRoute(diligenceWriteMeta("trust.closeUnclaimedFundsReview"), {
  method: "post",
  path: "/api/v1/trust/unclaimed-funds/reviews/{reviewId}/closure",
  description:
    "Ends one round of diligence, recording what came of it. It writes one row and moves nothing. Closing as a distribution ATTACHES a trust disbursement that has already been composed, authorized under the firm's policy, and committed on the disbursement routes — this endpoint takes no amount, no payee, no effective date and no method, so there is nothing here that could be assembled into a payment, and the movement named must be a disbursement from the very ledger under review. An inconclusive round is closed as a continuing search, which is the honest end of most of them.",
  request: {
    headers: idempotencyKeyHeader,
    params: reviewParam,
    body: { content: { "application/json": { schema: CloseReviewRequest } }, required: true },
  },
  responses: {
    201: {
      description: "The round of diligence is closed",
      content: { "application/json": { schema: CloseReviewAck } },
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

const getReviewRoute = defineOpenAPIRoute(
  {
    operationId: "trust.getUnclaimedFundsReview",
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
    path: "/api/v1/trust/unclaimed-funds/reviews/{reviewId}",
    description:
      "Returns one diligence file whole: the observation it was opened on, every locate attempt in the order they were made, and its closure if the round has ended. This is the shape a certification is assembled from, which is why the attempts come back with the review rather than through a second call.",
    request: { params: reviewParam },
    responses: {
      200: {
        description: "The diligence file and its evidence trail",
        content: { "application/json": { schema: ReviewResponse } },
      },
      401: errorResponses[401],
      403: errorResponses[403],
      404: errorResponses[404],
      422: errorResponses[422],
      429: errorResponses[429],
    },
  },
);

// A refusal's HTTP status is a property of what the refusal MEANS, so the mapping lives in one place
// rather than at the call sites that would drift. It is separate from the client-money movement
// mapping in src/http/trust-refusal-problems.ts for the reason the reconciliation module's is: every
// status that mapping can produce speaks about a movement, and nothing on this surface is one.
function unclaimedFundsErrorResponse(
  c: Context,
  error: TrustValidationError,
): ProblemResponse<404> | ProblemResponse<409> | ProblemResponse<422> {
  if (
    error.code === "unknown-trust-account" ||
    error.code === "unknown-trust-node" ||
    error.code === "unknown-trust-unclaimed-funds-review"
  ) {
    return problemJson(c, {
      type: "not-found",
      title: "Not found",
      status: 404,
      detail: error.message,
    });
  }
  // The file is not in a state this act can be performed against. Both arms are answered by reading
  // the review that stands: one is recorded on, the other is superseded by opening the next round.
  if (
    error.code === "trust-unclaimed-funds-review-already-open" ||
    error.code === "trust-unclaimed-funds-review-already-closed"
  ) {
    return problemJson(c, {
      type: "trust-unclaimed-funds-review-not-actionable",
      title: "That is not the state this diligence file is in",
      status: 409,
      detail: error.message,
    });
  }
  return unclaimedFundsReadErrorResponse(c, error);
}

// The refusals a READ can raise: an unknown handle, a window that is not a date, and the truncation
// refusal. Spelled out separately rather than routed through the write-path mapping because the read
// routes declare no 409 and could not honestly return one.
function unclaimedFundsReadErrorResponse(
  c: Context,
  error: TrustValidationError,
): ProblemResponse<404> | ProblemResponse<422> {
  if (
    error.code === "unknown-trust-account" ||
    error.code === "unknown-trust-node" ||
    error.code === "unknown-trust-unclaimed-funds-review"
  ) {
    return problemJson(c, {
      type: "not-found",
      title: "Not found",
      status: 404,
      detail: error.message,
    });
  }
  // A truncated diligence list is refused rather than shortened: a firm working one would believe it
  // had worked the whole list, and the remedy — a narrower window — is in the caller's hands.
  if (error.code === "trust-dormant-balances-truncated") {
    return problemJson(c, {
      type: "trust-dormant-list-truncated",
      title: "Too many client ledgers have been quiet since that date",
      status: 422,
      detail: error.message,
    });
  }
  // Everything else the rules refuse about a diligence file: a ledger holding nothing, a ledger tier
  // that is not a client's matter ledger, a window that is not a calendar date, or a closure naming a
  // payment that is not a disbursement from the ledger under review.
  return problemJson(c, {
    type: "trust-unclaimed-funds-refused",
    title: "The trust rules refuse this",
    status: 422,
    detail: error.message,
  });
}

type UnclaimedFundsApp = OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>;

function toDormantBalance(balance: TrustDormantBalance): z.infer<typeof DormantBalanceRecord> {
  return {
    trustLedgerNodeId: balance.nodeId,
    matterId: balance.matterId,
    clientEntityId: balance.clientEntityId,
    balanceMinor: balance.balanceMinor,
    currency: balance.currency,
    earliestReceiptDate: balance.earliestReceiptDate,
    lastActivityDate: balance.lastActivityDate,
    openReviewId: balance.openReviewId,
  };
}

function toReviewResponse(
  review: TrustUnclaimedFundsReviewSnapshot,
): z.infer<typeof ReviewResponse> {
  return {
    id: review.id,
    trustAccountId: review.trustAccountId,
    trustLedgerNodeId: review.nodeId,
    observedBalanceMinor: review.observedBalanceMinor,
    currency: review.currency,
    observedEarliestReceiptDate: review.observedEarliestReceiptDate,
    observedLastActivityDate: review.observedLastActivityDate,
    openedBy: review.openedBy,
    openedAt: review.openedAt,
    note: review.note,
    attempts: review.attempts.map((attempt) => ({
      id: attempt.id,
      channel: attempt.channel,
      attemptedOn: attempt.attemptedOn,
      contactUsed: attempt.contactUsed,
      outcome: attempt.outcome,
      note: attempt.note,
      recordedBy: attempt.recordedBy,
      recordedAt: attempt.recordedAt,
    })),
    closure:
      review.closure === null
        ? null
        : {
            id: review.closure.id,
            outcome: review.closure.outcome,
            trustMovementId: review.closure.movementId,
            closedBy: review.closure.closedBy,
            closedAt: review.closure.closedAt,
            note: review.closure.note,
          },
  };
}

export function registerTrustUnclaimedFundsRoutes(
  app: UnclaimedFundsApp,
  chokepoint: Chokepoint,
): void {
  // The shared idempotent commit. Every write on this surface produces exactly one append-only
  // evidence row and no ledger entry — the idempotency record is what stops a retry from putting one
  // real locate attempt into the file twice.
  async function commitDiligenceWrite<Body>(
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
      if (caught instanceof TrustValidationError) return unclaimedFundsErrorResponse(c, caught);
      // The ledger's own refusals do not arise on this surface today — nothing here composes an
      // entry — but the arm stays because the alternative to a mapped 422 is a 500 with an Error ID
      // for a typo, and a surface that silently loses that mapping the day it grows is worse.
      if (caught instanceof LedgerValidationError)
        return problemResponseForLedgerRefusal(c, caught);
      throw caught;
    }
    if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch")
      return problemResponseForIdempotencyConflict(c, result);
    if (result.kind === "replayed") c.header("Idempotency-Replayed", "true");
    return c.json(JSON.parse(result.responseBody ?? "{}") as Body, 201);
  }

  // GET /api/v1/trust/unclaimed-funds/dormant-balances — the comparison, against the caller's window
  app.openapi(
    { ...dormantBalancesRoute, middleware: chokepointMiddleware(chokepoint, dormantBalancesRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { trustAccountId, quietOnOrBefore } = c.req.valid("query");
      let dormant;
      try {
        dormant = await readDormantTrustBalances(firm.firmDatabase, {
          trustAccountId,
          quietOnOrBefore,
        });
      } catch (caught) {
        if (caught instanceof TrustValidationError)
          return unclaimedFundsReadErrorResponse(c, caught);
        throw caught;
      }
      return c.json(
        {
          quietOnOrBefore: dormant.quietOnOrBefore,
          balances: dormant.balances.map(toDormantBalance),
        },
        200,
      );
    },
  );

  // POST /api/v1/trust/unclaimed-funds/reviews — open the diligence file
  app.openapi(
    { ...openReviewRoute, middleware: chokepointMiddleware(chokepoint, openReviewRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const request = c.req.valid("json");
      return commitDiligenceWrite<z.infer<typeof OpenReviewAck>>(c, async (openedBy) => {
        // The matter, as everywhere else on the trust surface — never a bare ledger-node handle. The
        // leaf is resolved from the account and the matter, so this endpoint cannot be handed a node
        // of some other kind and asked to work out what it is.
        const node = await loadMatterTrustLeaf(
          firm.firmDatabase,
          request.trustAccountId,
          request.matterId,
        );
        const composed = await composeTrustUnclaimedFundsReview(
          firm.firmDatabase,
          {
            nodeId: node.id,
            observedBalanceMinor: request.observedBalanceMinor,
            observedEarliestReceiptDate: request.observedEarliestReceiptDate,
            observedLastActivityDate: request.observedLastActivityDate,
            openedBy,
            note: request.note ?? null,
          },
          trustOptions(),
        );
        return {
          write: composed.effect,
          body: { trustUnclaimedFundsReviewId: composed.reviewId, trustLedgerNodeId: node.id },
        };
      });
    },
  );

  // POST /api/v1/trust/unclaimed-funds/reviews/{reviewId}/contact-attempts — one attempt, as made
  app.openapi(
    {
      ...recordContactAttemptRoute,
      middleware: chokepointMiddleware(chokepoint, recordContactAttemptRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { reviewId } = c.req.valid("param");
      const request = c.req.valid("json");
      return commitDiligenceWrite<z.infer<typeof ContactAttemptAck>>(c, async (recordedBy) => {
        const composed = await composeTrustUnclaimedFundsContactAttempt(
          firm.firmDatabase,
          {
            reviewId,
            channel: request.channel,
            attemptedOn: request.attemptedOn,
            contactUsed: request.contactUsed ?? null,
            outcome: request.outcome,
            note: request.note ?? null,
            recordedBy,
          },
          trustOptions(),
        );
        return {
          write: composed.effect,
          body: { trustUnclaimedFundsContactAttemptId: composed.attemptId },
        };
      });
    },
  );

  // POST /api/v1/trust/unclaimed-funds/reviews/{reviewId}/closure — the round ends; nothing moves
  app.openapi(
    { ...closeReviewRoute, middleware: chokepointMiddleware(chokepoint, closeReviewRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { reviewId } = c.req.valid("param");
      const request = c.req.valid("json");
      return commitDiligenceWrite<z.infer<typeof CloseReviewAck>>(c, async (closedBy) => {
        const composed = await composeTrustUnclaimedFundsReviewClosure(
          firm.firmDatabase,
          {
            reviewId,
            outcome: request.outcome,
            movementId: request.trustMovementId ?? null,
            closedBy,
            note: request.note ?? null,
          },
          trustOptions(),
        );
        return {
          write: composed.effect,
          body: {
            trustUnclaimedFundsReviewClosureId: composed.closureId,
            outcome: request.outcome,
          },
        };
      });
    },
  );

  // GET /api/v1/trust/unclaimed-funds/reviews/{reviewId} — the file, whole
  app.openapi(
    { ...getReviewRoute, middleware: chokepointMiddleware(chokepoint, getReviewRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { reviewId } = c.req.valid("param");
      let review;
      try {
        review = await readTrustUnclaimedFundsReview(firm.firmDatabase, reviewId);
      } catch (caught) {
        if (caught instanceof TrustValidationError)
          return unclaimedFundsReadErrorResponse(c, caught);
        throw caught;
      }
      return c.json(toReviewResponse(review), 200);
    },
  );
}

// The trust package reads no wall clock of its own, so every composer takes one. Built per request
// rather than once at module scope so a long-lived isolate cannot freeze "now".
const trustOptions = () => ({
  clock: {
    now: () => new Date().toISOString(),
    today: () => todayInUtc(),
  },
});
