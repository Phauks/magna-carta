import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import {
  createNonBillableCategory,
  updateNonBillableCategory,
  archiveNonBillableCategory,
} from "@magna-carta/timekeeping/non-billable-category-service";
import { listNonBillableCategoriesStatement } from "@magna-carta/timekeeping/non-billable-category-statements";
import { TimeEntryValidationError } from "@magna-carta/timekeeping/time-entry-validation";
import type { NonBillableCategoryId } from "@magna-carta/identifiers/types";
import type { Context } from "hono";
import type { Bindings } from "../../bindings.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointUserId,
  requireChokepointIdempotency,
} from "../../chokepoint/context-accessors.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { idempotencyKeyHeader, identifierPathParam } from "../../contracts/common.ts";
import { Problem, problemJson, type ProblemResponse } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";
import { problemResponseForIdempotencyConflict } from "../../idempotency-conflict-problems.ts";

// Non-billable category management: create, rename, and soft-archive categories that a timekeeper
// attaches to non-billable time. Soft-archive only — a category with historical entries pointing at
// it is never hard-deleted. All writes require time:manageSettings.

const MANAGE = "time:manageSettings" as const;

const CreateNonBillableCategoryRequest = z
  .object({ name: z.string().min(1) })
  .openapi("CreateNonBillableCategoryRequest");

const PatchNonBillableCategoryRequest = z
  .object({ name: z.string().min(1) })
  .openapi("PatchNonBillableCategoryRequest");

const NonBillableCategoryAck = z
  .object({ nonBillableCategoryId: z.string() })
  .openapi("NonBillableCategoryAck");

const NonBillableCategorySummary = z
  .object({
    id: z.string(),
    name: z.string(),
    archivedAt: z.string().nullable(),
  })
  .openapi("NonBillableCategorySummary");

const NonBillableCategoryListResponse = z
  .object({ data: z.array(NonBillableCategorySummary) })
  .openapi("NonBillableCategoryListResponse");

const categoryParam = z.object({ id: identifierPathParam("nonBillableCategory", "id") });

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
    description: "The session member lacks time:manageSettings",
    content: { "application/problem+json": { schema: Problem } },
  },
  404: {
    description: "The firm is unreachable, the member is deactivated, or the category is unknown",
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

const createMeta = writeMeta("nonBillableCategories.create");
const updateMeta = writeMeta("nonBillableCategories.update");
const archiveMeta = writeMeta("nonBillableCategories.archive");
const listMeta: RouteMeta = {
  operationId: "nonBillableCategories.list",
  surface: "app",
  authenticated: true,
  permission: MANAGE,
  resource: "matter",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

const createRoute = defineOpenAPIRoute(createMeta, {
  method: "post",
  path: "/api/v1/non-billable-categories",
  description: "Creates a non-billable time category.",
  request: {
    headers: idempotencyKeyHeader,
    body: {
      content: { "application/json": { schema: CreateNonBillableCategoryRequest } },
      required: true,
    },
  },
  responses: {
    201: {
      description: "The category was created",
      content: { "application/json": { schema: NonBillableCategoryAck } },
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
  path: "/api/v1/non-billable-categories",
  description: "Lists active (non-archived) non-billable categories, ordered by name.",
  responses: {
    200: {
      description: "The categories",
      content: { "application/json": { schema: NonBillableCategoryListResponse } },
    },
    401: readErrorResponses[401],
    403: readErrorResponses[403],
    404: readErrorResponses[404],
    429: readErrorResponses[429],
  },
});

const updateRoute = defineOpenAPIRoute(updateMeta, {
  method: "patch",
  path: "/api/v1/non-billable-categories/{id}",
  description: "Renames a non-billable category.",
  request: {
    headers: idempotencyKeyHeader,
    params: categoryParam,
    body: {
      content: { "application/json": { schema: PatchNonBillableCategoryRequest } },
      required: true,
    },
  },
  responses: {
    200: {
      description: "The category was updated",
      content: { "application/json": { schema: NonBillableCategoryAck } },
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

const archiveRoute = defineOpenAPIRoute(archiveMeta, {
  method: "post",
  path: "/api/v1/non-billable-categories/{id}/archive",
  description:
    "Soft-archives a non-billable category. Historical entries that reference it remain intact.",
  request: {
    headers: idempotencyKeyHeader,
    params: categoryParam,
  },
  responses: {
    200: {
      description: "The category was archived",
      content: { "application/json": { schema: NonBillableCategoryAck } },
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

// Maps a TimeEntryValidationError from the non-billable category service to a typed problem response.
function categoryErrorResponse(
  c: Context,
  error: TimeEntryValidationError,
): ProblemResponse<404> | ProblemResponse<422> {
  if (error.code === "not-found") {
    return problemJson(c, {
      type: "not-found",
      title: "Not found",
      status: 404,
      detail: "No such non-billable category.",
    });
  }
  return problemJson(c, {
    type: "validation",
    title: "Invalid category request",
    status: 422,
    detail: error.message,
  });
}

type NonBillableCategoriesApp = OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>;

export function registerNonBillableCategoriesRoutes(
  app: NonBillableCategoriesApp,
  chokepoint: Chokepoint,
): void {
  // POST /api/v1/non-billable-categories — create
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
            const created = await createNonBillableCategory(
              firm.firmDatabase,
              { name },
              { clock: { now }, actorUserId: userId },
            );
            return {
              write: created.effect,
              responseCode: 201,
              responseBody: canonicalJsonStringify({
                nonBillableCategoryId: created.nonBillableCategoryId,
              }),
            };
          },
        });
      } catch (caught) {
        if (caught instanceof TimeEntryValidationError) return categoryErrorResponse(c, caught);
        throw caught;
      }
      if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch")
        return problemResponseForIdempotencyConflict(c, result);
      if (result.kind === "replayed") c.header("Idempotency-Replayed", "true");
      return c.json(
        JSON.parse(result.responseBody ?? "{}") as z.infer<typeof NonBillableCategoryAck>,
        201,
      );
    },
  );

  // GET /api/v1/non-billable-categories — list active categories, ordered by name
  app.openapi(
    { ...listRoute, middleware: chokepointMiddleware(chokepoint, listRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { results } = await listNonBillableCategoriesStatement(firm.firmDatabase).all<{
        id: string;
        name: string;
        archived_at: string | null;
      }>();
      return c.json(
        {
          data: results.map((row) => ({
            id: row.id,
            name: row.name,
            archivedAt: row.archived_at,
          })),
        },
        200,
      );
    },
  );

  // PATCH /api/v1/non-billable-categories/{id} — rename
  app.openapi(
    { ...updateRoute, middleware: chokepointMiddleware(chokepoint, updateRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { id } = c.req.valid("param");
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
            const updated = await updateNonBillableCategory(
              firm.firmDatabase,
              id as NonBillableCategoryId,
              { name },
              { clock: { now }, actorUserId: userId },
            );
            return {
              write: updated.effect,
              responseCode: 200,
              responseBody: canonicalJsonStringify({
                nonBillableCategoryId: updated.nonBillableCategoryId,
              }),
            };
          },
        });
      } catch (caught) {
        if (caught instanceof TimeEntryValidationError) return categoryErrorResponse(c, caught);
        throw caught;
      }
      if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch")
        return problemResponseForIdempotencyConflict(c, result);
      if (result.kind === "replayed") c.header("Idempotency-Replayed", "true");
      return c.json(
        JSON.parse(result.responseBody ?? "{}") as z.infer<typeof NonBillableCategoryAck>,
        200,
      );
    },
  );

  // POST /api/v1/non-billable-categories/{id}/archive — soft-archive
  app.openapi(
    { ...archiveRoute, middleware: chokepointMiddleware(chokepoint, archiveRoute) },
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
            const archived = await archiveNonBillableCategory(
              firm.firmDatabase,
              id as NonBillableCategoryId,
              { clock: { now }, actorUserId: userId },
            );
            return {
              write: archived.effect,
              responseCode: 200,
              responseBody: canonicalJsonStringify({
                nonBillableCategoryId: archived.nonBillableCategoryId,
              }),
            };
          },
        });
      } catch (caught) {
        if (caught instanceof TimeEntryValidationError) return categoryErrorResponse(c, caught);
        throw caught;
      }
      if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch")
        return problemResponseForIdempotencyConflict(c, result);
      if (result.kind === "replayed") c.header("Idempotency-Replayed", "true");
      return c.json(
        JSON.parse(result.responseBody ?? "{}") as z.infer<typeof NonBillableCategoryAck>,
        200,
      );
    },
  );
}
