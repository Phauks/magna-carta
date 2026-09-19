import { CIVIL_DATE_PATTERN } from "@magna-carta/civil-time/civil-date";
import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import {
  createRateCard,
  appendRate,
  reRateUnbilledDrafts,
} from "@magna-carta/timekeeping/rate-service";
import { RateValidationError } from "@magna-carta/timekeeping/rate-validation";
import { listRateCardsStatement } from "@magna-carta/timekeeping/rate-statements";
import type { RateCardId } from "@magna-carta/identifiers/types";
import type { Context } from "hono";
import type { Bindings } from "../bindings.ts";
import type { Chokepoint } from "../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointUserId,
  requireChokepointIdempotency,
} from "../chokepoint/context-accessors.ts";
import type { AppVariables } from "../chokepoint/ports.ts";
import { chokepointMiddleware } from "../chokepoint/register.ts";
import { idempotencyKeyHeader, identifierPathParam } from "../contracts/common.ts";
import { Problem, problemJson } from "../contracts/problem.ts";
import type { ProblemResponse } from "../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../contracts/route-meta.ts";
import { problemResponseForIdempotencyConflict } from "../idempotency-conflict-problems.ts";

// Rate card management: create rate cards, append effective-dated rate versions, re-rate unbilled
// drafts over a date range (opt-in retroactive correction). All writes require time:manageRates.
// Reads are available to the same permission gate (the rate card list powers the entry UI).
// Rate amounts are stored in e4 (integer × 10^-4 of the currency unit) for exact arithmetic.

const MANAGE_RATES = "time:manageRates" as const;

const CreateRateCardRequest = z
  .object({ name: z.string().min(1) })
  .openapi("CreateRateCardRequest");

const AppendRateRequest = z
  .object({
    tier: z.enum(["matter", "client", "timekeeper", "role"]),
    scopedId: z.string().nullable().optional(),
    rateE4: z.number().int().positive(),
    currency: z.string().min(1),
    validFrom: z.string().regex(CIVIL_DATE_PATTERN),
  })
  .openapi("AppendRateRequest");

const ReRateDraftsRequest = z
  .object({
    fromDate: z.string().regex(CIVIL_DATE_PATTERN),
    toDate: z.string().regex(CIVIL_DATE_PATTERN),
  })
  .openapi("ReRateDraftsRequest");

const RateCardAck = z.object({ rateCardId: z.string() }).openapi("RateCardAck");
const RateAck = z.object({ rateId: z.string() }).openapi("RateAck");
const ReRateAck = z.object({ count: z.number().int() }).openapi("ReRateAck");

const RateCardSummary = z.object({ id: z.string(), name: z.string() }).openapi("RateCardSummary");
const RateCardListResponse = z
  .object({ data: z.array(RateCardSummary) })
  .openapi("RateCardListResponse");

const rateCardParam = z.object({ id: identifierPathParam("rateCard", "id") });

const authErrors = {
  400: {
    description: "Missing Idempotency-Key (this operation requires one)",
    content: { "application/problem+json": { schema: Problem } },
  },
  401: {
    description: "No valid session",
    content: { "application/problem+json": { schema: Problem } },
  },
  403: {
    description: "The session member lacks time:manageRates",
    content: { "application/problem+json": { schema: Problem } },
  },
  404: {
    description: "The firm is unreachable, the member is deactivated, or the rate card is unknown",
    content: { "application/problem+json": { schema: Problem } },
  },
  409: {
    description: "A request with this Idempotency-Key is in progress",
    content: { "application/problem+json": { schema: Problem } },
  },
  422: {
    description:
      "The request is invalid, the Idempotency-Key was reused with a different payload, or the rate interval overlaps",
    content: { "application/problem+json": { schema: Problem } },
  },
  429: {
    description: "Rate limit exceeded",
    content: { "application/problem+json": { schema: Problem } },
  },
} as const;

const writeErrorResponses = {
  400: authErrors[400],
  401: authErrors[401],
  403: authErrors[403],
  404: authErrors[404],
  409: authErrors[409],
  422: authErrors[422],
  429: authErrors[429],
} as const;
const readErrorResponses = {
  401: authErrors[401],
  403: authErrors[403],
  404: authErrors[404],
  429: authErrors[429],
} as const;

function writeMeta(operationId: string): RouteMeta {
  return {
    operationId,
    surface: "app",
    authenticated: true,
    permission: MANAGE_RATES,
    resource: "matter",
    audited: true,
    idempotency: "required",
    idempotencyStore: "firm",
    rateLimit: "default",
  };
}

const createMeta = writeMeta("rateCards.create");
const appendRateMeta = writeMeta("rates.append");
const reRateDraftsMeta = writeMeta("rates.reRateDrafts");
const listMeta: RouteMeta = {
  operationId: "rateCards.list",
  surface: "app",
  authenticated: true,
  permission: MANAGE_RATES,
  resource: "matter",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

const createRoute = defineOpenAPIRoute(createMeta, {
  method: "post",
  path: "/api/v1/rate-cards",
  description:
    "Creates a rate card. All rate lines are appended separately with their effective date.",
  request: {
    headers: idempotencyKeyHeader,
    body: { content: { "application/json": { schema: CreateRateCardRequest } }, required: true },
  },
  responses: {
    201: {
      description: "The rate card was created",
      content: { "application/json": { schema: RateCardAck } },
    },
    400: writeErrorResponses[400],
    401: writeErrorResponses[401],
    403: writeErrorResponses[403],
    404: writeErrorResponses[404],
    409: writeErrorResponses[409],
    422: writeErrorResponses[422],
    429: writeErrorResponses[429],
  },
});

const listRoute = defineOpenAPIRoute(listMeta, {
  method: "get",
  path: "/api/v1/rate-cards",
  description: "Lists the firm's active (non-archived) rate cards, ordered by name.",
  responses: {
    200: {
      description: "The rate cards",
      content: { "application/json": { schema: RateCardListResponse } },
    },
    401: readErrorResponses[401],
    403: readErrorResponses[403],
    404: readErrorResponses[404],
    429: readErrorResponses[429],
  },
});

const appendRateRoute = defineOpenAPIRoute(appendRateMeta, {
  method: "post",
  path: "/api/v1/rate-cards/{id}/rates",
  description:
    "Appends an effective-dated rate version to the card. Closes the prior open rate for the same scope in the same batch so intervals stay contiguous and non-overlapping.",
  request: {
    headers: idempotencyKeyHeader,
    params: rateCardParam,
    body: { content: { "application/json": { schema: AppendRateRequest } }, required: true },
  },
  responses: {
    201: {
      description: "The rate was appended",
      content: { "application/json": { schema: RateAck } },
    },
    400: writeErrorResponses[400],
    401: writeErrorResponses[401],
    403: writeErrorResponses[403],
    404: writeErrorResponses[404],
    409: writeErrorResponses[409],
    422: writeErrorResponses[422],
    429: writeErrorResponses[429],
  },
});

const reRateDraftsRoute = defineOpenAPIRoute(reRateDraftsMeta, {
  method: "post",
  path: "/api/v1/rate-cards/{id}/re-rate-drafts",
  description:
    "Re-resolves and rewrites the rate on every unbilled (draft/submitted/approved) entry produced by this card over a work-date range. Opt-in retroactive correction — amounts never move silently.",
  request: {
    headers: idempotencyKeyHeader,
    params: rateCardParam,
    body: { content: { "application/json": { schema: ReRateDraftsRequest } }, required: true },
  },
  responses: {
    200: {
      description: "Re-rating complete",
      content: { "application/json": { schema: ReRateAck } },
    },
    400: writeErrorResponses[400],
    401: writeErrorResponses[401],
    403: writeErrorResponses[403],
    404: writeErrorResponses[404],
    409: writeErrorResponses[409],
    422: writeErrorResponses[422],
    429: writeErrorResponses[429],
  },
});

// Maps a RateValidationError to a typed problem response.
function rateErrorResponse(
  c: Context,
  error: RateValidationError,
): ProblemResponse<404> | ProblemResponse<422> {
  if (error.code === "rate-card-not-found") {
    return problemJson(c, {
      type: "not-found",
      title: "Not found",
      status: 404,
      detail: "No such rate card.",
    });
  }
  return problemJson(c, {
    type: "validation",
    title: "Invalid rate request",
    status: 422,
    detail: error.message,
  });
}

type RateCardsApp = OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>;

export function registerRateCardsRoutes(app: RateCardsApp, chokepoint: Chokepoint): void {
  // POST /api/v1/rate-cards — create a new rate card
  app.openapi(
    { ...createRoute, middleware: chokepointMiddleware(chokepoint, createRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { name } = c.req.valid("json");
      const now = () => new Date().toISOString();
      let result;
      try {
        result = await runIdempotentEffect({
          database: firm.firmDatabase,
          key: idempotency.key,
          fingerprint: idempotency.fingerprint,
          now,
          effect: async () => {
            const created = await createRateCard(
              firm.firmDatabase,
              { name },
              { clock: { now }, actorUserId: userId },
            );
            return {
              write: created.effect,
              responseCode: 201,
              responseBody: canonicalJsonStringify({ rateCardId: created.rateCardId }),
            };
          },
        });
      } catch (caught) {
        if (caught instanceof RateValidationError) return rateErrorResponse(c, caught);
        throw caught;
      }
      if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch")
        return problemResponseForIdempotencyConflict(c, result);
      if (result.kind === "replayed") c.header("Idempotency-Replayed", "true");
      return c.json(JSON.parse(result.responseBody ?? "{}") as z.infer<typeof RateCardAck>, 201);
    },
  );

  // GET /api/v1/rate-cards — list active rate cards, ordered by name
  app.openapi(
    { ...listRoute, middleware: chokepointMiddleware(chokepoint, listRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { results } = await listRateCardsStatement(firm.firmDatabase).all<{
        id: string;
        name: string;
      }>();
      return c.json({ data: results }, 200);
    },
  );

  // POST /api/v1/rate-cards/{id}/rates — append an effective-dated rate
  app.openapi(
    { ...appendRateRoute, middleware: chokepointMiddleware(chokepoint, appendRateRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { id } = c.req.valid("param");
      const body = c.req.valid("json");
      const now = () => new Date().toISOString();
      let result;
      try {
        result = await runIdempotentEffect({
          database: firm.firmDatabase,
          key: idempotency.key,
          fingerprint: idempotency.fingerprint,
          now,
          effect: async () => {
            const appended = await appendRate(
              firm.firmDatabase,
              {
                rateCardId: id as RateCardId,
                tier: body.tier,
                scopedId: body.scopedId ?? null,
                rateE4: body.rateE4,
                currency: body.currency,
                validFrom: body.validFrom,
              },
              { clock: { now }, actorUserId: userId },
            );
            return {
              write: appended.effect,
              responseCode: 201,
              responseBody: canonicalJsonStringify({ rateId: appended.rateId }),
            };
          },
        });
      } catch (caught) {
        if (caught instanceof RateValidationError) return rateErrorResponse(c, caught);
        throw caught;
      }
      if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch")
        return problemResponseForIdempotencyConflict(c, result);
      if (result.kind === "replayed") c.header("Idempotency-Replayed", "true");
      return c.json(JSON.parse(result.responseBody ?? "{}") as z.infer<typeof RateAck>, 201);
    },
  );

  // POST /api/v1/rate-cards/{id}/re-rate-drafts — retroactive re-rating
  app.openapi(
    { ...reRateDraftsRoute, middleware: chokepointMiddleware(chokepoint, reRateDraftsRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { id } = c.req.valid("param");
      const { fromDate, toDate } = c.req.valid("json");
      const now = () => new Date().toISOString();
      let result;
      try {
        result = await runIdempotentEffect({
          database: firm.firmDatabase,
          key: idempotency.key,
          fingerprint: idempotency.fingerprint,
          now,
          effect: async () => {
            const reRated = await reRateUnbilledDrafts(
              firm.firmDatabase,
              {
                rateCardId: id as RateCardId,
                fromDate,
                toDate,
              },
              { clock: { now }, actorUserId: userId },
            );
            return {
              write: reRated.effect,
              responseCode: 200,
              responseBody: canonicalJsonStringify({ count: reRated.count }),
            };
          },
        });
      } catch (caught) {
        if (caught instanceof RateValidationError) return rateErrorResponse(c, caught);
        throw caught;
      }
      if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch")
        return problemResponseForIdempotencyConflict(c, result);
      if (result.kind === "replayed") c.header("Idempotency-Replayed", "true");
      return c.json(JSON.parse(result.responseBody ?? "{}") as z.infer<typeof ReRateAck>, 200);
    },
  );
}
