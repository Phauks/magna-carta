import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import type { BatchDatabase, EffectWrite } from "@magna-carta/data-access/effect-batch";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import type { EntityType } from "@magna-carta/identifiers/registry";
import type { KnownPermission } from "@magna-carta/access-control/registry";
import type { Context } from "hono";
import type { Bindings } from "../../bindings.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointIdempotency,
  requireChokepointUserId,
} from "../../chokepoint/context-accessors.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { idempotencyKeyHeader, identifierPathParam } from "../../contracts/common.ts";
import { Problem, problemJson, type ProblemResponse } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";
import { problemResponseForIdempotencyConflict } from "../../idempotency-conflict-problems.ts";

// Classification types (matter types, document types) are per-firm classification rows: a name plus an
// optional short code, soft-deactivate only, name/code uniqueness owned by the domain package. The two
// route sets are byte-for-byte parallel (same zod shapes, same create/list/update/deactivate handlers,
// same idempotent-commit + error mapping); the only differences are the path prefix, the manage
// permission, the imported domain service, the validation-error class, and the schema/operation/noun
// names. This factory is the one home for that route shape — each domain's route module is a config
// plus one call.

// The domain service the routes drive: a create returning the minted id + effect, plus id-returning
// update/deactivate. The per-domain wrapper adapts its own service (whose create returns e.g.
// matterTypeId) to this normalized { id } shape.
export interface ClassificationTypeRouteService {
  create(
    database: BatchDatabase,
    input: { name: string; code: string | null },
    options: { clock: { now(): string }; actorUserId: ReturnType<typeof requireChokepointUserId> },
  ): Promise<{ id: string; effect: EffectWrite }>;
  update(
    database: BatchDatabase,
    id: string,
    patch: { name?: string; code?: string | null },
    options: { clock: { now(): string }; actorUserId: ReturnType<typeof requireChokepointUserId> },
  ): Promise<{ effect: EffectWrite }>;
  deactivate(
    database: BatchDatabase,
    id: string,
    options: { clock: { now(): string }; actorUserId: ReturnType<typeof requireChokepointUserId> },
  ): Promise<{ effect: EffectWrite }>;
}

// A domain validation error carries a stable machine-readable code and a human message.
interface ClassificationValidationError {
  readonly code: string;
  readonly message: string;
}

export interface ClassificationTypeRouteConfig {
  // Route surface: the REST collection segment (e.g. "matter-types") and the operationId namespace
  // (e.g. "matterTypes"). Both feed the emitted OpenAPI document, so they must stay stable.
  readonly pathPrefix: string;
  readonly operationNamespace: string;
  readonly managePermission: KnownPermission;
  readonly managePermissionDescription: string; // the 403 description naming the permission
  readonly idEntityType: EntityType; // the path-param identifier type
  readonly tableName: string; // the per-firm table the list query reads
  // The human noun woven into descriptions and titles ("matter type" / "document type") and the
  // capitalized form for an OpenAPI schema/registration name prefix ("MatterType" / "DocumentType").
  readonly noun: string;
  readonly schemaPrefix: string;
  // The four route descriptions (they differ in wording between domains).
  readonly descriptions: {
    readonly create: string;
    readonly list: string;
    readonly update: string;
    readonly deactivate: string;
  };
  readonly service: ClassificationTypeRouteService;
  readonly isValidationError: (error: unknown) => error is ClassificationValidationError;
  // The failure codes the domain raises, mapped to the HTTP problem the route returns.
  readonly errorCodes: {
    readonly unknown: string; // 404
    readonly nameTaken: string; // 409
    readonly codeTaken: string; // 409
  };
}

type TypesApp = OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>;

export function registerClassificationTypeRoutes(
  app: TypesApp,
  chokepoint: Chokepoint,
  config: ClassificationTypeRouteConfig,
): void {
  const TypeRequest = z
    .object({ name: z.string().min(1), code: z.string().min(1).nullable().optional() })
    .openapi(`${config.schemaPrefix}Request`);
  const PatchTypeRequest = z
    .object({ name: z.string().min(1).optional(), code: z.string().min(1).nullable().optional() })
    .openapi(`Patch${config.schemaPrefix}Request`);
  const TypeResponse = z
    .object({ id: z.string(), name: z.string(), code: z.string().nullable(), active: z.boolean() })
    .openapi(config.schemaPrefix);
  const TypeListResponse = z
    .object({ data: z.array(TypeResponse) })
    .openapi(`${config.schemaPrefix}ListResponse`);
  const IdAck = z.object({ id: z.string() }).openapi(`${config.schemaPrefix}Ack`);
  const typeParam = z.object({ id: identifierPathParam(config.idEntityType, "id") });

  const authErrors = {
    401: {
      description: "No valid session",
      content: { "application/problem+json": { schema: Problem } },
    },
    403: {
      description: config.managePermissionDescription,
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
      permission: config.managePermission,
      resource: "matter",
      audited: true,
      idempotency: "required",
      idempotencyStore: "firm",
      rateLimit: "default",
    };
  }

  const createTypeMeta = writeMeta(`${config.operationNamespace}.create`);
  const updateTypeMeta = writeMeta(`${config.operationNamespace}.update`);
  const deactivateTypeMeta = writeMeta(`${config.operationNamespace}.deactivate`);
  const listTypesMeta: RouteMeta = {
    operationId: `${config.operationNamespace}.list`,
    surface: "app",
    authenticated: true,
    permission: null,
    resource: "matter",
    audited: false,
    idempotency: "optional",
    rateLimit: "default",
  };

  const basePath = `/api/v1/${config.pathPrefix}`;

  const createTypeRoute = defineOpenAPIRoute(createTypeMeta, {
    method: "post",
    path: basePath,
    description: config.descriptions.create,
    request: {
      headers: idempotencyKeyHeader,
      body: { content: { "application/json": { schema: TypeRequest } }, required: true },
    },
    responses: {
      201: {
        description: `The ${config.noun} was created`,
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
    path: basePath,
    description: config.descriptions.list,
    responses: {
      200: {
        description: `The ${config.noun}s`,
        content: { "application/json": { schema: TypeListResponse } },
      },
      401: authErrors[401],
      404: authErrors[404],
      429: authErrors[429],
    },
  });

  const updateTypeRoute = defineOpenAPIRoute(updateTypeMeta, {
    method: "patch",
    path: `${basePath}/{id}`,
    description: config.descriptions.update,
    request: {
      headers: idempotencyKeyHeader,
      params: typeParam,
      body: { content: { "application/json": { schema: PatchTypeRequest } }, required: true },
    },
    responses: {
      200: {
        description: `The ${config.noun} was updated`,
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
    path: `${basePath}/{id}/deactivate`,
    description: config.descriptions.deactivate,
    request: { headers: idempotencyKeyHeader, params: typeParam },
    responses: {
      200: {
        description: `The ${config.noun} was deactivated`,
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
    error: ClassificationValidationError,
  ): ProblemResponse<404> | ProblemResponse<409> | ProblemResponse<422> {
    if (error.code === config.errorCodes.unknown) {
      return problemJson(c, {
        type: "not-found",
        title: "Not found",
        status: 404,
        detail: `No such ${config.noun}.`,
      });
    }
    if (error.code === config.errorCodes.nameTaken || error.code === config.errorCodes.codeTaken) {
      return problemJson(c, {
        type: "conflict",
        title: "Already in use",
        status: 409,
        detail: error.message,
      });
    }
    return problemJson(c, {
      type: "validation",
      title: `Invalid ${config.noun}`,
      status: 422,
      detail: error.message,
    });
  }

  // The shared commit path for the id-returning type mutations (update/deactivate): the domain call
  // returns an effect; commit it idempotently and answer the id ack, or map a refusal/conflict.
  async function commitTypeEffect(
    c: Context,
    database: BatchDatabase,
    idempotency: { key: string | undefined; fingerprint: string },
    id: string,
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
      if (config.isValidationError(caught)) return typeErrorResponse(c, caught);
      throw caught;
    }
    if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch") {
      return problemResponseForIdempotencyConflict(c, result);
    }
    if (result.kind === "replayed") c.header("Idempotency-Replayed", "true");
    return c.json(JSON.parse(result.responseBody ?? "{}") as z.infer<typeof IdAck>, 200);
  }

  app.openapi(
    {
      ...createTypeRoute,
      middleware: chokepointMiddleware(chokepoint, createTypeRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
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
            const created = await config.service.create(
              firm.firmDatabase,
              { name: request.name, code: request.code ?? null },
              { clock: { now }, actorUserId: userId },
            );
            return {
              write: created.effect,
              responseCode: 201,
              responseBody: canonicalJsonStringify({
                id: created.id,
                name: request.name,
                code: request.code ?? null,
                active: true,
              }),
            };
          },
        });
      } catch (caught) {
        if (config.isValidationError(caught)) return typeErrorResponse(c, caught);
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
      middleware: chokepointMiddleware(chokepoint, listTypesRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { results } = await firm.firmDatabase
        .prepare(`SELECT id, name, code, active FROM ${config.tableName} ORDER BY name`)
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
      middleware: chokepointMiddleware(chokepoint, updateTypeRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { id } = c.req.valid("param");
      const patch = c.req.valid("json");
      return commitTypeEffect(c, firm.firmDatabase, idempotency, id, () =>
        config.service.update(firm.firmDatabase, id, patch, {
          clock: { now: () => new Date().toISOString() },
          actorUserId: userId,
        }),
      );
    },
  );

  app.openapi(
    {
      ...deactivateTypeRoute,
      middleware: chokepointMiddleware(chokepoint, deactivateTypeRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { id } = c.req.valid("param");
      return commitTypeEffect(c, firm.firmDatabase, idempotency, id, () =>
        config.service.deactivate(firm.firmDatabase, id, {
          clock: { now: () => new Date().toISOString() },
          actorUserId: userId,
        }),
      );
    },
  );
}
