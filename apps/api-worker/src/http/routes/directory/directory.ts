import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { loadEffectivePermissions } from "../../../effective-permissions.ts";
import {
  readPerson,
  setPersonLifeDates,
  setPersonPronouns,
  InvalidPersonLifeDatesError,
} from "@magna-carta/directory/person";
import {
  addEmail,
  removeEmail,
  updateEmail,
  DirectoryEmailNotFoundError,
  InvalidEmailAddressError,
  InvalidEmailUseError,
} from "@magna-carta/directory/contact-email";
import {
  addPhone,
  removePhone,
  updatePhone,
  DirectoryPhoneNotFoundError,
  InvalidPhoneClassificationError,
  InvalidPhoneNumberError,
} from "@magna-carta/directory/contact-phone";
import {
  addAddress,
  removeAddress,
  updateAddress,
  DirectoryAddressNotFoundError,
  EmptyPostalAddressError,
  InvalidAddressClassificationError,
} from "@magna-carta/directory/contact-address";
import { readContactPoints } from "@magna-carta/directory/contact-points";
import { InvalidContactVerificationStatusError } from "@magna-carta/directory/contact-preference";
import { IncompletePronounSetError } from "@magna-carta/directory/pronouns";
import { createOrganization, readOrganization } from "@magna-carta/directory/organization";
import { addName, changeName, readNames } from "@magna-carta/directory/name-history";
import {
  addIdentifier,
  listIdentifierRecords,
  readIdentifier,
  IdentifierNotIndexableError,
  type DirectoryIdentifierContext,
  type AddIdentifierInput,
} from "@magna-carta/directory/identifiers";
import { checkIdentifier, parseAccountValue } from "@magna-carta/directory/identifier-shape";
import { createPersonRecord } from "@magna-carta/directory/person-record";
import {
  createEdge,
  readEdgesPage,
  InvalidEdgeTypeError,
  UnknownEntityError,
} from "@magna-carta/directory/edges";
import { MergedEntityError } from "@magna-carta/directory/entity-kind";
import {
  MAX_ENTITY_DISPLAY_NAME_LOOKUP,
  readEntityDisplayNames,
} from "@magna-carta/directory/entity-display";
import { readEntityListing } from "@magna-carta/directory/entity-listing";
import {
  assignCategory,
  createCategory,
  listCategories,
  readCategories,
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
  MergeUnknownFieldError,
} from "@magna-carta/directory/merge";
import {
  linkMatterParty,
  readMatterParties,
  readMatterPartiesForEntity,
  unlinkMatterParty,
} from "@magna-carta/directory/party";
import { ProtectedReadForbiddenError } from "@magna-carta/data-access/protected-fields";
import { ENTITY_KINDS, IDENTIFIER_TYPES } from "@magna-carta/directory/types";
import type { DirectoryWriteOptions } from "@magna-carta/directory/audit";
import {
  DirectoryIdempotencyConflictError,
  type DirectoryIdempotencyContext,
} from "@magna-carta/directory/run-directory-effect";
import {
  AckResponse,
  AddAddressRequest,
  AddEmailRequest,
  AddIdentifierRequest,
  AddNameRequest,
  AddPhoneRequest,
  AssignCategoryRequest,
  ChangeNameRequest,
  CreateCategoryRequest,
  CreateEdgeRequest,
  CreateOrganizationRequest,
  CreatePersonRequest,
  CreatedEntityResponse,
  DirectoryAddressesResponse,
  DirectoryCategoriesResponse,
  DirectoryCategory,
  DirectoryContactPointsResponse,
  DirectoryEdgePage,
  DirectoryEmailsResponse,
  DirectoryEntityListingPage,
  DirectoryIdentifierRecordsResponse,
  DirectoryNamePage,
  DirectoryPhonesResponse,
  DuplicateCandidatesRequest,
  DuplicateCandidatesResponse,
  EntityDisplayNamesResponse,
  EntityMatterPartyPage,
  IdentifierValueResponse,
  LinkMatterPartyRequest,
  MatterPartyListResponse,
  MatterPartyResponse,
  MergeRequest,
  MergeResponse,
  OrganizationDetail,
  PersonDetail,
  SearchResponse,
  SetPersonLifeDatesRequest,
  SetPronounsRequest,
  UnlinkMatterPartyResponse,
  UpdateAddressRequest,
  UpdateEmailRequest,
  UpdatePhoneRequest,
  directoryEntityIdPattern,
} from "@magna-carta/directory/contract";
import { cryptoRandomSource } from "@magna-carta/identifiers/random";
import { idempotencyKeyHeader } from "../../contracts/common.ts";
import { identifierField } from "@magna-carta/identifiers/field";
import { cursorQuery } from "@magna-carta/data-access/pagination-contract";
import type {
  DirectoryOrganizationId,
  DirectoryPersonId,
  MatterPartyId,
} from "@magna-carta/identifiers/types";
import type { Context } from "hono";
import type { Bindings } from "../../../bindings.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointFirmId,
  requireChokepointIdempotency,
  requireChokepointUserId,
} from "../../chokepoint/context-accessors.ts";
import { problemResponseForIdempotencyConflict } from "../../idempotency-conflict-problems.ts";
import { firmKeyProviderForEnv } from "../../../firm-key-provider-wiring.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { Problem, problemJson, type ProblemResponse } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";

// The directory HTTP surface over the @magna-carta/directory domain package: persons and
// organizations, their name history, sensitive typed identifiers, relationship edges, categories,
// fuzzy/duplicate search, non-destructive merge, and the matter-party link. Every mutation rides the
// chokepoint's idempotency gate (an Idempotency-Key is required); every handler hands the domain
// service the firm-scoped per-firm database, the real clock, a crypto random source, and the
// authenticated actor — none of which is ever client input. Reads of a sensitive identifier are the
// one decrypt path: gated by directory:viewSensitiveIdentifiers and audited inside the protected-field
// chokepoint. Plain name search reveals nothing it was not given (blind-index equality, FTS), so it
// carries no decrypt and names no permission beyond an authenticated session. Duplicate-candidate
// generation is the one exception among the read-shaped surfaces: it gates on directory:edit because it
// is the entry-time duplicate-prevention step of the create/edit workflow (and the framework requires a
// named capability on any authenticated POST).

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

// The category row as the contract states it. The stored archived flag is 0/1 in SQLite and a
// boolean on the wire — the projection lives here so the two category reads cannot disagree.
function toCategoryEntry(row: {
  id: string;
  name: string;
  appliesTo: string;
  position: number;
  archived: number;
}): z.infer<typeof DirectoryCategory> {
  return {
    id: row.id,
    name: row.name,
    appliesTo: row.appliesTo as "person" | "organization" | "both",
    position: row.position,
    archived: row.archived === 1,
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
// paths are entity-generic — the domain resolves the kind from the id prefix). The brand is
// compile-time only, so this emits as a plain pattern-checked string.
const entityParam = z.object({
  id: z
    .string()
    .regex(directoryEntityIdPattern)
    .openapi({ param: { name: "id", in: "path" } }),
});
type EntityId = DirectoryPersonId | DirectoryOrganizationId;

// A PERSON handle only. Pronouns are a fact about a person, and the generic entity param would let an
// organisation handle through to a write that can only ever match a person row.
const personParam = z.object({
  id: z
    .string()
    .regex(/^directoryPerson_[A-Za-z0-9_-]+$/)
    .openapi({ param: { name: "id", in: "path" } }),
});

const identifierTypeParam = z.object({
  id: z
    .string()
    .regex(directoryEntityIdPattern)
    .openapi({ param: { name: "id", in: "path" } }),
  type: z.enum(IDENTIFIER_TYPES).openapi({ param: { name: "type", in: "path" } }),
});

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
  // A write aimed at a merged-away entity is a conflict, not a 404: the entity is still readable and
  // still carries its merge pointer, so the caller is told the write cannot land there and which
  // surviving master to address instead — the detail names it.
  // A contact point that is gone — removed, or never there — is one answer, not two: the caller
  // cannot act differently on the difference.
  if (
    caught instanceof DirectoryEmailNotFoundError ||
    caught instanceof DirectoryPhoneNotFoundError ||
    caught instanceof DirectoryAddressNotFoundError
  ) {
    return problemJson(c, {
      type: "not-found",
      title: "Not found",
      status: 404,
      detail: caught.message,
    });
  }
  if (
    caught instanceof MergeAlreadyMergedError ||
    caught instanceof MergeSameEntityError ||
    caught instanceof MergedEntityError
  ) {
    return problemJson(c, {
      type: "conflict",
      title: "Merge conflict",
      status: 409,
      detail: caught.message,
    });
  }
  if (
    caught instanceof MergeKindMismatchError ||
    caught instanceof MergeUnknownFieldError ||
    caught instanceof InvalidEdgeTypeError ||
    caught instanceof CategoryAppliesToMismatchError ||
    caught instanceof IdentifierNotIndexableError ||
    caught instanceof InvalidEmailAddressError ||
    caught instanceof InvalidEmailUseError ||
    caught instanceof InvalidPhoneNumberError ||
    caught instanceof InvalidPhoneClassificationError ||
    caught instanceof InvalidAddressClassificationError ||
    caught instanceof EmptyPostalAddressError ||
    caught instanceof InvalidContactVerificationStatusError ||
    caught instanceof InvalidPersonLifeDatesError
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

const setPersonPronounsRoute = defineOpenAPIRoute(
  mutationMeta("setPersonPronouns", WRITE_PERMISSION),
  {
    method: "put",
    path: "/api/v1/directory/persons/{id}/pronouns",
    description:
      "Records the pronouns a person stated, or removes the set on file. Every form is supplied together: " +
      "a partly recorded set is refused, because a document that renders one set's pronoun in one clause " +
      "and another's in the next is wrong in a way nobody catches by reading it. Pronouns are never " +
      "worked out from a name, a courtesy title, or any other field.",
    request: {
      headers: idempotencyKeyHeader,
      params: personParam,
      body: { content: { "application/json": { schema: SetPronounsRequest } }, required: true },
    },
    responses: {
      200: { description: "Recorded", content: { "application/json": { schema: AckResponse } } },
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

const changeNameRoute = defineOpenAPIRoute(mutationMeta("changeName", WRITE_PERMISSION), {
  method: "put",
  path: "/api/v1/directory/entities/{id}/name",
  description:
    "Changes the name an entity currently answers to. This is what records a marriage, a deed poll, " +
    "or an organization's rename: the name on file is not overwritten — it is retained as a former " +
    "name, kept in the search and conflicts corpus with its phonetic codes intact, and stamped with " +
    "the date it stopped being used, while the new name is written as the current one and " +
    "denormalized onto the entity. Appending a name the entity ALSO answers to, without displacing " +
    "the current one, is the entities/{id}/names route instead. The entity kind is resolved from the " +
    "id; supply the person fields or the organization field accordingly.",
  request: {
    headers: idempotencyKeyHeader,
    params: entityParam,
    body: { content: { "application/json": { schema: ChangeNameRequest } }, required: true },
  },
  responses: {
    200: {
      description: "The name was changed and the prior one retained as history",
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

const listNamesRoute = defineOpenAPIRoute(readMeta("listNames", null), {
  method: "get",
  path: "/api/v1/directory/entities/{id}/names",
  description:
    "Returns every name an entity has held — the current one, the former ones, the aliases and the " +
    "trading names — newest-recorded first and cursor-paged. Ordered by when the firm WROTE each " +
    "row rather than by when the name came into use, so the current name heads the list and a " +
    "maiden name recorded onto a decades-old file does not sort to the bottom. Soft-deleted rows " +
    "are excluded, as they are from search.",
  request: { params: entityParam, query: cursorQuery },
  responses: {
    200: {
      description: "A page of the entity's names",
      content: { "application/json": { schema: DirectoryNamePage } },
    },
    401: authErrors[401],
    404: authErrors[404],
    422: authErrors[422],
    429: authErrors[429],
  },
});

// The index. It names no permission beyond an authenticated session, on the same reasoning the name
// search carries: what it discloses — display identity, and the one default way to reach a record —
// is what any member already meets on every matter they can open and can already read a record at a
// time through the contact-points route with this same session.
const listEntitiesRoute = defineOpenAPIRoute(readMeta("listEntities", null), {
  method: "get",
  path: "/api/v1/directory/entities",
  description:
    "Lists the firm's directory — every person and organization it holds, in name order and " +
    "cursor-paged, with `total` giving the size of the whole record. People and organizations are " +
    "ONE sequence: the directory is one book, and `kind` narrows it rather than splitting it. " +
    "Deleted records and records folded into another by a merge are excluded — a folded record " +
    "still answers a search and still resolves to its survivor, but listing it beside that " +
    "survivor would show one client as two. Given `search`, the same read answers a NAME instead: " +
    "the firm's ranked trigram search chooses the records and they come back as the same listing " +
    "rows, in the firm's own relevance order. That answer is capped rather than walkable, so " +
    "`nextCursor` is null, `total` is the size of the answer, and `capped` says whether the firm " +
    "holds more matches than fitted.",
  request: {
    query: cursorQuery.extend({
      kind: z
        .enum(ENTITY_KINDS)
        .optional()
        .openapi({
          param: { name: "kind", in: "query" },
          description: "Narrows to one side of the directory. Omitted, both are listed together.",
        }),
      search: z
        .string()
        .optional()
        .openapi({
          param: { name: "search", in: "query" },
          description:
            "A name to rank the directory against — every name the firm has recorded is matched, " +
            "former names included, and a misspelling still finds the record. The corpus matches " +
            "three-character windows, so a shorter query answers with nothing rather than with " +
            "the whole book. Omitted, the directory is listed in name order.",
        }),
    }),
  },
  responses: {
    200: {
      description:
        "A page of the directory in name order, with the size of the whole record — or, under " +
        "`search`, the ranked matches as the same rows",
      content: { "application/json": { schema: DirectoryEntityListingPage } },
    },
    401: authErrors[401],
    404: authErrors[404],
    429: authErrors[429],
  },
});

const entityNamesRoute = defineOpenAPIRoute(readMeta("entityNames", null), {
  method: "get",
  path: "/api/v1/directory/entity-names",
  description:
    "Names many directory entities in one request: the id, which side of the directory it is, what " +
    "to call it, and whether it has been folded into another record. DISPLAY IDENTITY ONLY — no " +
    "identifier is touched, so nothing here can decrypt, and no contact row is joined, so a list of " +
    "names cannot become a mailing list. That is what makes it cheap enough to call for every row " +
    "on a page and safe enough to need no capability beyond an authenticated session. At most 100 " +
    `ids per call (the platform's bound-parameter cap); an id beyond that is refused rather than ` +
    "silently dropped. An id the firm holds no live row for is ABSENT from the answer — a caller " +
    "renders the gap rather than printing the handle.",
  request: {
    query: z.object({
      ids: z
        .string()
        .min(1)
        .max(6000)
        .openapi({
          param: { name: "ids", in: "query" },
          description: "Comma-separated directory entity handles. At most 100.",
        }),
    }),
  },
  responses: {
    200: {
      description:
        "The display identity of each id the firm holds a live record for, in the order asked",
      content: { "application/json": { schema: EntityDisplayNamesResponse } },
    },
    401: authErrors[401],
    404: authErrors[404],
    422: authErrors[422],
    429: authErrors[429],
  },
});

const listEdgesRoute = defineOpenAPIRoute(readMeta("listEdges", null), {
  method: "get",
  path: "/api/v1/directory/entities/{id}/edges",
  description:
    "Returns the relationships touching one entity — both directions, each carrying which end this " +
    "entity is on and the display name of the far end. Newest first and cursor-paged. Edges whose " +
    "validity has expired are excluded by default; includeExpired returns them too, which is what " +
    "a conflicts review wants because the professional-conduct rules are about FORMER relationships.",
  request: {
    params: entityParam,
    query: cursorQuery.extend({ includeExpired: z.enum(["true", "false"]).optional() }),
  },
  responses: {
    200: {
      description: "A page of the entity's relationships",
      content: { "application/json": { schema: DirectoryEdgePage } },
    },
    401: authErrors[401],
    404: authErrors[404],
    422: authErrors[422],
    429: authErrors[429],
  },
});

const listEntityMatterPartiesRoute = defineOpenAPIRoute(readMeta("listEntityMatterParties", null), {
  method: "get",
  path: "/api/v1/directory/entities/{id}/matter-parties",
  description:
    "Returns the matters this entity is a party to, and the role and capacity it holds on each — " +
    "the mirror of the matter-parties read, which answers for one MATTER. Newest link first and " +
    "cursor-paged. Severed links are excluded; the row is retained so a conflicts report that " +
    "named this party stays reproducible.",
  request: { params: entityParam, query: cursorQuery },
  responses: {
    200: {
      description: "A page of the matters this entity is a party to",
      content: { "application/json": { schema: EntityMatterPartyPage } },
    },
    401: authErrors[401],
    404: authErrors[404],
    422: authErrors[422],
    429: authErrors[429],
  },
});

const listCategoriesRoute = defineOpenAPIRoute(readMeta("listCategories", null), {
  method: "get",
  path: "/api/v1/directory/categories",
  description:
    "The firm's whole category vocabulary in display order, retired labels included and flagged. " +
    "One list serves both the picker and the record, so the two cannot disagree about what a label " +
    "means.",
  responses: {
    200: {
      description: "The firm's categories",
      content: { "application/json": { schema: DirectoryCategoriesResponse } },
    },
    401: authErrors[401],
    404: authErrors[404],
    429: authErrors[429],
  },
});

const listEntityCategoriesRoute = defineOpenAPIRoute(readMeta("listEntityCategories", null), {
  method: "get",
  path: "/api/v1/directory/entities/{id}/categories",
  description: "The categories assigned to one entity, in the firm's own display order.",
  request: { params: entityParam },
  responses: {
    200: {
      description: "The entity's categories",
      content: { "application/json": { schema: DirectoryCategoriesResponse } },
    },
    401: authErrors[401],
    404: authErrors[404],
    429: authErrors[429],
  },
});

const listIdentifiersRoute = defineOpenAPIRoute(readMeta("listIdentifiers", null), {
  method: "get",
  path: "/api/v1/directory/entities/{id}/identifiers",
  description:
    "Says WHICH sealed identifiers an entity holds — the type, the validity period, and when each " +
    "was recorded — and never what any of them is. No ciphertext is read, so this performs no " +
    "decrypt, names no permission beyond the session, and writes no audit row: a record that had " +
    "to decrypt merely to draw its list of headings would put a plaintext social security number " +
    "into the firm's audit log every time a page rendered. Reading a value is the separate, " +
    "permission-gated, audited route on the same path plus a type.",
  request: { params: entityParam },
  responses: {
    200: {
      description: "What the firm holds for this entity, described but not disclosed",
      content: { "application/json": { schema: DirectoryIdentifierRecordsResponse } },
    },
    401: authErrors[401],
    404: authErrors[404],
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
    "relevance. Merged-away entities are excluded. CAPPED at the most relevant matches, and " +
    "`capped` says when the firm holds more than were returned — this read had no bound at all, so " +
    "a broad query against a large directory returned every match in one response.",
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
      "matched. A read-shaped POST (the match facts ride the body) — no write, no decrypt — but it gates " +
      "on directory:edit because it is the entry-time duplicate-prevention step of the create/edit " +
      "workflow, not a general directory read.",
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

const listMatterPartiesRoute = defineOpenAPIRoute(readMeta("listMatterParties", null), {
  method: "get",
  path: "/api/v1/directory/matter-parties",
  description:
    "Returns the live parties on one matter — the link id, the directory entity, the role, and the " +
    "capacity recorded on the link. One entity appears once per role it wears. Severed links are " +
    "excluded.",
  request: { query: z.object({ matterId: identifierField("matter") }) },
  responses: {
    200: {
      description:
        "The matter's parties. A matter that holds none answers with an empty list rather than a " +
        "404 — the read is already scoped to the session firm's own database, so an empty answer " +
        "is the truthful one and distinguishing 'no parties' from 'no such matter' would cost a " +
        "second query to tell a caller something it cannot act on differently.",
      content: { "application/json": { schema: MatterPartyListResponse } },
    },
    400: authErrors[400],
    401: authErrors[401],
    422: authErrors[422],
    429: authErrors[429],
  },
});

const unlinkMatterPartyRoute = defineOpenAPIRoute(
  {
    ...mutationMeta("unlinkMatterParty", WRITE_PERMISSION),
    reversal: { kind: "inverse", by: "directory.linkMatterParty" },
  },
  {
    method: "delete",
    path: "/api/v1/directory/matter-parties/{id}",
    description:
      "Severs one party link. The row is retained and marked severed, never removed, so a conflicts " +
      "report that named this party stays reproducible. Severing a link that is already severed " +
      "reports 404.",
    request: {
      headers: idempotencyKeyHeader,
      params: z.object({ id: identifierField("matterParty") }),
    },
    responses: {
      200: {
        description: "The link was severed",
        content: { "application/json": { schema: UnlinkMatterPartyResponse } },
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

// ---- creating a whole person in one request --------------------------------------------------
//
// The New Person screen reaches every section of the record at creation, and the record is written
// in ONE batch: either all of it lands or none of it does, so a person is never half-recorded and a
// retry never makes a second one. Every nested shape is the same shape its own route takes, so what
// the create accepts is exactly what the record's panes accept one at a time afterwards.

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

const contactPointIdParam = (prefix: string) =>
  z.object({
    id: z
      .string()
      .min(1)
      .regex(new RegExp(`^${prefix}_[A-Za-z0-9_-]+$`))
      .openapi({ param: { name: "id", in: "path" } }),
  });

const emailIdParam = contactPointIdParam("directoryEmail");
const phoneIdParam = contactPointIdParam("directoryPhone");
const addressIdParam = contactPointIdParam("directoryAddress");

// ---- contact-point routes ----------------------------------------------------------------------
const contactPointsRoute = defineOpenAPIRoute(readMeta("contactPoints", null), {
  method: "get",
  path: "/api/v1/directory/entities/{id}/contact-points",
  description:
    "Every way the firm knows to reach one entity — email addresses, telephone and fax numbers, and " +
    "postal addresses — in one read, so a record screen makes one round trip rather than three for " +
    "one question a person asked once. Each carries whether the firm may use it, whether it is the " +
    "one route the person asked to be reached by, and what the firm found the last time it tried to " +
    "confirm it. The answer is bounded by the RECORD, not by a page: these are the ways one person or organization asked to be reached, entered by hand, one at a time, through a permission-gated route. No ingest path and no queue consumer writes these tables. " +
    "A record folded into another by a merge still answers, so an old link lands on something.",
  request: { params: entityParam },
  responses: {
    200: {
      description: "Every contact point on this entity, by channel",
      content: { "application/json": { schema: DirectoryContactPointsResponse } },
    },
    401: authErrors[401],
    404: authErrors[404],
    429: authErrors[429],
  },
});

const listEmailsRoute = defineOpenAPIRoute(readMeta("listEmails", null), {
  method: "get",
  path: "/api/v1/directory/entities/{id}/emails",
  description:
    "The email addresses the firm holds for one entity, the primary one first. The answer is bounded by the RECORD, not by a page: these are the ways one person or organization asked to be reached, entered by hand, one at a time, through a permission-gated route. No ingest path and no queue consumer writes these tables. " +
    "A caller wanting every channel at once reads contact-points instead of asking three times.",
  request: { params: entityParam },
  responses: {
    200: {
      description: "The entity's email addresses",
      content: { "application/json": { schema: DirectoryEmailsResponse } },
    },
    401: authErrors[401],
    404: authErrors[404],
    429: authErrors[429],
  },
});

const addEmailRoute = defineOpenAPIRoute(mutationMeta("addEmail", WRITE_PERMISSION), {
  method: "post",
  path: "/api/v1/directory/entities/{id}/emails",
  description:
    "Records a email address for an entity. More than one is ordinary; isPrimary names this channel's " +
    "default row and demotes whichever held it. Setting the preference `preferred` demotes the " +
    "entity's preferred contact point across email, phone and address alike, because that " +
    "preference is one answer about every channel at once.",
  request: {
    headers: idempotencyKeyHeader,
    params: entityParam,
    body: { content: { "application/json": { schema: AddEmailRequest } }, required: true },
  },
  responses: {
    201: {
      description: "The email address was recorded",
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

const updateEmailRoute = defineOpenAPIRoute(mutationMeta("updateEmail", WRITE_PERMISSION), {
  method: "put",
  path: "/api/v1/directory/emails/{id}",
  description:
    "Changes a email address the firm already holds. An omitted field keeps its stored value, so an " +
    "edit to one field never silently withdraws a permission or reads back as a confirmation the " +
    "firm never made: the verification instant and the member who recorded it move only when the " +
    "verification status itself moves.",
  request: {
    headers: idempotencyKeyHeader,
    params: emailIdParam,
    body: { content: { "application/json": { schema: UpdateEmailRequest } }, required: true },
  },
  responses: {
    200: {
      description: "The email address was updated",
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

const removeEmailRoute = defineOpenAPIRoute(
  {
    ...mutationMeta("removeEmail", WRITE_PERMISSION),
    reversal: { kind: "inverse", by: "directory.addEmail" },
  },
  {
    method: "delete",
    path: "/api/v1/directory/emails/{id}",
    description:
      "Removes a email address from an entity. The row is retained and marked removed, never deleted, " +
      "so a document assembled from it and a conflicts report that named it stay reproducible. " +
      "Removing one that is already removed reports 404. Where the reason is that the person asked " +
      "the firm not to use it, withdraw the permission instead: that keeps the instruction attached " +
      "to the value, and removal does not.",
    request: { headers: idempotencyKeyHeader, params: emailIdParam },
    responses: {
      200: {
        description: "The email address was removed",
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

const listPhonesRoute = defineOpenAPIRoute(readMeta("listPhones", null), {
  method: "get",
  path: "/api/v1/directory/entities/{id}/phones",
  description:
    "The telephone and fax numbers the firm holds for one entity, the primary one first. The answer is bounded by the RECORD, not by a page: these are the ways one person or organization asked to be reached, entered by hand, one at a time, through a permission-gated route. No ingest path and no queue consumer writes these tables. " +
    "A caller wanting every channel at once reads contact-points instead of asking three times.",
  request: { params: entityParam },
  responses: {
    200: {
      description: "The entity's telephone and fax numbers",
      content: { "application/json": { schema: DirectoryPhonesResponse } },
    },
    401: authErrors[401],
    404: authErrors[404],
    429: authErrors[429],
  },
});

const addPhoneRoute = defineOpenAPIRoute(mutationMeta("addPhone", WRITE_PERMISSION), {
  method: "post",
  path: "/api/v1/directory/entities/{id}/phones",
  description:
    "Records a telephone or fax number for an entity. More than one is ordinary; isPrimary names this channel's " +
    "default row and demotes whichever held it. Setting the preference `preferred` demotes the " +
    "entity's preferred contact point across email, phone and address alike, because that " +
    "preference is one answer about every channel at once.",
  request: {
    headers: idempotencyKeyHeader,
    params: entityParam,
    body: { content: { "application/json": { schema: AddPhoneRequest } }, required: true },
  },
  responses: {
    201: {
      description: "The telephone or fax number was recorded",
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

const updatePhoneRoute = defineOpenAPIRoute(mutationMeta("updatePhone", WRITE_PERMISSION), {
  method: "put",
  path: "/api/v1/directory/phones/{id}",
  description:
    "Changes a telephone or fax number the firm already holds. An omitted field keeps its stored value, so an " +
    "edit to one field never silently withdraws a permission or reads back as a confirmation the " +
    "firm never made: the verification instant and the member who recorded it move only when the " +
    "verification status itself moves.",
  request: {
    headers: idempotencyKeyHeader,
    params: phoneIdParam,
    body: { content: { "application/json": { schema: UpdatePhoneRequest } }, required: true },
  },
  responses: {
    200: {
      description: "The telephone or fax number was updated",
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

const removePhoneRoute = defineOpenAPIRoute(
  {
    ...mutationMeta("removePhone", WRITE_PERMISSION),
    reversal: { kind: "inverse", by: "directory.addPhone" },
  },
  {
    method: "delete",
    path: "/api/v1/directory/phones/{id}",
    description:
      "Removes a telephone or fax number from an entity. The row is retained and marked removed, never deleted, " +
      "so a document assembled from it and a conflicts report that named it stay reproducible. " +
      "Removing one that is already removed reports 404. Where the reason is that the person asked " +
      "the firm not to use it, withdraw the permission instead: that keeps the instruction attached " +
      "to the value, and removal does not.",
    request: { headers: idempotencyKeyHeader, params: phoneIdParam },
    responses: {
      200: {
        description: "The telephone or fax number was removed",
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

const listAddressesRoute = defineOpenAPIRoute(readMeta("listAddresses", null), {
  method: "get",
  path: "/api/v1/directory/entities/{id}/addresses",
  description:
    "The postal addresses the firm holds for one entity, the primary one first. The answer is bounded by the RECORD, not by a page: these are the ways one person or organization asked to be reached, entered by hand, one at a time, through a permission-gated route. No ingest path and no queue consumer writes these tables. " +
    "A caller wanting every channel at once reads contact-points instead of asking three times.",
  request: { params: entityParam },
  responses: {
    200: {
      description: "The entity's postal addresses",
      content: { "application/json": { schema: DirectoryAddressesResponse } },
    },
    401: authErrors[401],
    404: authErrors[404],
    429: authErrors[429],
  },
});

const addAddressRoute = defineOpenAPIRoute(mutationMeta("addAddress", WRITE_PERMISSION), {
  method: "post",
  path: "/api/v1/directory/entities/{id}/addresses",
  description:
    "Records a postal address for an entity. More than one is ordinary; isPrimary names this channel's " +
    "default row and demotes whichever held it. Setting the preference `preferred` demotes the " +
    "entity's preferred contact point across email, phone and address alike, because that " +
    "preference is one answer about every channel at once.",
  request: {
    headers: idempotencyKeyHeader,
    params: entityParam,
    body: { content: { "application/json": { schema: AddAddressRequest } }, required: true },
  },
  responses: {
    201: {
      description: "The postal address was recorded",
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

const updateAddressRoute = defineOpenAPIRoute(mutationMeta("updateAddress", WRITE_PERMISSION), {
  method: "put",
  path: "/api/v1/directory/addresses/{id}",
  description:
    "Changes a postal address the firm already holds. An omitted field keeps its stored value, so an " +
    "edit to one field never silently withdraws a permission or reads back as a confirmation the " +
    "firm never made: the verification instant and the member who recorded it move only when the " +
    "verification status itself moves.",
  request: {
    headers: idempotencyKeyHeader,
    params: addressIdParam,
    body: { content: { "application/json": { schema: UpdateAddressRequest } }, required: true },
  },
  responses: {
    200: {
      description: "The postal address was updated",
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

const removeAddressRoute = defineOpenAPIRoute(
  {
    ...mutationMeta("removeAddress", WRITE_PERMISSION),
    reversal: { kind: "inverse", by: "directory.addAddress" },
  },
  {
    method: "delete",
    path: "/api/v1/directory/addresses/{id}",
    description:
      "Removes a postal address from an entity. The row is retained and marked removed, never deleted, " +
      "so a document assembled from it and a conflicts report that named it stay reproducible. " +
      "Removing one that is already removed reports 404. Where the reason is that the person asked " +
      "the firm not to use it, withdraw the permission instead: that keeps the instruction attached " +
      "to the value, and removal does not.",
    request: { headers: idempotencyKeyHeader, params: addressIdParam },
    responses: {
      200: {
        description: "The postal address was removed",
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

const setPersonLifeDatesRoute = defineOpenAPIRoute(
  mutationMeta("setPersonLifeDates", WRITE_PERMISSION),
  {
    method: "put",
    path: "/api/v1/directory/persons/{id}/life-dates",
    description:
      "Records a person's date of birth, date of death, and whether they are known to have died. " +
      "These are attributes of a person rather than identifiers of one: nobody issued them, they " +
      "identify nobody uniquely, and every question a firm asks of them is a range — is this client " +
      "a minor, has a limitation period tolled, whose birthday falls this month. An omitted field " +
      "keeps its stored value; an explicit null clears it. A recorded date of death implies the " +
      "deceased flag, and known dead with the date unknown is a state the record can hold.",
    request: {
      headers: idempotencyKeyHeader,
      params: personParam,
      body: {
        content: { "application/json": { schema: SetPersonLifeDatesRequest } },
        required: true,
      },
    },
    responses: {
      200: {
        description: "The dates were recorded",
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
  },
);

type DirectoryApp = OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>;

export function registerDirectoryRoutes(app: DirectoryApp, chokepoint: Chokepoint): void {
  // POST /api/v1/directory/persons
  app.openapi(
    { ...createPersonRoute, middleware: chokepointMiddleware(chokepoint, createPersonRoute) },
    async (c) => {
      const idempotency = requireChokepointIdempotency(c);
      const request = c.req.valid("json");
      // Every identifier is checked for its shape before anything is composed, so a draft with a
      // short social security number is refused with the sentence the screen shows, not sealed.
      const identifiers: AddIdentifierInput[] = [];
      for (const identifier of request.identifiers ?? []) {
        const checked = checkIdentifier(identifier.type, {
          label: identifier.label ?? null,
          number: identifier.number,
          username: identifier.username ?? null,
          secret: identifier.secret ?? null,
        });
        if (!checked.ok) {
          return problemJson(c, {
            type: "validation",
            title: "Directory request invalid",
            status: 422,
            detail: checked.reason,
          });
        }
        identifiers.push({
          type: identifier.type,
          value: checked.value,
          label: checked.label,
          validFrom: identifier.validFrom ?? null,
          validTo: identifier.validTo ?? null,
        });
      }
      const context = await identifierContext(c, idempotency);
      try {
        const id = await createPersonRecord(context, {
          name: {
            given: request.given,
            family: request.family ?? "",
            prefix: request.prefix ?? null,
            middle: request.middle ?? null,
            suffix: request.suffix ?? null,
          },
          otherNames: (request.otherNames ?? []).map((name) => ({
            given: name.given,
            family: name.family,
            nameRole: name.nameRole,
            prefix: name.prefix ?? null,
            middle: name.middle ?? null,
            suffix: name.suffix ?? null,
          })),
          pronouns: request.pronouns ?? null,
          dateOfBirth: request.dateOfBirth ?? null,
          dateOfDeath: request.dateOfDeath ?? null,
          emails: (request.emails ?? []).map((email) => ({
            address: email.address,
            contactUse: email.contactUse ?? null,
            isPrimary: email.isPrimary,
            preference: email.preference,
            verification: email.verification,
          })),
          phones: (request.phones ?? []).map((phone) => ({
            number: phone.number,
            contactSystem: phone.contactSystem,
            contactUse: phone.contactUse ?? null,
            extension: phone.extension ?? null,
            countryRegionCode: phone.countryRegionCode ?? null,
            isPrimary: phone.isPrimary,
            preference: phone.preference,
            verification: phone.verification,
          })),
          addresses: (request.addresses ?? []).map((address) => ({
            recipient: address.recipient ?? null,
            organizationName: address.organizationName ?? null,
            street: address.street ?? null,
            streetTwo: address.streetTwo ?? null,
            dependentLocality: address.dependentLocality ?? null,
            city: address.city ?? null,
            region: address.region ?? null,
            postal: address.postal ?? null,
            sortingCode: address.sortingCode ?? null,
            country: address.country ?? null,
            addressUse: address.addressUse ?? null,
            addressType: address.addressType,
            isPrimary: address.isPrimary,
            preference: address.preference,
            verification: address.verification,
          })),
          identifiers,
          organizations: (request.organizations ?? []).map((organization) => ({
            organizationId: organization.organizationId,
            edgeType: organization.edgeType,
            personIs: organization.personIs,
            role: organization.role ?? null,
            note: organization.note ?? null,
          })),
        });
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

  // PUT /api/v1/directory/persons/{id}/pronouns
  app.openapi(
    {
      ...setPersonPronounsRoute,
      middleware: chokepointMiddleware(chokepoint, setPersonPronounsRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { id } = c.req.valid("param");
      const request = c.req.valid("json");
      try {
        await setPersonPronouns(
          firm.firmDatabase,
          id as DirectoryPersonId,
          request.pronouns,
          writeOptions(userId, idempotency),
        );
        return c.json({ ok: true } as z.infer<typeof AckResponse>, 200);
      } catch (caught) {
        if (caught instanceof IncompletePronounSetError) {
          return problemJson(c, {
            type: "validation",
            title: "Directory request invalid",
            status: 422,
            detail: caught.message,
          });
        }
        return directoryErrorResponse(c, caught);
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

  // PUT /api/v1/directory/entities/{id}/name — the name CHANGE, which retains the prior name
  app.openapi(
    { ...changeNameRoute, middleware: chokepointMiddleware(chokepoint, changeNameRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { id } = c.req.valid("param");
      const request = c.req.valid("json");
      // The kind comes from the handle and the body must match it: a mismatch is a caller mistake,
      // so it is a 422 naming the fields that entity takes, not the domain's bare Error and a 500.
      const isPerson = id.startsWith("directoryPerson_");
      if (isPerson && (request.given === undefined || request.family === undefined)) {
        return problemJson(c, {
          type: "validation",
          title: "Directory request invalid",
          status: 422,
          detail: "A person's name change supplies both given and family.",
        });
      }
      if (!isPerson && request.legalName === undefined) {
        return problemJson(c, {
          type: "validation",
          title: "Directory request invalid",
          status: 422,
          detail: "An organization's name change supplies legalName.",
        });
      }
      try {
        await changeName(
          firm.firmDatabase,
          id as EntityId,
          isPerson
            ? {
                given: request.given ?? "",
                family: request.family ?? "",
                prefix: request.prefix ?? null,
                middle: request.middle ?? null,
                suffix: request.suffix ?? null,
              }
            : {
                legalName: request.legalName ?? "",
                displayName: request.displayName ?? null,
              },
          writeOptions(userId, idempotency),
          request.correction === true ? "correction" : "change",
        );
        return c.json({ ok: true } as z.infer<typeof AckResponse>, 200);
      } catch (caught) {
        return directoryErrorResponse(c, caught);
      }
    },
  );

  // GET /api/v1/directory/entities/{id}/names
  app.openapi(
    { ...listNamesRoute, middleware: chokepointMiddleware(chokepoint, listNamesRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { id } = c.req.valid("param");
      const { cursor } = c.req.valid("query");
      const page = await readNames(firm.firmDatabase, id as EntityId, { cursor });
      return c.json(page as unknown as z.infer<typeof DirectoryNamePage>, 200);
    },
  );

  // GET /api/v1/directory/entities — the index, both kinds in one sequence
  app.openapi(
    { ...listEntitiesRoute, middleware: chokepointMiddleware(chokepoint, listEntitiesRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { cursor, kind, search } = c.req.valid("query");
      const page = await readEntityListing(firm.firmDatabase, {
        cursor,
        kind: kind ?? "all",
        search,
      });
      return c.json(page as unknown as z.infer<typeof DirectoryEntityListingPage>, 200);
    },
  );

  // GET /api/v1/directory/entity-names?ids= — the naming read, many entities in one request
  app.openapi(
    { ...entityNamesRoute, middleware: chokepointMiddleware(chokepoint, entityNamesRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { ids } = c.req.valid("query");
      const requested = ids
        .split(",")
        .map((entityId) => entityId.trim())
        .filter((entityId) => entityId !== "");
      // Refused, not truncated. A caller handed a short answer to a long question would believe the
      // missing entities are ones the firm does not hold, and blank the wrong rows.
      if (requested.length > MAX_ENTITY_DISPLAY_NAME_LOOKUP) {
        return problemJson(c, {
          type: "validation",
          title: "Directory request invalid",
          status: 422,
          detail: `At most ${String(MAX_ENTITY_DISPLAY_NAME_LOOKUP)} ids per call; ${String(requested.length)} were supplied.`,
        });
      }
      const data = await readEntityDisplayNames(firm.firmDatabase, requested);
      return c.json({ data } as z.infer<typeof EntityDisplayNamesResponse>, 200);
    },
  );

  // GET /api/v1/directory/entities/{id}/edges
  app.openapi(
    { ...listEdgesRoute, middleware: chokepointMiddleware(chokepoint, listEdgesRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { id } = c.req.valid("param");
      const { cursor, includeExpired } = c.req.valid("query");
      const page = await readEdgesPage(firm.firmDatabase, id as EntityId, {
        cursor,
        includeExpired: includeExpired === "true",
      });
      // ONE naming read for the whole page. Resolving each far end on its own is the per-row request
      // this endpoint's sibling exists to prevent, and doing it here would be that same mistake
      // moved server-side.
      const names = new Map(
        (
          await readEntityDisplayNames(
            firm.firmDatabase,
            page.data.map((edge) =>
              edge.fromEntityId === id ? edge.toEntityId : edge.fromEntityId,
            ),
          )
        ).map((entry) => [entry.entityId, entry]),
      );
      const body: z.infer<typeof DirectoryEdgePage> = {
        data: page.data.map((edge) => {
          const outbound = edge.fromEntityId === id;
          const farEntityId = outbound ? edge.toEntityId : edge.fromEntityId;
          const far = names.get(farEntityId);
          return {
            id: edge.id,
            edgeType: edge.edgeType,
            direction: outbound ? "outbound" : "inbound",
            farEntityId,
            farEntityKind: far?.entityKind ?? "unknown",
            farDisplayName: far?.displayName ?? null,
            role: edge.role,
            note: edge.note,
            validFrom: edge.validFrom,
            validTo: edge.validTo,
          };
        }),
        nextCursor: page.nextCursor,
      };
      return c.json(body, 200);
    },
  );

  // GET /api/v1/directory/entities/{id}/matter-parties
  app.openapi(
    {
      ...listEntityMatterPartiesRoute,
      middleware: chokepointMiddleware(chokepoint, listEntityMatterPartiesRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { id } = c.req.valid("param");
      const { cursor } = c.req.valid("query");
      const page = await readMatterPartiesForEntity(firm.firmDatabase, id, { cursor });
      return c.json(page as unknown as z.infer<typeof EntityMatterPartyPage>, 200);
    },
  );

  // GET /api/v1/directory/categories
  app.openapi(
    { ...listCategoriesRoute, middleware: chokepointMiddleware(chokepoint, listCategoriesRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const categories = await listCategories(firm.firmDatabase);
      return c.json(
        { data: categories.map(toCategoryEntry) } as z.infer<typeof DirectoryCategoriesResponse>,
        200,
      );
    },
  );

  // GET /api/v1/directory/entities/{id}/categories
  app.openapi(
    {
      ...listEntityCategoriesRoute,
      middleware: chokepointMiddleware(chokepoint, listEntityCategoriesRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { id } = c.req.valid("param");
      const categories = await readCategories(firm.firmDatabase, id);
      return c.json(
        { data: categories.map(toCategoryEntry) } as z.infer<typeof DirectoryCategoriesResponse>,
        200,
      );
    },
  );

  // GET /api/v1/directory/entities/{id}/identifiers — describes what is held, decrypts nothing
  app.openapi(
    { ...listIdentifiersRoute, middleware: chokepointMiddleware(chokepoint, listIdentifiersRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { id } = c.req.valid("param");
      const data = await listIdentifierRecords(firm.firmDatabase, id);
      return c.json({ data } as unknown as z.infer<typeof DirectoryIdentifierRecordsResponse>, 200);
    },
  );

  // POST /api/v1/directory/entities/{id}/identifiers
  app.openapi(
    { ...addIdentifierRoute, middleware: chokepointMiddleware(chokepoint, addIdentifierRoute) },
    async (c) => {
      const idempotency = requireChokepointIdempotency(c);
      const { id } = c.req.valid("param");
      const request = c.req.valid("json");
      const checked = checkIdentifier(request.type, {
        label: request.label ?? null,
        number: request.number,
        username: request.username ?? null,
        secret: request.secret ?? null,
      });
      if (!checked.ok) {
        return problemJson(c, {
          type: "validation",
          title: "Directory request invalid",
          status: 422,
          detail: checked.reason,
        });
      }
      const context = await identifierContext(c, idempotency);
      try {
        await addIdentifier(context, id, {
          type: request.type,
          value: checked.value,
          label: checked.label,
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
      try {
        const sealed = await readIdentifier(context, id, type);
        // An account was sealed as its three parts together; the reveal hands them back apart.
        const body: z.infer<typeof IdentifierValueResponse> =
          sealed !== null && type === "account"
            ? (() => {
                const account = parseAccountValue(sealed);
                return {
                  value: account.number,
                  username: account.username,
                  secret: account.secret,
                };
              })()
            : { value: sealed };
        return c.json(body, 200);
      } catch (caught) {
        // The chokepoint already gates directory:viewSensitiveIdentifiers before this handler, so a
        // forbidden read is normally unreachable — but if the protected-field gate ever refuses, surface
        // a structured 403 (never a 500, never the plaintext) instead of an unhandled throw.
        if (caught instanceof ProtectedReadForbiddenError) {
          return problemJson(c, {
            type: "permission-denied",
            title: "Forbidden",
            status: 403,
            detail: caught.message,
          });
        }
        throw caught;
      }
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
      const { hits, capped } = await searchNames(firm.firmDatabase, q);
      return c.json({ data: hits, capped } as unknown as z.infer<typeof SearchResponse>, 200);
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
      const candidates = await findDuplicateCandidates(context, {
        kind: request.kind,
        given: request.given,
        family: request.family,
        legalName: request.legalName,
        identifiers: request.identifiers,
        excludeEntityId: request.excludeEntityId,
      });
      // Project to the declared contract: channels/identifierTypes are internal evidence-tiering
      // detail for the conflicts engine's direct package consumer, not part of the HTTP response.
      //
      // The display identity rides along, resolved in ONE naming read over the whole answer. A
      // candidate list is a list, and a caller that resolved each candidate itself made one request
      // per candidate — which is exactly the shape the naming read exists to end.
      const names = new Map(
        (
          await readEntityDisplayNames(
            context.database,
            candidates.map((candidate) => candidate.entityId),
          )
        ).map((entry) => [entry.entityId, entry]),
      );
      const data = candidates.map(({ entityId, signalCount }) => {
        const named = names.get(entityId);
        return {
          entityId,
          signalCount,
          entityKind: named?.entityKind ?? ("unknown" as const),
          displayName: named?.displayName ?? null,
        };
      });
      const body: z.infer<typeof DuplicateCandidatesResponse> = { data };
      return c.json(body, 200);
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
          {
            matterId: request.matterId,
            entityId: request.entityId,
            role: request.role,
            capacity: request.capacity ?? null,
          },
          writeOptions(userId, idempotency),
        );
        return c.json({ id } as z.infer<typeof MatterPartyResponse>, 201);
      } catch (caught) {
        return directoryErrorResponse(c, caught);
      }
    },
  );

  // GET /api/v1/directory/matter-parties
  app.openapi(
    {
      ...listMatterPartiesRoute,
      middleware: chokepointMiddleware(chokepoint, listMatterPartiesRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { matterId } = c.req.valid("query");
      const parties = await readMatterParties(firm.firmDatabase, matterId);
      return c.json({ parties } as z.infer<typeof MatterPartyListResponse>, 200);
    },
  );

  // DELETE /api/v1/directory/matter-parties/{id}
  app.openapi(
    {
      ...unlinkMatterPartyRoute,
      middleware: chokepointMiddleware(chokepoint, unlinkMatterPartyRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { id } = c.req.valid("param");
      try {
        const unlinked = await unlinkMatterParty(
          firm.firmDatabase,
          id as MatterPartyId,
          writeOptions(userId, idempotency),
        );
        // A link that was already severed, or never existed, is indistinguishable from here and
        // both are "there is no live link at this id" — one 404 for both, rather than inventing a
        // distinction the caller cannot act on differently.
        if (!unlinked) {
          return problemJson(c, {
            type: "not-found",
            title: "Not found",
            status: 404,
            detail: "No live party link carries this id.",
          });
        }
        return c.json({ unlinked } as z.infer<typeof UnlinkMatterPartyResponse>, 200);
      } catch (caught) {
        return directoryErrorResponse(c, caught);
      }
    },
  );
  // GET /api/v1/directory/entities/{id}/contact-points
  app.openapi(
    { ...contactPointsRoute, middleware: chokepointMiddleware(chokepoint, contactPointsRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { id } = c.req.valid("param");
      try {
        const points = await readContactPoints(firm.firmDatabase, id);
        return c.json(points as unknown as z.infer<typeof DirectoryContactPointsResponse>, 200);
      } catch {
        // The only thing this read can fail on is an entity the firm does not hold; every other
        // outcome is an empty channel, which is an answer.
        return problemJson(c, {
          type: "not-found",
          title: "Not found",
          status: 404,
          detail: "No such directory record in this firm.",
        });
      }
    },
  );

  // GET /api/v1/directory/entities/{id}/emails
  app.openapi(
    { ...listEmailsRoute, middleware: chokepointMiddleware(chokepoint, listEmailsRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { id } = c.req.valid("param");
      try {
        const { emails } = await readContactPoints(firm.firmDatabase, id);
        return c.json({ data: emails } as unknown as z.infer<typeof DirectoryEmailsResponse>, 200);
      } catch {
        // The only thing this read can fail on is an entity the firm does not hold; every other
        // outcome is an empty channel, which is an answer.
        return problemJson(c, {
          type: "not-found",
          title: "Not found",
          status: 404,
          detail: "No such directory record in this firm.",
        });
      }
    },
  );

  // POST /api/v1/directory/entities/{id}/emails
  app.openapi(
    { ...addEmailRoute, middleware: chokepointMiddleware(chokepoint, addEmailRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { id } = c.req.valid("param");
      const request = c.req.valid("json");
      try {
        const emailId = await addEmail(
          firm.firmDatabase,
          {
            entityId: id,
            address: request.address,
            contactUse: request.contactUse ?? null,
            isPrimary: request.isPrimary,
            preference: request.preference,
            verification: request.verification,
          },
          writeOptions(userId, idempotency),
        );
        return c.json({ id: emailId } as z.infer<typeof CreatedEntityResponse>, 201);
      } catch (caught) {
        return directoryErrorResponse(c, caught);
      }
    },
  );

  // PUT /api/v1/directory/emails/{id}
  app.openapi(
    { ...updateEmailRoute, middleware: chokepointMiddleware(chokepoint, updateEmailRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { id } = c.req.valid("param");
      const request = c.req.valid("json");
      try {
        const emailId = await updateEmail(
          firm.firmDatabase,
          {
            emailId: id,
            address: request.address,
            contactUse: request.contactUse,
            isPrimary: request.isPrimary,
            preference: request.preference,
            verification: request.verification,
          },
          writeOptions(userId, idempotency),
        );
        return c.json({ id: emailId } as z.infer<typeof CreatedEntityResponse>, 200);
      } catch (caught) {
        return directoryErrorResponse(c, caught);
      }
    },
  );

  // DELETE /api/v1/directory/emails/{id}
  app.openapi(
    { ...removeEmailRoute, middleware: chokepointMiddleware(chokepoint, removeEmailRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { id } = c.req.valid("param");
      try {
        const emailId = await removeEmail(firm.firmDatabase, id, writeOptions(userId, idempotency));
        return c.json({ id: emailId } as z.infer<typeof CreatedEntityResponse>, 200);
      } catch (caught) {
        return directoryErrorResponse(c, caught);
      }
    },
  );

  // GET /api/v1/directory/entities/{id}/phones
  app.openapi(
    { ...listPhonesRoute, middleware: chokepointMiddleware(chokepoint, listPhonesRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { id } = c.req.valid("param");
      try {
        const { phones } = await readContactPoints(firm.firmDatabase, id);
        return c.json({ data: phones } as unknown as z.infer<typeof DirectoryPhonesResponse>, 200);
      } catch {
        // The only thing this read can fail on is an entity the firm does not hold; every other
        // outcome is an empty channel, which is an answer.
        return problemJson(c, {
          type: "not-found",
          title: "Not found",
          status: 404,
          detail: "No such directory record in this firm.",
        });
      }
    },
  );

  // POST /api/v1/directory/entities/{id}/phones
  app.openapi(
    { ...addPhoneRoute, middleware: chokepointMiddleware(chokepoint, addPhoneRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { id } = c.req.valid("param");
      const request = c.req.valid("json");
      try {
        const phoneId = await addPhone(
          firm.firmDatabase,
          {
            entityId: id,
            number: request.number,
            contactSystem: request.contactSystem,
            contactUse: request.contactUse ?? null,
            extension: request.extension,
            countryRegionCode: request.countryRegionCode,
            isPrimary: request.isPrimary,
            preference: request.preference,
            verification: request.verification,
          },
          writeOptions(userId, idempotency),
        );
        return c.json({ id: phoneId } as z.infer<typeof CreatedEntityResponse>, 201);
      } catch (caught) {
        return directoryErrorResponse(c, caught);
      }
    },
  );

  // PUT /api/v1/directory/phones/{id}
  app.openapi(
    { ...updatePhoneRoute, middleware: chokepointMiddleware(chokepoint, updatePhoneRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { id } = c.req.valid("param");
      const request = c.req.valid("json");
      try {
        const phoneId = await updatePhone(
          firm.firmDatabase,
          {
            phoneId: id,
            number: request.number,
            contactSystem: request.contactSystem,
            contactUse: request.contactUse,
            extension: request.extension,
            countryRegionCode: request.countryRegionCode,
            isPrimary: request.isPrimary,
            preference: request.preference,
            verification: request.verification,
          },
          writeOptions(userId, idempotency),
        );
        return c.json({ id: phoneId } as z.infer<typeof CreatedEntityResponse>, 200);
      } catch (caught) {
        return directoryErrorResponse(c, caught);
      }
    },
  );

  // DELETE /api/v1/directory/phones/{id}
  app.openapi(
    { ...removePhoneRoute, middleware: chokepointMiddleware(chokepoint, removePhoneRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { id } = c.req.valid("param");
      try {
        const phoneId = await removePhone(firm.firmDatabase, id, writeOptions(userId, idempotency));
        return c.json({ id: phoneId } as z.infer<typeof CreatedEntityResponse>, 200);
      } catch (caught) {
        return directoryErrorResponse(c, caught);
      }
    },
  );

  // GET /api/v1/directory/entities/{id}/addresses
  app.openapi(
    { ...listAddressesRoute, middleware: chokepointMiddleware(chokepoint, listAddressesRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { id } = c.req.valid("param");
      try {
        const { addresses } = await readContactPoints(firm.firmDatabase, id);
        return c.json(
          { data: addresses } as unknown as z.infer<typeof DirectoryAddressesResponse>,
          200,
        );
      } catch {
        // The only thing this read can fail on is an entity the firm does not hold; every other
        // outcome is an empty channel, which is an answer.
        return problemJson(c, {
          type: "not-found",
          title: "Not found",
          status: 404,
          detail: "No such directory record in this firm.",
        });
      }
    },
  );

  // POST /api/v1/directory/entities/{id}/addresses
  app.openapi(
    { ...addAddressRoute, middleware: chokepointMiddleware(chokepoint, addAddressRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { id } = c.req.valid("param");
      const request = c.req.valid("json");
      try {
        const addressId = await addAddress(
          firm.firmDatabase,
          { ...request, entityId: id },
          writeOptions(userId, idempotency),
        );
        return c.json({ id: addressId } as z.infer<typeof CreatedEntityResponse>, 201);
      } catch (caught) {
        return directoryErrorResponse(c, caught);
      }
    },
  );

  // PUT /api/v1/directory/addresses/{id}
  app.openapi(
    { ...updateAddressRoute, middleware: chokepointMiddleware(chokepoint, updateAddressRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { id } = c.req.valid("param");
      const request = c.req.valid("json");
      try {
        const addressId = await updateAddress(
          firm.firmDatabase,
          { ...request, addressId: id },
          writeOptions(userId, idempotency),
        );
        return c.json({ id: addressId } as z.infer<typeof CreatedEntityResponse>, 200);
      } catch (caught) {
        return directoryErrorResponse(c, caught);
      }
    },
  );

  // DELETE /api/v1/directory/addresses/{id}
  app.openapi(
    { ...removeAddressRoute, middleware: chokepointMiddleware(chokepoint, removeAddressRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { id } = c.req.valid("param");
      try {
        const addressId = await removeAddress(
          firm.firmDatabase,
          id,
          writeOptions(userId, idempotency),
        );
        return c.json({ id: addressId } as z.infer<typeof CreatedEntityResponse>, 200);
      } catch (caught) {
        return directoryErrorResponse(c, caught);
      }
    },
  );

  // PUT /api/v1/directory/persons/{id}/life-dates
  app.openapi(
    {
      ...setPersonLifeDatesRoute,
      middleware: chokepointMiddleware(chokepoint, setPersonLifeDatesRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { id } = c.req.valid("param");
      const request = c.req.valid("json");
      try {
        await setPersonLifeDates(
          firm.firmDatabase,
          id as DirectoryPersonId,
          {
            dateOfBirth: request.dateOfBirth,
            dateOfDeath: request.dateOfDeath,
            deceased: request.deceased,
          },
          writeOptions(userId, idempotency),
        );
        return c.json({ ok: true } as z.infer<typeof AckResponse>, 200);
      } catch (caught) {
        return directoryErrorResponse(c, caught);
      }
    },
  );
}
