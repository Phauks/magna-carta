import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import { enableUtbmsCode, disableUtbmsCode } from "@magna-carta/timekeeping/utbms-service";
import { listUtbmsCodesBySetStatement } from "@magna-carta/timekeeping/utbms-statements";
import { TimeEntryValidationError } from "@magna-carta/timekeeping/time-entry-validation";
import type { UtbmsCodeId } from "@magna-carta/identifiers/types";
import type { Bindings } from "../../../bindings.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointUserId,
  requireChokepointIdempotency,
} from "../../chokepoint/context-accessors.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { idempotencyKeyHeader } from "../../contracts/common.ts";
import { Problem, problemJson } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";
import { problemResponseForIdempotencyConflict } from "../../idempotency-conflict-problems.ts";

// UTBMS code catalog management: list the published ABA code sets, enable/disable individual codes.
// The firm toggles from the seeded catalog only — no code is created through this surface.
// All mutations require time:manageUtbms.

const MANAGE = "time:manageUtbms" as const;

const UtbmsCodeSummary = z
  .object({
    id: z.string(),
    codeSet: z.string(),
    code: z.string(),
    label: z.string(),
    practiceArea: z.string().nullable(),
    active: z.number().int(),
  })
  .openapi("UtbmsCodeSummary");

const UtbmsCodeListResponse = z
  .object({ data: z.array(UtbmsCodeSummary) })
  .openapi("UtbmsCodeListResponse");

const UtbmsCodeAck = z.object({ utbmsCodeId: z.string() }).openapi("UtbmsCodeAck");

// UTBMS code ids are seeded from the ABA catalog using a deterministic handle format
// (utbmsCode_<codeSet>_<code>) rather than the standard nanoid-21 pattern. Enforces the
// utbmsCode_ prefix so the path param matches the seeded id format; the service pre-reads
// existence and returns a clear not-found refusal for any id that does not match a seeded row.
const utbmsCodeParam = z.object({
  id: z
    .string()
    .min(1)
    .regex(/^utbmsCode_/, "id must start with the utbmsCode_ prefix")
    .openapi({ param: { name: "id", in: "path" } }),
});

const listQuery = z.object({
  codeSet: z.enum(["task", "activity", "expense"]),
});

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
    description: "The session member lacks time:manageUtbms",
    content: { "application/problem+json": { schema: Problem } },
  },
  404: {
    description: "The firm is unreachable, the member is deactivated, or the code is unknown",
    content: { "application/problem+json": { schema: Problem } },
  },
  409: {
    description: "A request with this Idempotency-Key is in progress",
    content: { "application/problem+json": { schema: Problem } },
  },
  422: {
    description:
      "The request is invalid or the Idempotency-Key was reused with a different payload",
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
    permission: MANAGE,
    resource: "matter",
    audited: true,
    idempotency: "required",
    idempotencyStore: "firm",
    rateLimit: "default",
  };
}

const enableMeta = writeMeta("utbmsCodes.enable");
const disableMeta = writeMeta("utbmsCodes.disable");
const listMeta: RouteMeta = {
  operationId: "utbmsCodes.list",
  surface: "app",
  authenticated: true,
  permission: MANAGE,
  resource: "matter",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

const listRoute = defineOpenAPIRoute(listMeta, {
  method: "get",
  path: "/api/v1/utbms-codes",
  description:
    "Lists the firm's UTBMS codes for the given ABA set (task, activity, or expense), ordered by code.",
  request: { query: listQuery },
  responses: {
    200: {
      description: "The UTBMS codes",
      content: { "application/json": { schema: UtbmsCodeListResponse } },
    },
    401: readErrorResponses[401],
    403: readErrorResponses[403],
    404: readErrorResponses[404],
    429: readErrorResponses[429],
  },
});

const enableRoute = defineOpenAPIRoute(enableMeta, {
  method: "post",
  path: "/api/v1/utbms-codes/{id}/enable",
  description: "Enables a seeded UTBMS code so it appears in the entry UI and billing exports.",
  request: {
    headers: idempotencyKeyHeader,
    params: utbmsCodeParam,
  },
  responses: {
    200: {
      description: "The code was enabled",
      content: { "application/json": { schema: UtbmsCodeAck } },
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

const disableRoute = defineOpenAPIRoute(disableMeta, {
  method: "post",
  path: "/api/v1/utbms-codes/{id}/disable",
  description: "Disables a seeded UTBMS code so it no longer appears in the entry UI.",
  request: {
    headers: idempotencyKeyHeader,
    params: utbmsCodeParam,
  },
  responses: {
    200: {
      description: "The code was disabled",
      content: { "application/json": { schema: UtbmsCodeAck } },
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

type UtbmsApp = OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>;

export function registerUtbmsCodesRoutes(app: UtbmsApp, chokepoint: Chokepoint): void {
  // GET /api/v1/utbms-codes?codeSet=task|activity|expense — list codes in a set
  app.openapi(
    { ...listRoute, middleware: chokepointMiddleware(chokepoint, listRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { codeSet } = c.req.valid("query");
      const { results } = await listUtbmsCodesBySetStatement(firm.firmDatabase, codeSet).all<{
        id: string;
        code_set: string;
        code: string;
        label: string;
        practice_area: string | null;
        active: number;
      }>();
      return c.json(
        {
          data: results.map((row) => ({
            id: row.id,
            codeSet: row.code_set,
            code: row.code,
            label: row.label,
            practiceArea: row.practice_area,
            active: row.active,
          })),
        },
        200,
      );
    },
  );

  // POST /api/v1/utbms-codes/{id}/enable — enable a code
  app.openapi(
    { ...enableRoute, middleware: chokepointMiddleware(chokepoint, enableRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { id } = c.req.valid("param");
      const now = () => new Date().toISOString();
      let result;
      try {
        result = await runIdempotentEffect({
          database: firm.firmDatabase,
          key: idempotency.key,
          fingerprint: idempotency.fingerprint,
          now,
          effect: async () => {
            const toggled = await enableUtbmsCode(firm.firmDatabase, id as UtbmsCodeId, {
              clock: { now },
              actorUserId: userId,
            });
            return {
              write: toggled.effect,
              responseCode: 200,
              responseBody: canonicalJsonStringify({ utbmsCodeId: toggled.utbmsCodeId }),
            };
          },
        });
      } catch (caught) {
        if (caught instanceof TimeEntryValidationError && caught.code === "not-found") {
          return problemJson(c, {
            type: "not-found",
            title: "Not found",
            status: 404,
            detail: "No such UTBMS code.",
          });
        }
        throw caught;
      }
      if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch")
        return problemResponseForIdempotencyConflict(c, result);
      if (result.kind === "replayed") c.header("Idempotency-Replayed", "true");
      return c.json(JSON.parse(result.responseBody ?? "{}") as z.infer<typeof UtbmsCodeAck>, 200);
    },
  );

  // POST /api/v1/utbms-codes/{id}/disable — disable a code
  app.openapi(
    { ...disableRoute, middleware: chokepointMiddleware(chokepoint, disableRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { id } = c.req.valid("param");
      const now = () => new Date().toISOString();
      let result;
      try {
        result = await runIdempotentEffect({
          database: firm.firmDatabase,
          key: idempotency.key,
          fingerprint: idempotency.fingerprint,
          now,
          effect: async () => {
            const toggled = await disableUtbmsCode(firm.firmDatabase, id as UtbmsCodeId, {
              clock: { now },
              actorUserId: userId,
            });
            return {
              write: toggled.effect,
              responseCode: 200,
              responseBody: canonicalJsonStringify({ utbmsCodeId: toggled.utbmsCodeId }),
            };
          },
        });
      } catch (caught) {
        if (caught instanceof TimeEntryValidationError && caught.code === "not-found") {
          return problemJson(c, {
            type: "not-found",
            title: "Not found",
            status: 404,
            detail: "No such UTBMS code.",
          });
        }
        throw caught;
      }
      if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch")
        return problemResponseForIdempotencyConflict(c, result);
      if (result.kind === "replayed") c.header("Idempotency-Replayed", "true");
      return c.json(JSON.parse(result.responseBody ?? "{}") as z.infer<typeof UtbmsCodeAck>, 200);
    },
  );
}
