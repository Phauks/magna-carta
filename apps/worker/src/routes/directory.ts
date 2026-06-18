import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { loadEffectivePermissions } from "../session-context.ts";
import { createPerson, readPerson } from "@magna-carta/directory/person";
import { createOrganization, readOrganization } from "@magna-carta/directory/organization";
import { addName } from "@magna-carta/directory/name-history";
import {
  addIdentifier,
  readIdentifier,
  IdentifierNotIndexableError,
  type DirectoryIdentifierContext,
} from "@magna-carta/directory/identifiers";
import { createEdge, InvalidEdgeTypeError, UnknownEntityError } from "@magna-carta/directory/edges";
import {
  assignCategory,
  createCategory,
  CategoryAppliesToMismatchError,
  CategoryNotFoundError,
  EntityNotFoundError,
} from "@magna-carta/directory/categories";
import { findDuplicateCandidates, searchNames } from "@magna-carta/directory/search";
import {
  mergeEntities,
  MergeAlreadyMergedError,
  MergeEntityNotFoundError,
  MergeKindMismatchError,
  MergeSameEntityError,
} from "@magna-carta/directory/merge";
import { linkMatterParty } from "@magna-carta/directory/party";
import {
  EDGE_TYPES,
  ENTITY_KINDS,
  IDENTIFIER_TYPES,
  NAME_ROLES,
} from "@magna-carta/directory/types";
import type { DirectoryWriteOptions } from "@magna-carta/directory/audit";
import {
  DirectoryIdempotencyConflictError,
  type DirectoryIdempotencyContext,
} from "@magna-carta/directory/run-directory-effect";
import { cryptoRandomSource } from "@magna-carta/identifiers/random";
import { identifierField, idempotencyKeyHeader } from "../contracts/common.ts";
import type { DirectoryOrganizationId, DirectoryPersonId } from "@magna-carta/identifiers/types";
import type { Context } from "hono";
import type { Bindings } from "../app.ts";
import type { Chokepoint } from "../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointFirmId,
  requireChokepointIdempotency,
  requireChokepointUserId,
} from "../chokepoint/context-accessors.ts";
import { problemResponseForIdempotencyConflict } from "../idempotency-conflict-problems.ts";
import { firmKeyProviderForEnv } from "../firm-key-provider-wiring.ts";
import type { AppVariables } from "../chokepoint/ports.ts";
import { chokepointMiddleware } from "../chokepoint/register.ts";
import { Problem, problemJson, type ProblemResponse } from "../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../contracts/route-meta.ts";

// The directory HTTP surface over the @magna-carta/directory domain package: persons and
// organizations, their name history, sensitive typed identifiers, relationship edges, categories,
// fuzzy/duplicate search, non-destructive merge, and the matter-party link. Every mutation rides the
// chokepoint's idempotency gate (an Idempotency-Key is required); every handler hands the domain
// service the firm-scoped per-firm database, the real clock, a crypto random source, and the
// authenticated actor — none of which is ever client input. Reads of a sensitive identifier are the
// one decrypt path: gated by directory:viewSensitiveIdentifiers and audited inside the protected-field
// chokepoint. find/search reveal nothing they were not given (blind-index equality, FTS), so they
// carry no decrypt and name no permission beyond an authenticated session.

// ---- shared service handles ----

// The clock + random source every directory write reads (the service trusts no ambient clock and no
// ambient identity — both are passed). The random source is the production Web Crypto source; tests
// drive determinism at the domain layer, not through the route. The idempotency context (the
// chokepoint's firm-scoped derived key + request fingerprint) rides the committed batch so a retried
// mutation dedups instead of duplicating.
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

// The protected-field read/write context for the sensitive-identifier path: the firm key handle from
// the env-scoped provider, the per-firm database, the caller's effective permissions (so the
// protected-field chokepoint can gate + audit a decrypt), the acting user, and the clock. The
// effective-permission set is the same one the chokepoint loaded to gate the route — re-derived here
// because the chokepoint does not stash it as a context variable. firmKeyVersion 1 (the only version
// minted today).
async function identifierContext(
  c: Context<{ Bindings: Bindings; Variables: AppVariables }>,
  idempotency?: DirectoryIdempotencyContext,
): Promise<DirectoryIdentifierContext> {
  const firm = requireChokepointFirmContext(c);
  const firmId = requireChokepointFirmId(c);
  const actorUserId = requireChokepointUserId(c);
  const effectivePermissions = await loadEffectivePermissions(firm.firmDatabase, actorUserId);
  return {
    firmId,
    firmKeyVersion: 1,
    firmKeyProvider: firmKeyProviderForEnv(c.env),
    database: firm.firmDatabase,
    effectivePermissions,
    actorUserId,
    clock: { now: () => new Date().toISOString() },
    randomSource: cryptoRandomSource,
    idempotency,
  };
}

// A directory-entity id path param: a person OR an organization handle (the name/identifier/category
// paths are entity-generic — the domain resolves the kind from the id prefix). Validated as a
// non-empty string with the directoryPerson_/directoryOrganization_ prefix; the brand is compile-time
// only, so this emits as a plain pattern-checked string.
const directoryEntityIdPattern = /^(directoryPerson|directoryOrganization)_[A-Za-z0-9_-]+$/;
const entityParam = z.object({
  id: z
    .string()
    .regex(directoryEntityIdPattern)
    .openapi({ param: { name: "id", in: "path" } }),
});
type EntityId = DirectoryPersonId | DirectoryOrganizationId;

// ---- request/response contracts ----

const CreatePersonRequest = z
  .object({
    given: z.string().min(1),
    family: z.string().min(1),
    prefix: z.string().nullable().optional(),
    middle: z.string().nullable().optional(),
    suffix: z.string().nullable().optional(),
  })
  .openapi("CreateDirectoryPersonRequest");

const CreatedEntityResponse = z
  .object({ id: z.string() })
  .openapi("CreatedDirectoryEntityResponse");

const PersonDetail = z
  .object({
    id: z.string(),
    prefix: z.string().nullable(),
    given: z.string().nullable(),
    middle: z.string().nullable(),
    family: z.string().nullable(),
    suffix: z.string().nullable(),
    displayName: z.string().nullable(),
    status: z.string(),
    mergedIntoId: z.string().nullable(),
  })
  .openapi("DirectoryPersonDetail");

const CreateOrganizationRequest = z
  .object({
    legalName: z.string().min(1),
    displayName: z.string().nullable().optional(),
  })
  .openapi("CreateDirectoryOrganizationRequest");

const OrganizationDetail = z
  .object({
    id: z.string(),
    legalName: z.string().nullable(),
    displayName: z.string().nullable(),
    status: z.string(),
    mergedIntoId: z.string().nullable(),
  })
  .openapi("DirectoryOrganizationDetail");

const AddNameRequest = z
  .object({
    nameRole: z.enum(NAME_ROLES),
    // Person fields.
    given: z.string().optional(),
    family: z.string().optional(),
    prefix: z.string().nullable().optional(),
    middle: z.string().nullable().optional(),
    suffix: z.string().nullable().optional(),
    // Organization field.
    legalName: z.string().optional(),
    displayName: z.string().nullable().optional(),
  })
  .openapi("AddDirectoryNameRequest");

const AckResponse = z.object({ ok: z.boolean() }).openapi("DirectoryAckResponse");

const AddIdentifierRequest = z
  .object({
    type: z.enum(IDENTIFIER_TYPES),
    value: z.string().min(1),
    validFrom: z.string().nullable().optional(),
    validTo: z.string().nullable().optional(),
  })
  .openapi("AddDirectoryIdentifierRequest");

const identifierTypeParam = z.object({
  id: z
    .string()
    .regex(directoryEntityIdPattern)
    .openapi({ param: { name: "id", in: "path" } }),
  type: z.enum(IDENTIFIER_TYPES).openapi({ param: { name: "type", in: "path" } }),
});

const IdentifierValueResponse = z
  .object({ value: z.string().nullable() })
  .openapi("DirectoryIdentifierValueResponse");

const CreateEdgeRequest = z
  .object({
    from: z.string().regex(directoryEntityIdPattern),
    to: z.string().regex(directoryEntityIdPattern),
    edgeType: z.enum(EDGE_TYPES),
    role: z.string().nullable().optional(),
    note: z.string().nullable().optional(),
    validFrom: z.string().nullable().optional(),
    validTo: z.string().nullable().optional(),
  })
  .openapi("CreateDirectoryEdgeRequest");

const CreateCategoryRequest = z
  .object({
    name: z.string().min(1),
    appliesTo: z.enum(["person", "organization", "both"]),
    position: z.number().int().optional(),
  })
  .openapi("CreateDirectoryCategoryRequest");

const AssignCategoryRequest = z
  .object({
    entityId: z.string().regex(directoryEntityIdPattern),
    categoryId: identifierField("directoryCategory"),
  })
  .openapi("AssignDirectoryCategoryRequest");

const SearchHit = z
  .object({
    entityId: z.string(),
    entityKind: z.string(),
    displayName: z.string(),
    relevance: z.number(),
  })
  .openapi("DirectorySearchHit");

const SearchResponse = z.object({ data: z.array(SearchHit) }).openapi("DirectorySearchResponse");

const DuplicateCandidatesRequest = z
  .object({
    kind: z.enum(ENTITY_KINDS),
    given: z.string().optional(),
    family: z.string().optional(),
    legalName: z.string().optional(),
    identifiers: z
      .array(z.object({ type: z.enum(IDENTIFIER_TYPES), value: z.string() }))
      .optional(),
    excludeEntityId: z.string().optional(),
  })
  .openapi("DirectoryDuplicateCandidatesRequest");

const DuplicateCandidate = z
  .object({ entityId: z.string(), signalCount: z.number() })
  .openapi("DirectoryDuplicateCandidate");

const DuplicateCandidatesResponse = z
  .object({ data: z.array(DuplicateCandidate) })
  .openapi("DirectoryDuplicateCandidatesResponse");

const MergeRequest = z
  .object({
    masterId: z.string().regex(directoryEntityIdPattern),
    subordinateId: z.string().regex(directoryEntityIdPattern),
    // The survivorship choice per conflicting node column: "subordinate" means the master takes the
    // subordinate's value. An absent column keeps the master's own value.
    survivorship: z.record(z.string(), z.literal("subordinate")).optional(),
  })
  .openapi("DirectoryMergeRequest");

const MergeResponse = z.object({ mergeId: z.string() }).openapi("DirectoryMergeResponse");

const LinkMatterPartyRequest = z
  .object({
    matterId: identifierField("matter"),
    entityId: z.string().regex(directoryEntityIdPattern),
    role: z.string().min(1),
  })
  .openapi("LinkMatterPartyRequest");

const MatterPartyResponse = z.object({ id: z.string() }).openapi("MatterPartyResponse");

// ---- shared error responses ----

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
    description: "The session member lacks the required permission",
    content: { "application/problem+json": { schema: Problem } },
  },
  404: {
    description: "The firm is unreachable, the member is deactivated, or the entity is unknown",
    content: { "application/problem+json": { schema: Problem } },
  },
  409: {
    description: "A request with this Idempotency-Key is still in progress, or a merge conflict",
    content: { "application/problem+json": { schema: Problem } },
  },
  422: {
    description:
      "The request is invalid, or the Idempotency-Key was reused with a different payload",
    content: { "application/problem+json": { schema: Problem } },
  },
  429: {
    description: "Rate limit exceeded",
    content: { "application/problem+json": { schema: Problem } },
  },
} as const;

// Maps a directory domain refusal to its RFC 9457 problem. Codes — never messages — drive it; an
// unrecognized throw propagates to the standard error pipeline (a 500).
function directoryErrorResponse(
  c: Context,
  caught: unknown,
): ProblemResponse<404> | ProblemResponse<409> | ProblemResponse<422> {
  if (caught instanceof DirectoryIdempotencyConflictError) {
    return problemResponseForIdempotencyConflict(c, caught);
  }
  if (
    caught instanceof MergeEntityNotFoundError ||
    caught instanceof EntityNotFoundError ||
    caught instanceof CategoryNotFoundError ||
    caught instanceof UnknownEntityError
  ) {
    return problemJson(c, {
      type: "not-found",
      title: "Not found",
      status: 404,
      detail: caught.message,
    });
  }
  if (caught instanceof MergeAlreadyMergedError || caught instanceof MergeSameEntityError) {
    return problemJson(c, {
      type: "conflict",
      title: "Merge conflict",
      status: 409,
      detail: caught.message,
    });
  }
  if (
    caught instanceof MergeKindMismatchError ||
    caught instanceof InvalidEdgeTypeError ||
    caught instanceof CategoryAppliesToMismatchError ||
    caught instanceof IdentifierNotIndexableError
  ) {
    return problemJson(c, {
      type: "validation",
      title: "Directory request invalid",
      status: 422,
      detail: caught.message,
    });
  }
  throw caught;
}

// ---- route metas ----

function mutationMeta(action: string, permission: RouteMeta["permission"]): RouteMeta {
  return {
    operationId: `directory.${action}`,
    surface: "app",
    authenticated: true,
    permission,
    resource: "directoryEntity",
    audited: true,
    idempotency: "required",
    idempotencyStore: "firm",
    rateLimit: "default",
  };
}

function readMeta(action: string, permission: RouteMeta["permission"]): RouteMeta {
  return {
    operationId: `directory.${action}`,
    surface: "app",
    authenticated: true,
    permission,
    resource: "directoryEntity",
    audited: false,
    idempotency: "optional",
    rateLimit: "default",
  };
}

// Every directory write (create/edit an entity, name, identifier, edge, category, merge, matter-party
// link) requires directory:edit. The sensitive-identifier READ is the one route that instead names
// directory:viewSensitiveIdentifiers — its decrypt is the privileged, audited action.
const WRITE_PERMISSION = "directory:edit" as const;

const createPersonRoute = defineOpenAPIRoute(mutationMeta("createPerson", WRITE_PERMISSION), {
  method: "post",
  path: "/api/v1/directory/persons",
  description:
    "Creates a directory person from its structured name parts, seeding the current-name history row " +
    "and its phonetic blocking codes.",
  request: {
    headers: idempotencyKeyHeader,
    body: { content: { "application/json": { schema: CreatePersonRequest } }, required: true },
  },
  responses: {
    201: {
      description: "The created person",
      content: { "application/json": { schema: CreatedEntityResponse } },
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

const getPersonRoute = defineOpenAPIRoute(readMeta("getPerson", null), {
  method: "get",
  path: "/api/v1/directory/persons/{id}",
  description: "Returns one directory person's detail.",
  request: { params: entityParam },
  responses: {
    200: { description: "The person", content: { "application/json": { schema: PersonDetail } } },
    401: authErrors[401],
    404: authErrors[404],
    429: authErrors[429],
  },
});

const createOrganizationRoute = defineOpenAPIRoute(
  mutationMeta("createOrganization", WRITE_PERMISSION),
  {
    method: "post",
    path: "/api/v1/directory/organizations",
    description:
      "Creates a directory organization from its legal name, seeding the current-name history row and " +
      "its phonetic blocking codes.",
    request: {
      headers: idempotencyKeyHeader,
      body: {
        content: { "application/json": { schema: CreateOrganizationRequest } },
        required: true,
      },
    },
    responses: {
      201: {
        description: "The created organization",
        content: { "application/json": { schema: CreatedEntityResponse } },
      },
      400: authErrors[400],
      401: authErrors[401],
      403: authErrors[403],
      404: authErrors[404],
      409: authErrors[409],
      422: authErrors[422],
      429: authErrors[429],
    },
  },
);

const getOrganizationRoute = defineOpenAPIRoute(readMeta("getOrganization", null), {
  method: "get",
  path: "/api/v1/directory/organizations/{id}",
  description: "Returns one directory organization's detail.",
  request: { params: entityParam },
  responses: {
    200: {
      description: "The organization",
      content: { "application/json": { schema: OrganizationDetail } },
    },
    401: authErrors[401],
    404: authErrors[404],
    429: authErrors[429],
  },
});

const addNameRoute = defineOpenAPIRoute(mutationMeta("addName", WRITE_PERMISSION), {
  method: "post",
  path: "/api/v1/directory/entities/{id}/names",
  description:
    "Appends a non-current alias (alias/aka/maiden/dba/former) to an entity without touching its " +
    "current name. The entity kind is resolved from the id; supply the person OR organization name " +
    "fields accordingly.",
  request: {
    headers: idempotencyKeyHeader,
    params: entityParam,
    body: { content: { "application/json": { schema: AddNameRequest } }, required: true },
  },
  responses: {
    201: {
      description: "The alias was added",
      content: { "application/json": { schema: AckResponse } },
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

const addIdentifierRoute = defineOpenAPIRoute(mutationMeta("addIdentifier", WRITE_PERMISSION), {
  method: "post",
  path: "/api/v1/directory/entities/{id}/identifiers",
  description:
    "Seals a typed sensitive identifier (SSN/EIN/DL/account/DOB/SSN-last-four) for an entity under the " +
    "firm key — only the ciphertext (and, where the type is standalone-indexable, the exact-match blind " +
    "index) is stored, never the plaintext. Adding a value needs no decrypt permission; reading it back " +
    "does.",
  request: {
    headers: idempotencyKeyHeader,
    params: entityParam,
    body: { content: { "application/json": { schema: AddIdentifierRequest } }, required: true },
  },
  responses: {
    201: {
      description: "The identifier was sealed and added",
      content: { "application/json": { schema: AckResponse } },
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

const readIdentifierRoute = defineOpenAPIRoute(
  readMeta("readIdentifier", "directory:viewSensitiveIdentifiers"),
  {
    method: "get",
    path: "/api/v1/directory/entities/{id}/identifiers/{type}",
    description:
      "Decrypts and returns an entity's sensitive identifier of the given type. The decrypt is gated by " +
      "directory:viewSensitiveIdentifiers and audited (an audit_log row is written before any plaintext " +
      "is produced); a caller without the permission is refused at the chokepoint, before any decrypt.",
    request: { params: identifierTypeParam },
    responses: {
      200: {
        description:
          "The decrypted identifier value (null when the entity holds none of this type)",
        content: { "application/json": { schema: IdentifierValueResponse } },
      },
      401: authErrors[401],
      403: authErrors[403],
      404: authErrors[404],
      429: authErrors[429],
    },
  },
);

const createEdgeRoute = defineOpenAPIRoute(mutationMeta("createEdge", WRITE_PERMISSION), {
  method: "post",
  path: "/api/v1/directory/edges",
  description:
    "Creates a directed relationship edge between two directory entities (affiliation, corporate " +
    "parent/subsidiary/successor, representation, role assignment). Both endpoints must exist.",
  request: {
    headers: idempotencyKeyHeader,
    body: { content: { "application/json": { schema: CreateEdgeRequest } }, required: true },
  },
  responses: {
    201: {
      description: "The created edge",
      content: { "application/json": { schema: CreatedEntityResponse } },
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

const createCategoryRoute = defineOpenAPIRoute(mutationMeta("createCategory", WRITE_PERMISSION), {
  method: "post",
  path: "/api/v1/directory/categories",
  description:
    "Creates a directory category (label) constrained to person, organization, or both entity kinds.",
  request: {
    headers: idempotencyKeyHeader,
    body: { content: { "application/json": { schema: CreateCategoryRequest } }, required: true },
  },
  responses: {
    201: {
      description: "The created category",
      content: { "application/json": { schema: CreatedEntityResponse } },
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

const assignCategoryRoute = defineOpenAPIRoute(mutationMeta("assignCategory", WRITE_PERMISSION), {
  method: "post",
  path: "/api/v1/directory/category-assignments",
  description:
    "Links a directory entity to a category, enforcing the category's applies-to constraint against " +
    "the entity kind.",
  request: {
    headers: idempotencyKeyHeader,
    body: { content: { "application/json": { schema: AssignCategoryRequest } }, required: true },
  },
  responses: {
    201: {
      description: "The category was assigned",
      content: { "application/json": { schema: AckResponse } },
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

const searchRoute = defineOpenAPIRoute(readMeta("search", null), {
  method: "get",
  path: "/api/v1/directory/search",
  description:
    "Fuzzy name search over the directory: a trigram FTS match, tolerant of typos, ordered by " +
    "relevance. Merged-away entities are excluded.",
  request: { query: z.object({ q: z.string() }) },
  responses: {
    200: {
      description: "The ranked hits",
      content: { "application/json": { schema: SearchResponse } },
    },
    401: authErrors[401],
    404: authErrors[404],
    429: authErrors[429],
  },
});

const duplicateCandidatesRoute = defineOpenAPIRoute(
  readMeta("duplicateCandidates", WRITE_PERMISSION),
  {
    method: "post",
    path: "/api/v1/directory/duplicate-candidates",
    description:
      "Returns duplicate candidates for a prospective or existing entity by unioning three blocking " +
      "channels (phonetic, trigram, and blind-index identifier equality), ranked by how many channels " +
      "matched. A read-shaped POST (the match facts ride the body) — no write, no decrypt.",
    request: {
      body: {
        content: { "application/json": { schema: DuplicateCandidatesRequest } },
        required: true,
      },
    },
    responses: {
      200: {
        description: "The ranked candidates",
        content: { "application/json": { schema: DuplicateCandidatesResponse } },
      },
      401: authErrors[401],
      404: authErrors[404],
      422: authErrors[422],
      429: authErrors[429],
    },
  },
);

const mergeRoute = defineOpenAPIRoute(mutationMeta("merge", WRITE_PERMISSION), {
  method: "post",
  path: "/api/v1/directory/merges",
  description:
    "Folds a duplicate (the subordinate) into the surviving record (the master) non-destructively: " +
    "archives the subordinate, repoints its inbound references, applies field-level survivorship, and " +
    "records the reversible merge event. merged_by is the authenticated actor.",
  request: {
    headers: idempotencyKeyHeader,
    body: { content: { "application/json": { schema: MergeRequest } }, required: true },
  },
  responses: {
    201: {
      description: "The recorded merge",
      content: { "application/json": { schema: MergeResponse } },
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

const linkMatterPartyRoute = defineOpenAPIRoute(mutationMeta("linkMatterParty", WRITE_PERMISSION), {
  method: "post",
  path: "/api/v1/directory/matter-parties",
  description:
    "Links a directory entity to a matter in a role (client, opposing party, guardian, …). One entity " +
    "may wear several roles on the same matter — there is no uniqueness on (matter, entity).",
  request: {
    headers: idempotencyKeyHeader,
    body: { content: { "application/json": { schema: LinkMatterPartyRequest } }, required: true },
  },
  responses: {
    201: {
      description: "The matter-party link",
      content: { "application/json": { schema: MatterPartyResponse } },
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

type DirectoryApp = OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>;

export function registerDirectoryRoutes(app: DirectoryApp, chokepoint: Chokepoint): void {
  // POST /api/v1/directory/persons
  app.openapi(
    { ...createPersonRoute, middleware: chokepointMiddleware(chokepoint, createPersonRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const request = c.req.valid("json");
      try {
        const id = await createPerson(
          firm.firmDatabase,
          {
            given: request.given,
            family: request.family,
            prefix: request.prefix ?? null,
            middle: request.middle ?? null,
            suffix: request.suffix ?? null,
          },
          writeOptions(userId, idempotency),
        );
        return c.json({ id } as z.infer<typeof CreatedEntityResponse>, 201);
      } catch (caught) {
        return directoryErrorResponse(c, caught);
      }
    },
  );

  // GET /api/v1/directory/persons/{id}
  app.openapi(
    { ...getPersonRoute, middleware: chokepointMiddleware(chokepoint, getPersonRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { id } = c.req.valid("param");
      try {
        const person = await readPerson(firm.firmDatabase, id as DirectoryPersonId);
        return c.json(person as unknown as z.infer<typeof PersonDetail>, 200);
      } catch {
        return problemJson(c, {
          type: "not-found",
          title: "Not found",
          status: 404,
          detail: "No such directory person in this firm.",
        });
      }
    },
  );

  // POST /api/v1/directory/organizations
  app.openapi(
    {
      ...createOrganizationRoute,
      middleware: chokepointMiddleware(chokepoint, createOrganizationRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const request = c.req.valid("json");
      try {
        const id = await createOrganization(
          firm.firmDatabase,
          { legalName: request.legalName, displayName: request.displayName ?? null },
          writeOptions(userId, idempotency),
        );
        return c.json({ id } as z.infer<typeof CreatedEntityResponse>, 201);
      } catch (caught) {
        return directoryErrorResponse(c, caught);
      }
    },
  );

  // GET /api/v1/directory/organizations/{id}
  app.openapi(
    { ...getOrganizationRoute, middleware: chokepointMiddleware(chokepoint, getOrganizationRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { id } = c.req.valid("param");
      try {
        const organization = await readOrganization(
          firm.firmDatabase,
          id as DirectoryOrganizationId,
        );
        return c.json(organization as unknown as z.infer<typeof OrganizationDetail>, 200);
      } catch {
        return problemJson(c, {
          type: "not-found",
          title: "Not found",
          status: 404,
          detail: "No such directory organization in this firm.",
        });
      }
    },
  );

  // POST /api/v1/directory/entities/{id}/names
  app.openapi(
    { ...addNameRoute, middleware: chokepointMiddleware(chokepoint, addNameRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { id } = c.req.valid("param");
      const request = c.req.valid("json");
      try {
        const input =
          request.legalName !== undefined
            ? {
                nameRole: request.nameRole,
                legalName: request.legalName,
                displayName: request.displayName ?? null,
              }
            : {
                nameRole: request.nameRole,
                given: request.given ?? "",
                family: request.family ?? "",
                prefix: request.prefix ?? null,
                middle: request.middle ?? null,
                suffix: request.suffix ?? null,
              };
        await addName(firm.firmDatabase, id as EntityId, input, writeOptions(userId, idempotency));
        return c.json({ ok: true } as z.infer<typeof AckResponse>, 201);
      } catch (caught) {
        return directoryErrorResponse(c, caught);
      }
    },
  );

  // POST /api/v1/directory/entities/{id}/identifiers
  app.openapi(
    { ...addIdentifierRoute, middleware: chokepointMiddleware(chokepoint, addIdentifierRoute) },
    async (c) => {
      const idempotency = requireChokepointIdempotency(c);
      const { id } = c.req.valid("param");
      const request = c.req.valid("json");
      const context = await identifierContext(c, idempotency);
      try {
        await addIdentifier(context, id, {
          type: request.type,
          value: request.value,
          validFrom: request.validFrom ?? null,
          validTo: request.validTo ?? null,
        });
        return c.json({ ok: true } as z.infer<typeof AckResponse>, 201);
      } catch (caught) {
        return directoryErrorResponse(c, caught);
      }
    },
  );

  // GET /api/v1/directory/entities/{id}/identifiers/{type} — the audited decrypt path
  app.openapi(
    { ...readIdentifierRoute, middleware: chokepointMiddleware(chokepoint, readIdentifierRoute) },
    async (c) => {
      const { id, type } = c.req.valid("param");
      const context = await identifierContext(c);
      const value = await readIdentifier(context, id, type);
      return c.json({ value } as z.infer<typeof IdentifierValueResponse>, 200);
    },
  );

  // POST /api/v1/directory/edges
  app.openapi(
    { ...createEdgeRoute, middleware: chokepointMiddleware(chokepoint, createEdgeRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const request = c.req.valid("json");
      try {
        const id = await createEdge(
          firm.firmDatabase,
          {
            from: request.from as EntityId,
            to: request.to as EntityId,
            edgeType: request.edgeType,
            role: request.role ?? null,
            note: request.note ?? null,
            validFrom: request.validFrom ?? null,
            validTo: request.validTo ?? null,
          },
          writeOptions(userId, idempotency),
        );
        return c.json({ id } as z.infer<typeof CreatedEntityResponse>, 201);
      } catch (caught) {
        return directoryErrorResponse(c, caught);
      }
    },
  );

  // POST /api/v1/directory/categories
  app.openapi(
    { ...createCategoryRoute, middleware: chokepointMiddleware(chokepoint, createCategoryRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const request = c.req.valid("json");
      try {
        const { id } = await createCategory(
          firm.firmDatabase,
          { name: request.name, appliesTo: request.appliesTo, position: request.position },
          writeOptions(userId, idempotency),
        );
        return c.json({ id } as z.infer<typeof CreatedEntityResponse>, 201);
      } catch (caught) {
        return directoryErrorResponse(c, caught);
      }
    },
  );

  // POST /api/v1/directory/category-assignments
  app.openapi(
    { ...assignCategoryRoute, middleware: chokepointMiddleware(chokepoint, assignCategoryRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const request = c.req.valid("json");
      try {
        await assignCategory(
          firm.firmDatabase,
          { entityId: request.entityId, categoryId: request.categoryId },
          writeOptions(userId, idempotency),
        );
        return c.json({ ok: true } as z.infer<typeof AckResponse>, 201);
      } catch (caught) {
        return directoryErrorResponse(c, caught);
      }
    },
  );

  // GET /api/v1/directory/search?q=
  app.openapi(
    { ...searchRoute, middleware: chokepointMiddleware(chokepoint, searchRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { q } = c.req.valid("query");
      const data = await searchNames(firm.firmDatabase, q);
      return c.json({ data } as unknown as z.infer<typeof SearchResponse>, 200);
    },
  );

  // POST /api/v1/directory/duplicate-candidates — read-shaped POST
  app.openapi(
    {
      ...duplicateCandidatesRoute,
      middleware: chokepointMiddleware(chokepoint, duplicateCandidatesRoute),
    },
    async (c) => {
      const request = c.req.valid("json");
      const context = await identifierContext(c);
      const data = await findDuplicateCandidates(context, {
        kind: request.kind,
        given: request.given,
        family: request.family,
        legalName: request.legalName,
        identifiers: request.identifiers,
        excludeEntityId: request.excludeEntityId,
      });
      return c.json({ data } as z.infer<typeof DuplicateCandidatesResponse>, 200);
    },
  );

  // POST /api/v1/directory/merges — merged_by is the authenticated actor
  app.openapi(
    { ...mergeRoute, middleware: chokepointMiddleware(chokepoint, mergeRoute) },
    async (c) => {
      const idempotency = requireChokepointIdempotency(c);
      const request = c.req.valid("json");
      const context = await identifierContext(c, idempotency);
      try {
        const mergeId = await mergeEntities(context, {
          masterId: request.masterId,
          subordinateId: request.subordinateId,
          survivorship: request.survivorship ?? {},
        });
        return c.json({ mergeId } as z.infer<typeof MergeResponse>, 201);
      } catch (caught) {
        return directoryErrorResponse(c, caught);
      }
    },
  );

  // POST /api/v1/directory/matter-parties
  app.openapi(
    { ...linkMatterPartyRoute, middleware: chokepointMiddleware(chokepoint, linkMatterPartyRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const request = c.req.valid("json");
      try {
        const id = await linkMatterParty(
          firm.firmDatabase,
          { matterId: request.matterId, entityId: request.entityId, role: request.role },
          writeOptions(userId, idempotency),
        );
        return c.json({ id } as z.infer<typeof MatterPartyResponse>, 201);
      } catch (caught) {
        return directoryErrorResponse(c, caught);
      }
    },
  );
}
