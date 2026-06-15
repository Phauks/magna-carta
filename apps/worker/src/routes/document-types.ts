import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import type { BatchDatabase, EffectWrite } from "@magna-carta/data-access/effect-batch";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import {
  createDocumentType,
  deactivateDocumentType,
  updateDocumentType,
} from "@magna-carta/file-manager/document-type-service";
import { FileManagerValidationError } from "@magna-carta/file-manager/validation";
import type { DocumentTypeId } from "@magna-carta/identifiers/types";
import type { Context } from "hono";
import type { Bindings } from "../app.ts";
import type { Chokepoint } from "../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointUserId,
} from "../chokepoint/context-accessors.ts";
import type { AppVariables } from "../chokepoint/ports.ts";
import { chokepointMiddleware } from "../chokepoint/register.ts";
import { idempotencyKeyHeader, identifierPathParam } from "../contracts/common.ts";
import { Problem, problemJson, type ProblemResponse } from "../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../contracts/route-meta.ts";
import { problemResponseForIdempotencyConflict } from "../idempotency-conflict-problems.ts";

// Document types: per-firm document classification labels, mirroring matter types (soft-deactivate
// only, name/code uniqueness owned by the file-manager package). Reads are open to any authenticated
// firm member; writes require files:manageDocumentTypes.

const TypeRequest = z
  .object({ name: z.string().min(1), code: z.string().min(1).nullable().optional() })
  .openapi("DocumentTypeRequest");
const PatchTypeRequest = z
  .object({ name: z.string().min(1).optional(), code: z.string().min(1).nullable().optional() })
  .openapi("PatchDocumentTypeRequest");
const TypeResponse = z
  .object({ id: z.string(), name: z.string(), code: z.string().nullable(), active: z.boolean() })
  .openapi("DocumentType");
const TypeListResponse = z
  .object({ data: z.array(TypeResponse) })
  .openapi("DocumentTypeListResponse");
const IdAck = z.object({ id: z.string() }).openapi("DocumentTypeAck");
const typeParam = z.object({ id: identifierPathParam("documentType", "id") });

const MANAGE = "files:manageDocumentTypes" as const;

const authErrors = {
  401: {
    description: "No valid session",
    content: { "application/problem+json": { schema: Problem } },
  },
  403: {
    description: "The session member lacks files:manageDocumentTypes",
    content: { "application/problem+json": { schema: Problem } },
  },
  404: {
    description: "The firm is unreachable, the member is deactivated, or the type is unknown",
    content: { "application/problem+json": { schema: Problem } },
  },
  409: {
    description:
      "A request with this Idempotency-Key is in progress, or the name/code is already in use",
    content: { "application/problem+json": { schema: Problem } },
  },
  422: {
    description:
      "The request is invalid, or the Idempotency-Key was reused with a different payload",
    content: { "application/problem+json": { schema: Problem } },
  },
  400: {
    description: "Missing Idempotency-Key (this operation requires one)",
    content: { "application/problem+json": { schema: Problem } },
  },
  429: {
    description: "Rate limit exceeded",
    content: { "application/problem+json": { schema: Problem } },
  },
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

const createTypeMeta = writeMeta("documentTypes.create");
const updateTypeMeta = writeMeta("documentTypes.update");
const deactivateTypeMeta = writeMeta("documentTypes.deactivate");
const listTypesMeta: RouteMeta = {
  operationId: "documentTypes.list",
  surface: "app",
  authenticated: true,
  permission: null,
  resource: "matter",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

const createTypeRoute = defineOpenAPIRoute(createTypeMeta, {
  method: "post",
  path: "/api/v1/document-types",
  description:
    "Creates a document type (a per-firm document classification label with an optional code).",
  request: {
    headers: idempotencyKeyHeader,
    body: { content: { "application/json": { schema: TypeRequest } }, required: true },
  },
  responses: {
    201: {
      description: "The document type was created",
      content: { "application/json": { schema: TypeResponse } },
    },
    400: authErrors[400],
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    409: authErrors[409],
    422: authErrors[422],
    429: authErrors[429],
  },
});

const listTypesRoute = defineOpenAPIRoute(listTypesMeta, {
  method: "get",
  path: "/api/v1/document-types",
  description: "Lists the firm's document types (active and deactivated), ordered by name.",
  responses: {
    200: {
      description: "The document types",
      content: { "application/json": { schema: TypeListResponse } },
    },
    401: authErrors[401],
    404: authErrors[404],
    429: authErrors[429],
  },
});

const updateTypeRoute = defineOpenAPIRoute(updateTypeMeta, {
  method: "patch",
  path: "/api/v1/document-types/{id}",
  description: "Updates a document type's name or code.",
  request: {
    headers: idempotencyKeyHeader,
    params: typeParam,
    body: { content: { "application/json": { schema: PatchTypeRequest } }, required: true },
  },
  responses: {
    200: {
      description: "The document type was updated",
      content: { "application/json": { schema: IdAck } },
    },
    400: authErrors[400],
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    409: authErrors[409],
    422: authErrors[422],
    429: authErrors[429],
  },
});

const deactivateTypeRoute = defineOpenAPIRoute(deactivateTypeMeta, {
  method: "post",
  path: "/api/v1/document-types/{id}/deactivate",
  description:
    "Soft-deactivates a document type (historical documents keep their type; it is never deleted).",
  request: { headers: idempotencyKeyHeader, params: typeParam },
  responses: {
    200: {
      description: "The document type was deactivated",
      content: { "application/json": { schema: IdAck } },
    },
    400: authErrors[400],
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    409: authErrors[409],
    422: authErrors[422],
    429: authErrors[429],
  },
});

function typeErrorResponse(
  c: Context,
  error: FileManagerValidationError,
): ProblemResponse<404> | ProblemResponse<409> | ProblemResponse<422> {
  if (error.code === "unknown-document-type") {
    return problemJson(c, {
      type: "not-found",
      title: "Not found",
      status: 404,
      detail: "No such document type.",
    });
  }
  if (error.code === "document-type-name-taken" || error.code === "document-type-code-taken") {
    return problemJson(c, {
      type: "conflict",
      title: "Already in use",
      status: 409,
      detail: error.message,
    });
  }
  return problemJson(c, {
    type: "validation",
    title: "Invalid document type",
    status: 422,
    detail: error.message,
  });
}

function requireIdempotency(c: Context): { key: string | undefined; fingerprint: string } {
  const idempotency = c.get("idempotency");
  if (idempotency === undefined) {
    throw new Error(
      "idempotency context missing — the chokepoint idempotency gate did not run on a required-idempotency route",
    );
  }
  return { key: idempotency.key, fingerprint: idempotency.fingerprint };
}

type TypesApp = OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>;

export function registerDocumentTypesRoutes(app: TypesApp, chokepoint: Chokepoint): void {
  app.openapi(
    {
      ...createTypeRoute,
      middleware: chokepointMiddleware(chokepoint, createTypeMeta, createTypeRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireIdempotency(c);
      const request = c.req.valid("json");
      const now = () => new Date().toISOString();
      let result;
      try {
        result = await runIdempotentEffect({
          database: firm.firmDatabase,
          key: idempotency.key,
          fingerprint: idempotency.fingerprint,
          now,
          effect: async () => {
            const created = await createDocumentType(
              firm.firmDatabase,
              { name: request.name, code: request.code ?? null },
              { clock: { now }, actorUserId: userId },
            );
            return {
              write: created.effect,
              responseCode: 201,
              responseBody: canonicalJsonStringify({
                id: created.documentTypeId,
                name: request.name,
                code: request.code ?? null,
                active: true,
              }),
            };
          },
        });
      } catch (caught) {
        if (caught instanceof FileManagerValidationError) return typeErrorResponse(c, caught);
        throw caught;
      }
      if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch") {
        return problemResponseForIdempotencyConflict(c, result);
      }
      if (result.kind === "replayed") c.header("Idempotency-Replayed", "true");
      return c.json(JSON.parse(result.responseBody ?? "{}") as z.infer<typeof TypeResponse>, 201);
    },
  );

  app.openapi(
    {
      ...listTypesRoute,
      middleware: chokepointMiddleware(chokepoint, listTypesMeta, listTypesRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { results } = await firm.firmDatabase
        .prepare("SELECT id, name, code, active FROM document_type ORDER BY name")
        .all<{ id: string; name: string; code: string | null; active: number }>();
      return c.json(
        {
          data: results.map((row) => ({
            id: row.id,
            name: row.name,
            code: row.code,
            active: row.active === 1,
          })),
        },
        200,
      );
    },
  );

  app.openapi(
    {
      ...updateTypeRoute,
      middleware: chokepointMiddleware(chokepoint, updateTypeMeta, updateTypeRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireIdempotency(c);
      const { id } = c.req.valid("param");
      const patch = c.req.valid("json");
      return commitTypeEffect(c, firm.firmDatabase, idempotency, id, () =>
        updateDocumentType(firm.firmDatabase, id, patch, {
          clock: { now: () => new Date().toISOString() },
          actorUserId: userId,
        }),
      );
    },
  );

  app.openapi(
    {
      ...deactivateTypeRoute,
      middleware: chokepointMiddleware(chokepoint, deactivateTypeMeta, deactivateTypeRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireIdempotency(c);
      const { id } = c.req.valid("param");
      return commitTypeEffect(c, firm.firmDatabase, idempotency, id, () =>
        deactivateDocumentType(firm.firmDatabase, id, {
          clock: { now: () => new Date().toISOString() },
          actorUserId: userId,
        }),
      );
    },
  );
}

// The shared commit path for the id-returning document-type mutations (update/deactivate).
async function commitTypeEffect(
  c: Context,
  database: BatchDatabase,
  idempotency: { key: string | undefined; fingerprint: string },
  id: DocumentTypeId,
  call: () => Promise<{ effect: EffectWrite }>,
) {
  const now = () => new Date().toISOString();
  let result;
  try {
    result = await runIdempotentEffect({
      database,
      key: idempotency.key,
      fingerprint: idempotency.fingerprint,
      now,
      effect: async () => {
        const { effect } = await call();
        return { write: effect, responseCode: 200, responseBody: canonicalJsonStringify({ id }) };
      },
    });
  } catch (caught) {
    if (caught instanceof FileManagerValidationError) return typeErrorResponse(c, caught);
    throw caught;
  }
  if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch") {
    return problemResponseForIdempotencyConflict(c, result);
  }
  if (result.kind === "replayed") c.header("Idempotency-Replayed", "true");
  return c.json(JSON.parse(result.responseBody ?? "{}") as z.infer<typeof IdAck>, 200);
}
