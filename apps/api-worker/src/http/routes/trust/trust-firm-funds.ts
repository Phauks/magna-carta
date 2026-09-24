import { CIVIL_DATE_PATTERN, todayInUtc } from "@magna-carta/civil-time/civil-date";
import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import type { UserId } from "@magna-carta/identifiers/types";
import { isValidCalendarDate, LedgerValidationError } from "@magna-carta/ledger/validate";
import { currencyFromCode, money } from "@magna-carta/money/money";
import {
  composeTrustBankCharge,
  composeTrustFirmFundsDeposit,
  openTrustFirmFundsNode,
  readTrustFirmFundsPosition,
  type ComposedTrustFirmFundsMovement,
} from "@magna-carta/trust/firm-funds";
import { selectTrustFirmFundsMovementsStatement } from "@magna-carta/trust/statements";
import { TrustValidationError } from "@magna-carta/trust/trust-validation";
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
import { idempotencyKeyHeader, identifierField } from "../../contracts/common.ts";
import { Problem, problemJson, type ProblemResponse } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";
import { problemResponseForIdempotencyConflict } from "../../idempotency-conflict-problems.ts";
import { problemResponseForLedgerRefusal } from "../../ledger-refusal-problems.ts";

// THE FIRM'S OWN MONEY IN A TRUST ACCOUNT — the bank-charge carve-out, and nothing else.
//
// A trust bank account is charged by its institution, and that money leaves with no
// client-attributable authorization behind it. The conduct rules answer by permitting a firm to keep
// a small amount of its OWN money in the account for the sole purpose of bearing those charges. This
// module is the HTTP surface over that permission and over nothing adjacent to it.
//
// WHY THIS IS A SEPARATE MODULE FROM routes/trust/trust.ts, and must stay one. Firm money and client money
// never share a door. The domain layer holds that as a second, NARROWER composition guard rather than
// a flag on the client-money one, precisely so no caller is ever a boolean away from moving a client's
// funds on a firm-funds entry — and a route layer that offered one endpoint taking a ledger-node
// handle and dispatching on what kind of node it turned out to be would hand that boolean straight
// back. Every route here therefore names the TRUST ACCOUNT and never a node: the one node its entries
// can touch is derived from the account, exactly as the domain layer derives it.
//
// WHAT IS DELIBERATELY ABSENT. There is no endpoint that pays anybody: paying a person out of a trust
// account is a disbursement, and it goes through the disbursement queue with its authorization, on
// routes/trust/trust.ts. There is no endpoint that withdraws surplus firm funds either — the rule text
// authorizes the deposit and is silent on taking it back out, so the domain layer composes no such
// movement and this surface invents none.

// A KEY OF ITS OWN, AND EVERY ROUTE HERE TURNS IT — including the read. "May keep the trust books"
// and "may put the firm's own money into a client trust account" are different acts with different
// exposure, which is why this is not a corner of trust:manage; a read gated on the bookkeeping key
// would still tell a member who may not exercise the carve-out exactly how much of it is left.
const FIRM_FUNDS = "trust:firmFunds" as const;

// A real calendar date, not a shape: a bare regex accepts 2026-02-30, which reaches the ledger's own
// check as an error class this module maps but which a member should never have had to travel that
// far to hear about.
const civilDate = z
  .string()
  .regex(CIVIL_DATE_PATTERN)
  .refine(isValidCalendarDate, { message: "not a calendar date" });

// The methods a firm may state for putting its own cushion in. `bank_debit` is absent deliberately:
// it is the institution helping itself, which is what a service charge IS — no member released it and
// no instrument left the firm — so it is the one method a top-up may not claim, and leaving it out of
// the contract means a caller never gets as far as the refusal. A charge names no method at all: the
// only one it could carry is set server-side, so there is no field in which to get it wrong.
const FirmFundsDepositMethod = z.enum(["check", "wire", "electronic_transfer"]);

const OpenFirmFundsRequest = z
  .object({
    trustAccountId: identifierField("trustAccount"),
    // What the cushion's ledger account is called on a report. The chart of accounts is the firm's,
    // not this platform's — the same reason opening a trust account takes its name from the caller.
    nodeName: z.string().min(1),
  })
  .openapi("TrustOpenFirmFundsRequest");

const FirmFundsMovementRequest = z
  .object({
    trustAccountId: identifierField("trustAccount"),
    amountMinor: z.number().int().positive(),
    currency: z.literal("USD"),
    effectiveDate: civilDate,
    description: z.string().min(1),
    reference: z.string().min(1).nullable().optional(),
  })
  .openapi("TrustFirmFundsMovementRequest");

const FirmFundsDepositRequest = FirmFundsMovementRequest.extend({
  method: FirmFundsDepositMethod,
}).openapi("TrustFirmFundsDepositRequest");

const OpenFirmFundsAck = z
  .object({
    trustLedgerNodeId: z.string(),
    ledgerAccountId: z.string(),
  })
  .openapi("TrustOpenFirmFundsAck");

const FirmFundsMovementAck = z
  .object({
    trustFirmFundsMovementId: z.string(),
    ledgerEntryId: z.string(),
    trustLedgerNodeId: z.string(),
  })
  .openapi("TrustFirmFundsMovementAck");

const FirmFundsMovementRecord = z
  .object({
    id: z.string(),
    // Two kinds and no more: the firm putting its cushion in, and the institution taking a charge
    // out. There is no kind that pays a person.
    kind: z.enum(["firm_funds_deposit", "bank_charge"]),
    amountMinor: z.number().int(),
    currency: z.string(),
    ledgerEntryId: z.string(),
    method: z.enum(["check", "wire", "electronic_transfer", "bank_debit"]),
    reference: z.string().nullable(),
    description: z.string(),
    recordedBy: z.string(),
    effectiveDate: z.string(),
    recordedAt: z.string(),
  })
  .openapi("TrustFirmFundsMovementRecord");

// The cushion as it stands, with what the firm put in and what the bank has taken out. There is no
// `available` figure and no hold model here: a hold restricts a CLIENT's money pending a dispute, and
// a firm disputing itself is not a shape worth expressing.
const FirmFundsPositionResponse = z
  .object({
    trustAccountId: z.string(),
    trustLedgerNodeId: z.string(),
    ledgerAccountId: z.string(),
    balanceMinor: z.number().int(),
    currency: z.string(),
    movements: z.array(FirmFundsMovementRecord),
  })
  .openapi("TrustFirmFundsPositionResponse");

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
      "The firm is unreachable, the member is deactivated, or the trust account is unknown or keeps none of the firm's own funds",
    content: { "application/problem+json": { schema: Problem } },
  },
  409: {
    description:
      "A request with this Idempotency-Key is in progress, the charge is larger than the firm's own funds in the account, or the carve-out is already open on it",
    content: { "application/problem+json": { schema: Problem } },
  },
  422: {
    description:
      "The request is invalid, the Idempotency-Key was reused with a different payload, the carve-out is not open on this account, the account is the pooled interest-bearing kind the rules exempt from service charges, or the account's jurisdiction cannot be resolved",
    content: { "application/problem+json": { schema: Problem } },
  },
  429: {
    description: "Rate limit exceeded",
    content: { "application/problem+json": { schema: Problem } },
  },
} as const;

function firmFundsWriteMeta(operationId: string): RouteMeta {
  return {
    operationId,
    surface: "app",
    authenticated: true,
    permission: FIRM_FUNDS,
    // A trust account belongs to an office and its ledger spans many matters, so the capability is
    // firm-scoped — the same binding every other trust route carries.
    resource: "firm",
    audited: true,
    // Money moving is never replayable, and the firm's own money is no exception: a retried top-up
    // that posted twice would put twice the cushion into a client trust account.
    idempotency: "required",
    idempotencyStore: "firm",
    rateLimit: "default",
  };
}

const openFirmFundsRoute = defineOpenAPIRoute(firmFundsWriteMeta("trust.openFirmFunds"), {
  method: "post",
  path: "/api/v1/trust/firm-funds",
  description:
    "Opens the bank-charge carve-out on one trust account: the firm may keep its own money in that account for the single purpose of bearing the institution's service charges. It is off until a firm deliberately turns it on, one balance per account, and it carries the same zero floor a client ledger carries — so a charge larger than the firm's own funds aborts rather than reaching client money. Refused outright on a pooled interest-bearing account, which the researched rules exempt from service charges: with no charge for the firm's funds to pay there is no permitted purpose, and firm money in a pooled client account without one is commingling.",
  request: {
    headers: idempotencyKeyHeader,
    body: { content: { "application/json": { schema: OpenFirmFundsRequest } }, required: true },
  },
  responses: {
    201: {
      description: "The carve-out is open on this account",
      content: { "application/json": { schema: OpenFirmFundsAck } },
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

const depositFirmFundsRoute = defineOpenAPIRoute(firmFundsWriteMeta("trust.depositFirmFunds"), {
  method: "post",
  path: "/api/v1/trust/firm-funds/deposits",
  description:
    "Puts the firm's own money into the trust account's bank-charge cushion. This is the only way the cushion is funded and the only permitted deposit of firm money into a trust account. It touches the cushion and that account's bank balance and nothing else — a client ledger cannot appear on this entry, because the record of it has no column a client, a matter, or a payee could be named in.",
  request: {
    headers: idempotencyKeyHeader,
    body: { content: { "application/json": { schema: FirmFundsDepositRequest } }, required: true },
  },
  responses: {
    201: {
      description: "The firm's own funds were recorded into the cushion",
      content: { "application/json": { schema: FirmFundsMovementAck } },
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

const recordBankChargeRoute = defineOpenAPIRoute(firmFundsWriteMeta("trust.recordBankCharge"), {
  method: "post",
  path: "/api/v1/trust/firm-funds/bank-charges",
  description:
    "Records the institution taking a service charge out of the trust bank account, borne by the firm's own cushion. A charge larger than the cushion is refused with the remedy named — put the firm's funds in to cover it, then record the charge — because a bank charge is never borne by client money; until then the statement line sits unmatched and the reconciliation reports the difference, which is the honest state. The method is not a field: a service charge is the institution helping itself, which is the one method this movement can carry and is set here rather than stated.",
  request: {
    headers: idempotencyKeyHeader,
    body: { content: { "application/json": { schema: FirmFundsMovementRequest } }, required: true },
  },
  responses: {
    201: {
      description: "The bank charge was recorded against the firm's own funds",
      content: { "application/json": { schema: FirmFundsMovementAck } },
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

const firmFundsPositionRoute = defineOpenAPIRoute(
  {
    operationId: "trust.firmFundsPosition",
    surface: "app",
    authenticated: true,
    permission: FIRM_FUNDS,
    resource: "firm",
    audited: false,
    idempotency: "optional",
    rateLimit: "default",
  },
  {
    method: "get",
    path: "/api/v1/trust/firm-funds",
    description:
      "Returns what is left of the firm's own money in one trust account, with every top-up and every service charge that produced it, most recent first. An account on which the carve-out was never opened has no such balance and answers 404 — the firm's cushion is a thing a firm opts into, never a zero that quietly exists everywhere.",
    request: { query: trustAccountQuery },
    responses: {
      200: {
        description: "The firm's own funds in this trust account",
        content: { "application/json": { schema: FirmFundsPositionResponse } },
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
// rather than at the call sites that would drift.
//
// It is deliberately NOT the client-money mapping in src/http/trust-refusal-problems.ts. Every problem
// that mapping can produce speaks about client money — "the client ledger does not have that much
// available", "the trust rules refuse this movement" — and every one of those sentences is FALSE
// about the firm's own cushion. Telling a firm its own top-up was refused as an improper movement of
// a client's funds would be the exact confusion the second composition door exists to prevent,
// stated in the one place a person actually reads.
function firmFundsErrorResponse(
  c: Context,
  error: TrustValidationError,
): ProblemResponse<404> | ProblemResponse<409> | ProblemResponse<422> {
  if (error.code === "unknown-trust-account") {
    return problemJson(c, {
      type: "not-found",
      title: "Not found",
      status: 404,
      detail: error.message,
    });
  }
  // The cushion is short. A condition that is genuinely different once the firm restores its own
  // funds, so it is a 409 and retrying against the account as it then stands is a real remedy.
  if (error.code === "bank-charge-exceeds-firm-funds") {
    return problemJson(c, {
      type: "trust-firm-funds-insufficient",
      title: "The firm's own funds in this account do not cover that charge",
      status: 409,
      detail: error.message,
    });
  }
  // One balance per account by design, and the caller reads the one that stands.
  if (error.code === "firm-funds-node-already-open") {
    return problemJson(c, {
      type: "conflict",
      title: "The carve-out is already open on this trust account",
      status: 409,
      detail: error.message,
    });
  }
  // The jurisdiction refusals reach this surface too — opening the carve-out and every movement in it
  // resolve one first. They keep their own problem type rather than falling into the catch-all below,
  // because each is fixed by a person doing something other than retrying: recording the office's
  // state, researching a jurisdiction, having an attorney review one, researching the missed field.
  if (
    error.code === "jurisdiction-not-recorded" ||
    error.code === "jurisdiction-not-encoded" ||
    error.code === "jurisdiction-not-verified" ||
    error.code === "jurisdiction-requirement-not-encoded"
  ) {
    return problemJson(c, {
      type: "trust-jurisdiction-unavailable",
      title: "The trust account's jurisdiction cannot be resolved",
      status: 422,
      detail: error.message,
    });
  }
  // Everything else the rules refuse about the firm's own funds: the carve-out is not open on this
  // account, the account is the pooled interest-bearing kind that bears no charges, the account is
  // closed, the currency is not the account's, or the entry is not one the narrower door admits.
  return problemJson(c, {
    type: "trust-firm-funds-refused",
    title: "The trust rules refuse this act on the firm's own funds",
    status: 422,
    detail: error.message,
  });
}

type FirmFundsApp = OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>;

interface FirmFundsMovementRow {
  id: string;
  kind: "firm_funds_deposit" | "bank_charge";
  amount_minor: number;
  currency: string;
  entry_id: string;
  method: "check" | "wire" | "electronic_transfer" | "bank_debit";
  reference: string | null;
  description: string;
  recorded_by: string;
  effective_date: string;
  recorded_at: string;
}

function rowToFirmFundsMovement(
  row: FirmFundsMovementRow,
): z.infer<typeof FirmFundsMovementRecord> {
  return {
    id: row.id,
    kind: row.kind,
    amountMinor: row.amount_minor,
    currency: row.currency,
    ledgerEntryId: row.entry_id,
    method: row.method,
    reference: row.reference,
    description: row.description,
    recordedBy: row.recorded_by,
    effectiveDate: row.effective_date,
    recordedAt: row.recorded_at,
  };
}

export function registerTrustFirmFundsRoutes(app: FirmFundsApp, chokepoint: Chokepoint): void {
  // The shared idempotent commit: one batch carrying the ledger entry, its lines, the balance
  // updates, the firm-funds record, and the idempotency record. The cushion's zero floor aborts all
  // of it together when a charge overruns it, which is what makes "a charge never reaches client
  // money" a guarantee rather than the pre-check in front of it.
  async function commitFirmFundsWrite<Body>(
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
      if (caught instanceof TrustValidationError) return firmFundsErrorResponse(c, caught);
      // The ledger refuses on its own terms too — a future effective date, a date that is not a
      // date. Without this arm those reach the app's error boundary and a member gets a 500 with an
      // Error ID for a typo.
      if (caught instanceof LedgerValidationError)
        return problemResponseForLedgerRefusal(c, caught);
      throw caught;
    }
    if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch")
      return problemResponseForIdempotencyConflict(c, result);
    if (result.kind === "replayed") c.header("Idempotency-Replayed", "true");
    return c.json(JSON.parse(result.responseBody ?? "{}") as Body, 201);
  }

  const commitFirmFundsMovement = (
    c: Context,
    compose: (recordedBy: UserId) => Promise<ComposedTrustFirmFundsMovement>,
  ) =>
    commitFirmFundsWrite<z.infer<typeof FirmFundsMovementAck>>(c, async (recordedBy) => {
      const movement = await compose(recordedBy);
      return {
        write: movement.effect satisfies EffectWrite,
        body: {
          trustFirmFundsMovementId: movement.firmFundsMovementId,
          ledgerEntryId: movement.entryId,
          trustLedgerNodeId: movement.nodeId,
        },
      };
    });

  // POST /api/v1/trust/firm-funds — turn the carve-out on, for one account
  app.openapi(
    { ...openFirmFundsRoute, middleware: chokepointMiddleware(chokepoint, openFirmFundsRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const request = c.req.valid("json");
      return commitFirmFundsWrite<z.infer<typeof OpenFirmFundsAck>>(c, async () => {
        const opened = await openTrustFirmFundsNode(
          firm.firmDatabase,
          { trustAccountId: request.trustAccountId, nodeName: request.nodeName },
          trustOptions(),
        );
        return {
          write: opened.effect,
          body: { trustLedgerNodeId: opened.nodeId, ledgerAccountId: opened.ledgerAccountId },
        };
      });
    },
  );

  // POST /api/v1/trust/firm-funds/deposits — the firm's own money in
  app.openapi(
    {
      ...depositFirmFundsRoute,
      middleware: chokepointMiddleware(chokepoint, depositFirmFundsRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const request = c.req.valid("json");
      return commitFirmFundsMovement(c, (recordedBy) =>
        composeTrustFirmFundsDeposit(
          firm.firmDatabase,
          {
            trustAccountId: request.trustAccountId,
            amount: money(request.amountMinor, currencyFromCode(request.currency)),
            effectiveDate: request.effectiveDate,
            description: request.description,
            method: request.method,
            reference: request.reference ?? null,
            recordedBy,
          },
          trustOptions(),
        ),
      );
    },
  );

  // POST /api/v1/trust/firm-funds/bank-charges — the institution taking its charge out
  app.openapi(
    {
      ...recordBankChargeRoute,
      middleware: chokepointMiddleware(chokepoint, recordBankChargeRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const request = c.req.valid("json");
      return commitFirmFundsMovement(c, (recordedBy) =>
        composeTrustBankCharge(
          firm.firmDatabase,
          {
            trustAccountId: request.trustAccountId,
            amount: money(request.amountMinor, currencyFromCode(request.currency)),
            effectiveDate: request.effectiveDate,
            description: request.description,
            reference: request.reference ?? null,
            recordedBy,
          },
          trustOptions(),
        ),
      );
    },
  );

  // GET /api/v1/trust/firm-funds — what is left of the cushion, and how it got there
  app.openapi(
    {
      ...firmFundsPositionRoute,
      middleware: chokepointMiddleware(chokepoint, firmFundsPositionRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { trustAccountId } = c.req.valid("query");
      let position;
      try {
        position = await readTrustFirmFundsPosition(firm.firmDatabase, trustAccountId);
      } catch (caught) {
        // An unknown account is the only refusal this read can raise, and it is a 404. Routing it
        // through the write-path mapping would let a read return statuses its own contract does not
        // declare.
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
      if (position === null) {
        return problemJson(c, {
          type: "not-found",
          title: "Not found",
          status: 404,
          detail: `trust account ${trustAccountId} keeps none of the firm's own funds: the bank-charge carve-out was never opened on it`,
        });
      }
      const { results } = await selectTrustFirmFundsMovementsStatement(
        firm.firmDatabase,
        trustAccountId,
      ).all<FirmFundsMovementRow>();
      return c.json(
        {
          trustAccountId: position.trustAccountId,
          trustLedgerNodeId: position.nodeId,
          ledgerAccountId: position.ledgerAccountId,
          balanceMinor: position.balanceMinor,
          currency: position.currency,
          movements: results.map(rowToFirmFundsMovement),
        },
        200,
      );
    },
  );
}

// The ledger's future-dating check compares against a civil date. The Worker has no user time zone on
// a request, so UTC is the resolution — the same one the rest of the platform uses for a server-side
// "today".

// The trust package reads no wall clock of its own, so every composer takes one. Built per request
// rather than once at module scope so a long-lived isolate cannot freeze "now".
const trustOptions = () => ({
  clock: { now: () => new Date().toISOString(), today: todayInUtc },
});
