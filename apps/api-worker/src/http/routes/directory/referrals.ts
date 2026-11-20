import { type OpenAPIHono, z } from "@hono/zod-openapi";
import type { DirectoryWriteOptions } from "@magna-carta/directory/audit";
import {
  CreateReferralSourceRequest,
  DirectoryEntityReferralResponse,
  DirectoryReferralSource,
  DirectoryReferralSourcesResponse,
  directoryEntityIdPattern,
  SetEntityReferralRequest,
  UpdateReferralSourceRequest,
} from "@magna-carta/directory/contract";
import { MergedEntityError, UnknownEntityError } from "@magna-carta/directory/entity-kind";
import {
  createReferralSource,
  listReferralSources,
  readEntityReferral,
  ReferralSourceNameError,
  ReferralSourceNotFoundError,
  ReferralSourceRetiredError,
  SelfReferralError,
  setEntityReferral,
  updateReferralSource,
  type EntityReferral,
  type ReferralSourceRow,
} from "@magna-carta/directory/referrals";
import {
  DirectoryIdempotencyConflictError,
  type DirectoryIdempotencyContext,
} from "@magna-carta/directory/run-directory-effect";
import { cryptoRandomSource } from "@magna-carta/identifiers/random";
import { identifierPattern } from "@magna-carta/identifiers/validate";
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
import { idempotencyKeyHeader } from "../../contracts/common.ts";
import { Problem, problemJson } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";
import { problemResponseForIdempotencyConflict } from "../../idempotency-conflict-problems.ts";

// HOW A CLIENT FOUND THE FIRM: the firm's list of referral sources, and one record's referral (a
// source, the person or organization who referred them, or both).
//
// Reads take no permission beyond the session, like every other directory read. Every write takes
// the directory's edit permission and its idempotency key, the category list's terms: the source
// list is the same kind of firm vocabulary, kept by the same people.

const WRITE_PERMISSION = "directory:edit" as const;

const entityParam = z.object({
  id: z
    .string()
    .regex(directoryEntityIdPattern)
    .openapi({ param: { name: "id", in: "path" } }),
});

const sourceParam = z.object({
  id: z
    .string()
    .regex(identifierPattern("directoryReferralSource"))
    .openapi({ param: { name: "id", in: "path" } }),
});

const problem = (description: string) => ({
  description,
  content: { "application/problem+json": { schema: Problem } },
});

const errors = {
  400: problem("Missing Idempotency-Key (this operation requires one)"),
  401: problem("No valid session"),
  403: problem("The session member lacks directory:edit"),
  404: problem("The record or the source is unknown"),
  409: problem("The record was merged into another, or the Idempotency-Key is still in progress"),
  422: problem(
    "The request is invalid (a retired source, a record named as its own referrer, an empty name), or the Idempotency-Key was reused",
  ),
  429: problem("Rate limit exceeded"),
} as const;

function readMeta(operationId: string): RouteMeta {
  return {
    operationId,
    surface: "app",
    authenticated: true,
    permission: null,
    resource: "directoryEntity",
    audited: false,
    idempotency: "optional",
    rateLimit: "default",
  };
}

function writeMeta(operationId: string): RouteMeta {
  return {
    operationId,
    surface: "app",
    authenticated: true,
    permission: WRITE_PERMISSION,
    resource: "directoryEntity",
    audited: true,
    idempotency: "required",
    idempotencyStore: "firm",
    rateLimit: "default",
  };
}

const listSourcesRoute = defineOpenAPIRoute(readMeta("directory.listReferralSources"), {
  method: "get",
  path: "/api/v1/directory/referral-sources",
  description:
    "The firm's list of referral sources in display order, retired sources included and flagged.",
  responses: {
    200: {
      description: "The firm's referral sources",
      content: { "application/json": { schema: DirectoryReferralSourcesResponse } },
    },
    401: errors[401],
    429: errors[429],
  },
});

const createSourceRoute = defineOpenAPIRoute(writeMeta("directory.createReferralSource"), {
  method: "post",
  path: "/api/v1/directory/referral-sources",
  description: "Adds a referral source to the end of the firm's list.",
  request: {
    headers: idempotencyKeyHeader,
    body: {
      required: true,
      content: { "application/json": { schema: CreateReferralSourceRequest } },
    },
  },
  responses: {
    201: {
      description: "The source as added",
      content: { "application/json": { schema: DirectoryReferralSource } },
    },
    400: errors[400],
    401: errors[401],
    403: errors[403],
    409: errors[409],
    422: errors[422],
    429: errors[429],
  },
});

const updateSourceRoute = defineOpenAPIRoute(writeMeta("directory.updateReferralSource"), {
  method: "patch",
  path: "/api/v1/directory/referral-sources/{id}",
  description:
    "Renames, moves, retires or restores a referral source. A retired source stays on the " +
    "clients recorded under it and is not offered for a new choice.",
  request: {
    headers: idempotencyKeyHeader,
    params: sourceParam,
    body: {
      required: true,
      content: { "application/json": { schema: UpdateReferralSourceRequest } },
    },
  },
  responses: {
    200: {
      description: "The source as it now stands",
      content: { "application/json": { schema: DirectoryReferralSource } },
    },
    400: errors[400],
    401: errors[401],
    403: errors[403],
    404: errors[404],
    409: errors[409],
    422: errors[422],
    429: errors[429],
  },
});

const readReferralRoute = defineOpenAPIRoute(readMeta("directory.entityReferral"), {
  method: "get",
  path: "/api/v1/directory/entities/{id}/referral",
  description:
    "How a client found the firm: a source from the firm's list, the person or organization who " +
    "referred them, or both. Null where nothing is recorded.",
  request: { params: entityParam },
  responses: {
    200: {
      description: "The record's referral, or null",
      content: { "application/json": { schema: DirectoryEntityReferralResponse } },
    },
    401: errors[401],
    404: errors[404],
    429: errors[429],
  },
});

const setReferralRoute = defineOpenAPIRoute(writeMeta("directory.setEntityReferral"), {
  method: "put",
  path: "/api/v1/directory/entities/{id}/referral",
  description:
    "Records a client's referral, replacing what it held. Both fields null removes it. A record is " +
    "never its own referrer, and a retired source may be kept but not newly chosen.",
  request: {
    headers: idempotencyKeyHeader,
    params: entityParam,
    body: { required: true, content: { "application/json": { schema: SetEntityReferralRequest } } },
  },
  responses: {
    200: {
      description: "The record's referral after the write",
      content: { "application/json": { schema: DirectoryEntityReferralResponse } },
    },
    400: errors[400],
    401: errors[401],
    403: errors[403],
    404: errors[404],
    409: errors[409],
    422: errors[422],
    429: errors[429],
  },
});

type ReferralApp = OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>;

function sourceOf(row: ReferralSourceRow): z.infer<typeof DirectoryReferralSource> {
  return { id: row.id, name: row.name, position: row.position, archived: row.archived };
}

function referralOf(
  referral: EntityReferral | null,
): z.infer<typeof DirectoryEntityReferralResponse> {
  if (referral === null) return { referral: null };
  return { referral: { source: referral.source, referrer: referral.referrer } };
}

function writeOptions(
  actorUserId: AppVariables["chokepointUserId"],
  idempotency: DirectoryIdempotencyContext,
): DirectoryWriteOptions {
  return {
    clock: { now: () => new Date().toISOString() },
    actorUserId,
    randomSource: cryptoRandomSource,
    idempotency,
  };
}

/** A referral refusal as its problem; anything else goes to the standard error pipeline. */
function refusal(c: Context, caught: unknown) {
  if (caught instanceof DirectoryIdempotencyConflictError) {
    return problemResponseForIdempotencyConflict(c, caught);
  }
  if (caught instanceof UnknownEntityError || caught instanceof ReferralSourceNotFoundError) {
    return problemJson(c, {
      type: "not-found",
      title: "Not found",
      status: 404,
      detail: caught.message,
    });
  }
  if (caught instanceof MergedEntityError) {
    return problemJson(c, {
      type: "conflict",
      title: "Merge conflict",
      status: 409,
      detail: caught.message,
    });
  }
  if (
    caught instanceof ReferralSourceRetiredError ||
    caught instanceof SelfReferralError ||
    caught instanceof ReferralSourceNameError
  ) {
    return problemJson(c, {
      type: "validation",
      title: "Referral request invalid",
      status: 422,
      detail: caught.message,
    });
  }
  throw caught;
}

export function registerReferralRoutes(app: ReferralApp, chokepoint: Chokepoint): void {
  // GET /api/v1/directory/referral-sources
  app.openapi(
    { ...listSourcesRoute, middleware: chokepointMiddleware(chokepoint, listSourcesRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const rows = await listReferralSources(firm.firmDatabase);
      return c.json({ data: rows.map(sourceOf) }, 200);
    },
  );

  // POST /api/v1/directory/referral-sources
  app.openapi(
    { ...createSourceRoute, middleware: chokepointMiddleware(chokepoint, createSourceRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { name } = c.req.valid("json");
      try {
        const row = await createReferralSource(
          firm.firmDatabase,
          { name },
          writeOptions(userId, idempotency),
        );
        return c.json(sourceOf(row), 201);
      } catch (caught) {
        // Adding a source can be refused only for its name or its key; nothing it names can be missing.
        if (caught instanceof DirectoryIdempotencyConflictError) {
          return problemResponseForIdempotencyConflict(c, caught);
        }
        if (caught instanceof ReferralSourceNameError) {
          return problemJson(c, {
            type: "validation",
            title: "Referral request invalid",
            status: 422,
            detail: caught.message,
          });
        }
        throw caught;
      }
    },
  );

  // PATCH /api/v1/directory/referral-sources/{id}
  app.openapi(
    { ...updateSourceRoute, middleware: chokepointMiddleware(chokepoint, updateSourceRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { id } = c.req.valid("param");
      const request = c.req.valid("json");
      try {
        const row = await updateReferralSource(
          firm.firmDatabase,
          id,
          request,
          writeOptions(userId, idempotency),
        );
        return c.json(sourceOf(row), 200);
      } catch (caught) {
        return refusal(c, caught);
      }
    },
  );

  // GET /api/v1/directory/entities/{id}/referral
  app.openapi(
    { ...readReferralRoute, middleware: chokepointMiddleware(chokepoint, readReferralRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { id } = c.req.valid("param");
      return c.json(referralOf(await readEntityReferral(firm.firmDatabase, id)), 200);
    },
  );

  // PUT /api/v1/directory/entities/{id}/referral
  app.openapi(
    { ...setReferralRoute, middleware: chokepointMiddleware(chokepoint, setReferralRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { id } = c.req.valid("param");
      const { sourceId, referrerEntityId } = c.req.valid("json");
      try {
        const referral = await setEntityReferral(
          firm.firmDatabase,
          id,
          { sourceId, referrerEntityId },
          writeOptions(userId, idempotency),
        );
        return c.json(referralOf(referral), 200);
      } catch (caught) {
        return refusal(c, caught);
      }
    },
  );
}
