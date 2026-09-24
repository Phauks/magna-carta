import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import { createNarrativeTemplate } from "@magna-carta/timekeeping/narrative-template-service";
import {
  listNarrativeTemplatesStatement,
  recentNarrativesStatement,
} from "@magna-carta/timekeeping/narrative-template-statements";
import { TimeEntryValidationError } from "@magna-carta/timekeeping/time-entry-validation";
import type { Context } from "hono";
import type { Bindings } from "../../../bindings.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointUserId,
  requireChokepointIdempotency,
} from "../../chokepoint/context-accessors.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { idempotencyKeyHeader, identifierField } from "../../contracts/common.ts";
import { Problem, problemJson, type ProblemResponse } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";
import { problemResponseForIdempotencyConflict } from "../../idempotency-conflict-problems.ts";

// Narrative template management: create and archive canonical narrative snippets that speed up
// time entry with one-tap pre-fill of narrative and optional rate. All writes require
// time:manageSettings. Recent narratives (read-only) require time:track.

const MANAGE = "time:manageSettings" as const;
const TRACK = "time:track" as const;

const CreateNarrativeTemplateRequest = z
  .object({
    narrativeTemplate: z.string().min(1),
    utbmsTaskCodeId: identifierField("utbmsCode").nullable().optional(),
    defaultRateE4: z.number().int().positive().nullable().optional(),
  })
  .openapi("CreateNarrativeTemplateRequest");

const NarrativeTemplateAck = z
  .object({ narrativeTemplateId: z.string() })
  .openapi("NarrativeTemplateAck");

const NarrativeTemplateSummary = z
  .object({
    id: z.string(),
    narrativeTemplate: z.string(),
    utbmsTaskCodeId: z.string().nullable(),
    defaultRateE4: z.number().int().nullable(),
  })
  .openapi("NarrativeTemplateSummary");

const NarrativeTemplateListResponse = z
  .object({ data: z.array(NarrativeTemplateSummary) })
  .openapi("NarrativeTemplateListResponse");

const RecentNarrativesResponse = z
  .object({ data: z.array(z.string()) })
  .openapi("RecentNarrativesResponse");

const recentNarrativesQuery = z.object({
  timekeeperUserId: identifierField("user"),
  limit: z
    .string()
    .regex(/^\d+$/)
    .transform((v) => parseInt(v, 10))
    .pipe(z.number().int().positive().max(50)),
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
    description: "The session member lacks the required capability",
    content: { "application/problem+json": { schema: Problem } },
  },
  404: {
    description: "The firm is unreachable or the member is deactivated",
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

const createMeta = writeMeta("narrativeTemplates.create");
const listMeta: RouteMeta = {
  operationId: "narrativeTemplates.list",
  surface: "app",
  authenticated: true,
  permission: MANAGE,
  resource: "matter",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};
// Recent narratives: read-only, timekeeper-scoped, requires only time:track.
const recentNarrativesMeta: RouteMeta = {
  operationId: "narrativeTemplates.recentNarratives",
  surface: "app",
  authenticated: true,
  permission: TRACK,
  resource: "matter",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

const createRoute = defineOpenAPIRoute(createMeta, {
  method: "post",
  path: "/api/v1/narrative-templates",
  description:
    "Creates a narrative template. A template pre-fills narrative and optional rate for one-tap entry.",
  request: {
    headers: idempotencyKeyHeader,
    body: {
      content: { "application/json": { schema: CreateNarrativeTemplateRequest } },
      required: true,
    },
  },
  responses: {
    201: {
      description: "The template was created",
      content: { "application/json": { schema: NarrativeTemplateAck } },
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
  path: "/api/v1/narrative-templates",
  description: "Lists active (non-archived) narrative templates, ordered by creation date.",
  responses: {
    200: {
      description: "The templates",
      content: { "application/json": { schema: NarrativeTemplateListResponse } },
    },
    401: readErrorResponses[401],
    403: readErrorResponses[403],
    404: readErrorResponses[404],
    429: readErrorResponses[429],
  },
});

// Must be registered BEFORE any /{id}/* routes so the literal path segment "recent-narratives"
// matches first.
const recentNarrativesRoute = defineOpenAPIRoute(recentNarrativesMeta, {
  method: "get",
  path: "/api/v1/narrative-templates/recent-narratives",
  description:
    "Returns the authenticated timekeeper's own distinct recent narratives, most recently used first. The timekeeperUserId param must match the session user — narrative history is personal typing-autocomplete and may not be read cross-user.",
  request: { query: recentNarrativesQuery },
  responses: {
    200: {
      description: "The recent narratives",
      content: { "application/json": { schema: RecentNarrativesResponse } },
    },
    401: readErrorResponses[401],
    403: readErrorResponses[403],
    404: readErrorResponses[404],
    429: readErrorResponses[429],
  },
});

function templateErrorResponse(
  c: Context,
  error: TimeEntryValidationError,
): ProblemResponse<404> | ProblemResponse<422> {
  if (error.code === "not-found") {
    return problemJson(c, {
      type: "not-found",
      title: "Not found",
      status: 404,
      detail: "No such narrative template.",
    });
  }
  return problemJson(c, {
    type: "validation",
    title: "Invalid narrative template request",
    status: 422,
    detail: error.message,
  });
}

type NarrativeTemplatesApp = OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>;

export function registerNarrativeTemplatesRoutes(
  app: NarrativeTemplatesApp,
  chokepoint: Chokepoint,
): void {
  // POST /api/v1/narrative-templates — create
  app.openapi(
    { ...createRoute, middleware: chokepointMiddleware(chokepoint, createRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
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
            const created = await createNarrativeTemplate(
              firm.firmDatabase,
              {
                narrativeTemplate: body.narrativeTemplate,
                utbmsTaskCodeId: body.utbmsTaskCodeId ?? undefined,
                defaultRateE4: body.defaultRateE4 ?? undefined,
              },
              { clock: { now }, actorUserId: userId },
            );
            return {
              write: created.effect,
              responseCode: 201,
              responseBody: canonicalJsonStringify({
                narrativeTemplateId: created.narrativeTemplateId,
              }),
            };
          },
        });
      } catch (caught) {
        if (caught instanceof TimeEntryValidationError) return templateErrorResponse(c, caught);
        throw caught;
      }
      if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch")
        return problemResponseForIdempotencyConflict(c, result);
      if (result.kind === "replayed") c.header("Idempotency-Replayed", "true");
      return c.json(
        JSON.parse(result.responseBody ?? "{}") as z.infer<typeof NarrativeTemplateAck>,
        201,
      );
    },
  );

  // GET /api/v1/narrative-templates — list active templates
  app.openapi(
    { ...listRoute, middleware: chokepointMiddleware(chokepoint, listRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { results } = await listNarrativeTemplatesStatement(firm.firmDatabase).all<{
        id: string;
        utbms_task_code_id: string | null;
        narrative_template: string;
        default_rate_e4: number | null;
        archived_at: string | null;
      }>();
      return c.json(
        {
          data: results.map((row) => ({
            id: row.id,
            narrativeTemplate: row.narrative_template,
            utbmsTaskCodeId: row.utbms_task_code_id,
            defaultRateE4: row.default_rate_e4,
          })),
        },
        200,
      );
    },
  );

  // GET /api/v1/narrative-templates/recent-narratives — own recent narratives only
  // Registered BEFORE any /{id}/* routes so the literal path segment "recent-narratives" matches first.
  // Narrative history is personal typing-autocomplete: the timekeeperUserId param must match the
  // session user. Any other value is refused with 403 — this is not a cross-user read.
  app.openapi(
    {
      ...recentNarrativesRoute,
      middleware: chokepointMiddleware(chokepoint, recentNarrativesRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const sessionUserId = requireChokepointUserId(c);
      const { timekeeperUserId, limit } = c.req.valid("query");
      if (timekeeperUserId !== sessionUserId) {
        return problemJson(c, {
          type: "permission-denied",
          title: "Forbidden",
          status: 403,
          detail: "Recent narratives may only be read for the authenticated user.",
        });
      }
      const { results } = await recentNarrativesStatement(
        firm.firmDatabase,
        sessionUserId,
        limit,
      ).all<{ narrative: string }>();
      return c.json({ data: results.map((row) => row.narrative) }, 200);
    },
  );
}
