import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { decodeBase64, imageResponse, sha256Hex } from "../shared/image-bytes.ts";
import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import type { BatchDatabase, EffectWrite } from "@magna-carta/data-access/effect-batch";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import { readFirmSetting } from "@magna-carta/data-access/setting-statements";
import { readImageFacts } from "@magna-carta/document-assembly/ooxml-image";
import { readFirmPrimaryBrandImage } from "@magna-carta/locations/brand-image-service";
import {
  addMemberToLocation,
  assignMemberLocations,
  clearLetterheadLogo,
  closeLocation,
  createLocation,
  removeMemberFromLocation,
  setFirmDefaultLocation,
  setLetterheadLogo,
  setLocationAddresses,
  updateLocation,
} from "@magna-carta/locations/location-service";
import { firmDefaultLocationDefinition } from "@magna-carta/locations/settings";
import {
  readAllLocationAddresses,
  readLocationAddresses,
  readLocationMembers,
  readLocationRegisterRows,
  type LocationAddressRow,
} from "@magna-carta/locations/statements";
import { LocationValidationError } from "@magna-carta/locations/validation";
import type { LocationId, UserId } from "@magna-carta/identifiers/types";
import { firmScopedObjectDimensions } from "@magna-carta/object-dimensions/dimensions";
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
import {
  idempotencyKeyHeader,
  identifierField,
  identifierPathParam,
} from "../../contracts/common.ts";
import { Problem, problemJson, type ProblemResponse } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";
import { resolveFirmBucket } from "../../../files/firm-bucket.ts";
import { problemResponseForIdempotencyConflict } from "../../idempotency-conflict-problems.ts";

// Locations: the firm's offices (numbering code, letterhead/remit fields, addresses, staff
// assignment). The locations package owns validation (one-primary-per-member, firm-default close
// refusal); these handlers commit the returned effect idempotently. Reads are open to any
// authenticated firm member; writes require locations:manage.

const LocationRequest = z
  .object({
    name: z.string().min(1),
    jurisdiction: z.string().nullable().optional(),
    // The office's IANA time zone (America/Los_Angeles) — never a fixed offset, which is wrong for
    // half the year wherever daylight saving is observed. It is what a document's dates render in,
    // and what a calendar defaults a new event to.
    timeZone: z.string().min(1).max(120).nullable().optional(),
    numberCode: z.string().nullable().optional(),
    addressBlock: z.string().nullable().optional(),
    footer: z.string().nullable().optional(),
    remitTo: z.string().nullable().optional(),
    // The one way to write to this office. Its telephone belongs to each of its addresses.
    email: z.string().max(320).nullable().optional(),
  })
  .openapi("LocationRequest");

const PatchLocationRequest = z
  .object({
    name: z.string().min(1).optional(),
    jurisdiction: z.string().nullable().optional(),
    // The office's IANA time zone (America/Los_Angeles) — never a fixed offset, which is wrong for
    // half the year wherever daylight saving is observed. It is what a document's dates render in,
    // and what a calendar defaults a new event to.
    timeZone: z.string().min(1).max(120).nullable().optional(),
    numberCode: z.string().nullable().optional(),
    addressBlock: z.string().nullable().optional(),
    footer: z.string().nullable().optional(),
    remitTo: z.string().nullable().optional(),
    email: z.string().max(320).nullable().optional(),
  })
  .openapi("PatchLocationRequest");

// The international address field set, named for POSITION in an address — the same lines the
// directory's addresses carry, so the product's one country-shaped address form writes an office's
// address the way it writes anybody's. The country decides which lines a form shows.
const AddressInputSchema = z.object({
  kind: z.enum(["physical", "mailing"]),
  street: z.string().nullable().optional(),
  streetTwo: z.string().nullable().optional(),
  dependentLocality: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  region: z.string().nullable().optional(),
  postal: z.string().nullable().optional(),
  sortingCode: z.string().nullable().optional(),
  country: z.string().length(2).nullable().optional(),
  phone: z.string().nullable().optional(),
});
const AddressesRequest = z
  .object({ addresses: z.array(AddressInputSchema) })
  .openapi("LocationAddressesRequest");

const LocationAddress = z
  .object({
    kind: z.enum(["physical", "mailing"]),
    street: z.string().nullable(),
    streetTwo: z.string().nullable(),
    dependentLocality: z.string().nullable(),
    city: z.string().nullable(),
    region: z.string().nullable(),
    postal: z.string().nullable(),
    sortingCode: z.string().nullable(),
    country: z.string().nullable(),
    phone: z.string().nullable(),
  })
  .openapi("LocationAddress");

const MemberLocationsRequest = z
  .object({
    assignments: z.array(
      z.object({ locationId: identifierField("location"), isPrimary: z.boolean() }),
    ),
  })
  .openapi("MemberLocationsRequest");

const LocationMemberRequest = z
  .object({
    // Whether this office becomes the member's primary. A member's first office is primary whatever
    // this says, because a member with any office has to have one.
    isPrimary: z.boolean().optional(),
  })
  .openapi("LocationMemberRequest");

const LocationMember = z
  .object({
    userId: z.string(),
    displayName: z.string(),
    status: z.enum(["active", "deactivated"]),
    isPrimary: z.boolean(),
  })
  .openapi("LocationMember");

// The register row: every stored fact a reader scans offices by, with its addresses and its
// staffing count joined, so the screen never asks one question per row. The letterhead TEXT stays
// on the detail read — it is the office's own record, not a column.
const LocationSummary = z
  .object({
    id: z.string(),
    name: z.string(),
    status: z.enum(["active", "closed"]),
    jurisdiction: z.string().nullable(),
    timeZone: z.string().nullable(),
    numberCode: z.string().nullable(),
    email: z.string().nullable(),
    addresses: z.array(LocationAddress),
    members: z.number().int(),
    hasLetterheadLogo: z.boolean(),
    firmDefault: z.boolean(),
  })
  .openapi("LocationSummary");
const LocationListResponse = z
  .object({ data: z.array(LocationSummary) })
  .openapi("LocationListResponse");
// The letterhead logo is uploaded INLINE rather than through a presigned session. A firm's mark is tens
// of kilobytes, and one request carrying the bytes is the only shape where reading what they are,
// measuring them, and writing the row that points at them all happen together — a presigned upload
// would put unvalidated bytes in the bucket first and leave an orphan behind every refusal.
const LetterheadLogoRequest = z
  .object({
    // Base64 of the image itself. What the bytes ARE is decided by reading them; a declared content
    // type is a claim about an upload rather than a fact about it, so none is accepted here.
    imageBase64: z.string().min(1),
    // How wide the mark prints, in points — the unit a word processor's ruler shows. A height is never
    // supplied: it follows from the image's own proportions, so a letterhead cannot print a stretched
    // logo and swapping a wide mark for a tall one re-lays every template out correctly.
    printedWidthPoints: z.number().positive().max(720),
  })
  .openapi("LetterheadLogoRequest");

const LetterheadLogo = z
  .object({
    contentType: z.string(),
    sizeBytes: z.number().int(),
    widthPixels: z.number().int(),
    heightPixels: z.number().int(),
    printedWidthPoints: z.number(),
    updatedAt: z.string().nullable(),
  })
  .openapi("LetterheadLogo");

const LocationDetail = z
  .object({
    id: z.string(),
    name: z.string(),
    status: z.enum(["active", "closed"]),
    jurisdiction: z.string().nullable(),
    timeZone: z.string().nullable(),
    numberCode: z.string().nullable(),
    addressBlock: z.string().nullable(),
    footer: z.string().nullable(),
    remitTo: z.string().nullable(),
    email: z.string().nullable(),
    addresses: z.array(LocationAddress),
    members: z.array(LocationMember),
    firmDefault: z.boolean(),
    letterheadLogo: LetterheadLogo.nullable(),
    // Where the mark this office prints comes from: its own logo, the firm's primary mark where it
    // has none, or nowhere. Stated so the screen can say "prints the firm's mark" rather than
    // showing an empty logo slot on an office that prints one.
    letterheadSource: z.enum(["office", "firm", "none"]),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi("LocationDetail");
const IdAck = z.object({ id: z.string() }).openapi("LocationAck");

const locationParam = z.object({ id: identifierPathParam("location", "id") });
const memberParam = z.object({ userId: identifierPathParam("user", "userId") });
const locationMemberParam = z.object({
  id: identifierPathParam("location", "id"),
  userId: identifierPathParam("user", "userId"),
});

const MANAGE = "locations:manage" as const;

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
    description: "The session member lacks locations:manage",
    content: { "application/problem+json": { schema: Problem } },
  },
  404: {
    description: "The firm is unreachable, the member is deactivated, or the location is unknown",
    content: { "application/problem+json": { schema: Problem } },
  },
  409: {
    description:
      "A request with this Idempotency-Key is in progress, or the firm-default cannot be closed",
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
  404: authErrors[404],
  429: authErrors[429],
} as const;

function writeMeta(operationId: string): RouteMeta {
  return {
    operationId,
    surface: "app",
    authenticated: true,
    permission: MANAGE,
    resource: "location",
    audited: true,
    idempotency: "required",
    idempotencyStore: "firm",
    rateLimit: "default",
  };
}

const createLocationMeta = writeMeta("locations.create");
const updateLocationMeta = writeMeta("locations.update");
const closeLocationMeta = writeMeta("locations.close");
const setAddressesMeta = writeMeta("locations.setAddresses");
const assignMemberMeta = writeMeta("locations.assignMember");
const setLetterheadLogoMeta = writeMeta("locations.setLetterheadLogo");
const clearLetterheadLogoMeta = writeMeta("locations.clearLetterheadLogo");
const addMemberMeta = writeMeta("locations.addMember");
const removeMemberMeta = writeMeta("locations.removeMember");
const setFirmDefaultMeta = writeMeta("locations.setFirmDefault");
const getLetterheadLogoMeta: RouteMeta = {
  operationId: "locations.getLetterheadLogo",
  surface: "app",
  authenticated: true,
  permission: null,
  resource: "location",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};
const listLocationsMeta: RouteMeta = {
  operationId: "locations.list",
  surface: "app",
  authenticated: true,
  permission: null,
  resource: "location",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};
const getLocationMeta: RouteMeta = {
  operationId: "locations.get",
  surface: "app",
  authenticated: true,
  permission: null,
  resource: "location",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

const createLocationRoute = defineOpenAPIRoute(createLocationMeta, {
  method: "post",
  path: "/api/v1/locations",
  description: "Creates a Location (office) with its numbering code and letterhead/remit fields.",
  request: {
    headers: idempotencyKeyHeader,
    body: { content: { "application/json": { schema: LocationRequest } }, required: true },
  },
  responses: {
    201: {
      description: "The Location was created",
      content: { "application/json": { schema: IdAck } },
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

const listLocationsRoute = defineOpenAPIRoute(listLocationsMeta, {
  method: "get",
  path: "/api/v1/locations",
  description: "Lists the firm's Locations, ordered by name.",
  responses: {
    200: {
      description: "The Locations",
      content: { "application/json": { schema: LocationListResponse } },
    },
    401: readErrorResponses[401],
    404: readErrorResponses[404],
    429: readErrorResponses[429],
  },
});

const getLocationRoute = defineOpenAPIRoute(getLocationMeta, {
  method: "get",
  path: "/api/v1/locations/{id}",
  description: "Returns one Location's detail.",
  request: { params: locationParam },
  responses: {
    200: {
      description: "The Location",
      content: { "application/json": { schema: LocationDetail } },
    },
    401: readErrorResponses[401],
    404: readErrorResponses[404],
    429: readErrorResponses[429],
  },
});

const updateLocationRoute = defineOpenAPIRoute(updateLocationMeta, {
  method: "patch",
  path: "/api/v1/locations/{id}",
  description: "Updates a Location's fields.",
  request: {
    headers: idempotencyKeyHeader,
    params: locationParam,
    body: { content: { "application/json": { schema: PatchLocationRequest } }, required: true },
  },
  responses: {
    200: {
      description: "The Location was updated",
      content: { "application/json": { schema: IdAck } },
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

const closeLocationRoute = defineOpenAPIRoute(closeLocationMeta, {
  method: "post",
  path: "/api/v1/locations/{id}/close",
  description:
    "Soft-closes a Location. Refuses to close the firm-default Location (set another default first).",
  request: { headers: idempotencyKeyHeader, params: locationParam },
  responses: {
    200: {
      description: "The Location was closed",
      content: { "application/json": { schema: IdAck } },
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

const setAddressesRoute = defineOpenAPIRoute(setAddressesMeta, {
  method: "put",
  path: "/api/v1/locations/{id}/addresses",
  description:
    "Replaces a Location's address set (at most one physical and one mailing address for letterhead).",
  request: {
    headers: idempotencyKeyHeader,
    params: locationParam,
    body: { content: { "application/json": { schema: AddressesRequest } }, required: true },
  },
  responses: {
    200: {
      description: "The addresses were set",
      content: { "application/json": { schema: IdAck } },
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

const setLetterheadLogoRoute = defineOpenAPIRoute(setLetterheadLogoMeta, {
  method: "put",
  path: "/api/v1/locations/{id}/letterhead-logo",
  description:
    "Sets the office's letterhead logo — the mark documents assembled for this office's matters are " +
    "drawn with. The image must be a PNG or a JPEG, decided by reading the file rather than by what " +
    "the request calls it. Only a printed width is given: the height follows from the image's own " +
    "proportions, so the mark can never print stretched. Replacing a logo replaces it everywhere at " +
    "once; already-assembled documents keep the mark they were produced with.",
  request: {
    headers: idempotencyKeyHeader,
    params: locationParam,
    body: { content: { "application/json": { schema: LetterheadLogoRequest } }, required: true },
  },
  responses: {
    200: {
      description: "The letterhead logo was set",
      content: { "application/json": { schema: IdAck } },
    },
    400: writeErrorResponses[400],
    401: writeErrorResponses[401],
    403: writeErrorResponses[403],
    404: writeErrorResponses[404],
    409: writeErrorResponses[409],
    422: {
      description:
        "The request is invalid, the file is not a PNG or a JPEG, it is too large, or the " +
        "Idempotency-Key was reused with a different payload",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: writeErrorResponses[429],
  },
});

const clearLetterheadLogoRoute = defineOpenAPIRoute(
  { ...clearLetterheadLogoMeta, reversal: { kind: "inverse", by: "locations.setLetterheadLogo" } },
  {
    method: "delete",
    path: "/api/v1/locations/{id}/letterhead-logo",
    description:
      "Removes the office's letterhead logo. Templates that draw one then assemble with a visible " +
      "marker where the mark would be, rather than silently losing the letterhead.",
    request: { headers: idempotencyKeyHeader, params: locationParam },
    responses: {
      200: {
        description: "The letterhead logo was removed",
        content: { "application/json": { schema: IdAck } },
      },
      400: writeErrorResponses[400],
      401: writeErrorResponses[401],
      403: writeErrorResponses[403],
      404: writeErrorResponses[404],
      409: writeErrorResponses[409],
      422: writeErrorResponses[422],
      429: writeErrorResponses[429],
    },
  },
);

const getLetterheadLogoRoute = defineOpenAPIRoute(getLetterheadLogoMeta, {
  method: "get",
  path: "/api/v1/locations/{id}/letterhead-logo",
  description:
    "Streams the mark this office's letterhead prints: the office's own logo, or the firm's primary " +
    "brand image where the office has set none. 404 where neither exists.",
  request: { params: locationParam },
  responses: {
    200: {
      description: "The image bytes",
      content: {
        "image/png": { schema: z.string() },
        "image/jpeg": { schema: z.string() },
      },
    },
    401: readErrorResponses[401],
    404: readErrorResponses[404],
    429: readErrorResponses[429],
  },
});

const addMemberRoute = defineOpenAPIRoute(addMemberMeta, {
  method: "put",
  path: "/api/v1/locations/{id}/members/{userId}",
  description:
    "Puts a member at this office. Their first office is their primary whatever the body says; a " +
    "later one is primary only when asked, which demotes the office that was.",
  request: {
    headers: idempotencyKeyHeader,
    params: locationMemberParam,
    body: { content: { "application/json": { schema: LocationMemberRequest } }, required: true },
  },
  responses: {
    200: {
      description: "The member is at the office",
      content: { "application/json": { schema: IdAck } },
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

const removeMemberRoute = defineOpenAPIRoute(
  { ...removeMemberMeta, reversal: { kind: "inverse", by: "locations.addMember" } },
  {
    method: "delete",
    path: "/api/v1/locations/{id}/members/{userId}",
    description:
      "Takes a member off this office. Where it was their primary and others remain, the first " +
      "remaining office becomes primary.",
    request: { headers: idempotencyKeyHeader, params: locationMemberParam },
    responses: {
      200: {
        description: "The member is no longer at the office",
        content: { "application/json": { schema: IdAck } },
      },
      400: writeErrorResponses[400],
      401: writeErrorResponses[401],
      403: writeErrorResponses[403],
      404: writeErrorResponses[404],
      409: writeErrorResponses[409],
      422: writeErrorResponses[422],
      429: writeErrorResponses[429],
    },
  },
);

const setFirmDefaultRoute = defineOpenAPIRoute(setFirmDefaultMeta, {
  method: "put",
  path: "/api/v1/locations/{id}/firm-default",
  description:
    "Makes this office the firm's default: what a matter with no office of its own numbers and " +
    "prints against, and the one office that cannot be closed. Refuses a closed office.",
  request: { headers: idempotencyKeyHeader, params: locationParam },
  responses: {
    200: {
      description: "The office is the firm's default",
      content: { "application/json": { schema: IdAck } },
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

const assignMemberRoute = defineOpenAPIRoute(assignMemberMeta, {
  method: "put",
  path: "/api/v1/members/{userId}/locations",
  description:
    "Replaces a member's Location assignments (exactly one primary when any are assigned; an empty " +
    "set clears them).",
  request: {
    headers: idempotencyKeyHeader,
    params: memberParam,
    body: { content: { "application/json": { schema: MemberLocationsRequest } }, required: true },
  },
  responses: {
    200: {
      description: "The member's Location assignments were set",
      content: { "application/json": { schema: IdAck } },
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

function locationErrorResponse(
  c: Context,
  error: LocationValidationError,
): ProblemResponse<404> | ProblemResponse<409> | ProblemResponse<422> {
  if (error.code === "unknown-location") {
    return problemJson(c, {
      type: "not-found",
      title: "Not found",
      status: 404,
      detail: "No such location.",
    });
  }
  if (error.code === "location-is-firm-default") {
    return problemJson(c, {
      type: "conflict",
      title: "Cannot close the firm-default location",
      status: 409,
      detail: error.message,
    });
  }
  if (error.code === "location-is-closed") {
    return problemJson(c, {
      type: "conflict",
      title: "A closed office cannot be the firm's default",
      status: 409,
      detail: error.message,
    });
  }
  return problemJson(c, {
    type: "validation",
    title: "Invalid location request",
    status: 422,
    detail: error.message,
  });
}

// Commits an effect-returning location mutation idempotently and reports the outcome: a problem
// response to return as-is, or the id of the committed/replayed mutation for the handler to render
// (the success c.json stays in the handler so it carries the route's exact 200/IdAck typed response —
// returning it from a shared helper would widen to bare Response and break the typed handler).
type LocationEffectOutcome =
  | { ok: true; id: string; replayed: boolean }
  | {
      ok: false;
      problem:
        | ProblemResponse<400>
        | ProblemResponse<404>
        | ProblemResponse<409>
        | ProblemResponse<422>;
    };

async function commitLocationEffect(
  c: Context,
  database: BatchDatabase,
  idempotency: { key: string | undefined; fingerprint: string },
  id: string,
  call: () => Promise<{ effect: EffectWrite }>,
): Promise<LocationEffectOutcome> {
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
    if (caught instanceof LocationValidationError) {
      return { ok: false, problem: locationErrorResponse(c, caught) };
    }
    throw caught;
  }
  if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch") {
    return { ok: false, problem: problemResponseForIdempotencyConflict(c, result) };
  }
  const body = JSON.parse(result.responseBody ?? "{}") as { id: string };
  return { ok: true, id: body.id, replayed: result.kind === "replayed" };
}

// English Metric Units per point: 914400 to the inch, 72 points to the inch. Exact in both directions,
// so a width set as 180 points reads back as 180 points rather than as 179.97.
const EMU_PER_POINT = 12700;

function emuFromPoints(points: number): number {
  return Math.round(points * EMU_PER_POINT);
}

function pointsFromEmu(emu: number): number {
  return emu / EMU_PER_POINT;
}

/** An address as the contract answers it — the stored row without its identity columns. */
function addressOf(row: LocationAddressRow): z.infer<typeof LocationAddress> {
  return {
    kind: row.kind,
    street: row.street,
    streetTwo: row.streetTwo,
    dependentLocality: row.dependentLocality,
    city: row.city,
    region: row.region,
    postal: row.postal,
    sortingCode: row.sortingCode,
    country: row.country,
    phone: row.phone,
  };
}

// Where a firm's letterhead assets live. Content-addressed under the office they belong to, so setting
// the same mark twice writes the same object and a replaced mark never overwrites the bytes an
// already-assembled document was produced from.
const LETTERHEAD_OBJECT_PREFIX = "letterhead/";

// Remove the object an office has stopped pointing at. Best-effort and AFTER the row is committed: a
// delete that fails leaves an orphan, which is a storage cost, while a delete that ran first would leave
// a row pointing at nothing — a letterhead that fails at assembly time instead of at the moment somebody
// could fix it. Never deletes the key just written: the key is the content's own hash, so re-uploading
// the same mark resolves to the same object.
async function sweepReplacedLetterhead(
  bucket: R2Bucket,
  replacedObjectKey: string | null,
  keepObjectKey: string | null,
): Promise<void> {
  if (replacedObjectKey === null || replacedObjectKey === keepObjectKey) return;
  try {
    await bucket.delete(replacedObjectKey);
  } catch {
    // An orphaned object costs storage and nothing else; the office's letterhead is already correct.
  }
}

type LocationsApp = OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>;

export function registerLocationsRoutes(app: LocationsApp, chokepoint: Chokepoint): void {
  // POST /api/v1/locations — create
  app.openapi(
    {
      ...createLocationRoute,
      middleware: chokepointMiddleware(chokepoint, createLocationRoute),
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
            const created = await createLocation(
              firm.firmDatabase,
              {
                name: request.name,
                jurisdiction: request.jurisdiction ?? null,
                timeZone: request.timeZone ?? null,
                numberCode: request.numberCode ?? null,
                addressBlock: request.addressBlock ?? null,
                footer: request.footer ?? null,
                remitTo: request.remitTo ?? null,
                email: request.email ?? null,
              },
              { clock: { now }, actorUserId: userId },
            );
            return {
              write: created.effect,
              responseCode: 201,
              responseBody: canonicalJsonStringify({ id: created.locationId }),
            };
          },
        });
      } catch (caught) {
        if (caught instanceof LocationValidationError) return locationErrorResponse(c, caught);
        throw caught;
      }
      if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch") {
        return problemResponseForIdempotencyConflict(c, result);
      }
      if (result.kind === "replayed") c.header("Idempotency-Replayed", "true");
      return c.json(JSON.parse(result.responseBody ?? "{}") as z.infer<typeof IdAck>, 201);
    },
  );

  // GET /api/v1/locations — list
  app.openapi(
    {
      ...listLocationsRoute,
      middleware: chokepointMiddleware(chokepoint, listLocationsRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      // Three reads, each bounded by the office count, joined here rather than one question per row.
      const [rows, addresses, firmDefault] = await Promise.all([
        readLocationRegisterRows(firm.firmDatabase),
        readAllLocationAddresses(firm.firmDatabase),
        readFirmSetting(firm.firmDatabase, firmDefaultLocationDefinition),
      ]);
      return c.json(
        {
          data: rows.map(
            (row): z.infer<typeof LocationSummary> => ({
              id: row.id,
              name: row.name,
              status: row.status,
              jurisdiction: row.jurisdiction,
              timeZone: row.timeZone,
              numberCode: row.numberCode,
              email: row.email,
              addresses: addresses
                .filter((address) => address.locationId === row.id)
                .map(addressOf),
              members: row.members,
              hasLetterheadLogo: row.hasLetterheadLogo,
              firmDefault: firmDefault === row.id,
            }),
          ),
        },
        200,
      );
    },
  );

  // GET /api/v1/locations/{id}/letterhead-logo — the mark this office prints, as bytes
  app.openapi(
    {
      ...getLetterheadLogoRoute,
      middleware: chokepointMiddleware(chokepoint, getLetterheadLogoRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { id } = c.req.valid("param");
      const { results } = await firm.firmDatabase
        .prepare(
          "SELECT letterhead_logo_object_key, letterhead_logo_content_type FROM location WHERE id = ?1",
        )
        .bind(id)
        .all<{
          letterhead_logo_object_key: string | null;
          letterhead_logo_content_type: string | null;
        }>();
      const row = results[0];
      if (row === undefined) {
        return problemJson(c, {
          type: "not-found",
          title: "Not found",
          status: 404,
          detail: "No such location in this firm.",
        });
      }
      const { bucket } = resolveFirmBucket(c.env, firm.bucketName);
      // The office's own mark where it has one; otherwise the firm's primary mark, which is what
      // the office's letterhead prints. The two are one family of facts, resolved in one place.
      let objectKey = row.letterhead_logo_object_key;
      let contentType = row.letterhead_logo_content_type;
      if (objectKey === null || contentType === null) {
        const primary = await readFirmPrimaryBrandImage(firm.firmDatabase);
        objectKey = primary?.objectKey ?? null;
        contentType = primary?.contentType ?? null;
      }
      const response =
        objectKey === null || contentType === null
          ? null
          : await imageResponse(bucket, objectKey, contentType);
      if (response === null) {
        return problemJson(c, {
          type: "not-found",
          title: "No letterhead mark",
          status: 404,
          detail:
            "This office prints no mark: it has no logo of its own and the firm has set no primary brand image.",
        });
      }
      return response;
    },
  );

  // GET /api/v1/locations/{id} — detail
  app.openapi(
    {
      ...getLocationRoute,
      middleware: chokepointMiddleware(chokepoint, getLocationRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { id } = c.req.valid("param");
      const { results } = await firm.firmDatabase
        .prepare(
          "SELECT id, name, status, jurisdiction, time_zone, number_code, address_block, footer, remit_to, email, created_at, updated_at, letterhead_logo_content_type, letterhead_logo_size_bytes, letterhead_logo_width_pixels, letterhead_logo_height_pixels, letterhead_logo_width_emu, letterhead_logo_updated_at FROM location WHERE id = ?1",
        )
        .bind(id)
        .all<{
          id: string;
          name: string;
          status: "active" | "closed";
          jurisdiction: string | null;
          time_zone: string | null;
          number_code: string | null;
          address_block: string | null;
          footer: string | null;
          remit_to: string | null;
          email: string | null;
          created_at: string;
          updated_at: string;
          letterhead_logo_content_type: string | null;
          letterhead_logo_size_bytes: number | null;
          letterhead_logo_width_pixels: number | null;
          letterhead_logo_height_pixels: number | null;
          letterhead_logo_width_emu: number | null;
          letterhead_logo_updated_at: string | null;
        }>();
      const row = results[0];
      if (row === undefined) {
        return problemJson(c, {
          type: "not-found",
          title: "Not found",
          status: 404,
          detail: "No such location in this firm.",
        });
      }
      const [addresses, members, firmDefault, firmPrimaryMark] = await Promise.all([
        readLocationAddresses(firm.firmDatabase, id),
        readLocationMembers(firm.firmDatabase, id),
        readFirmSetting(firm.firmDatabase, firmDefaultLocationDefinition),
        readFirmPrimaryBrandImage(firm.firmDatabase),
      ]);
      const ownLogo =
        row.letterhead_logo_content_type !== null && row.letterhead_logo_width_emu !== null;
      return c.json(
        {
          id: row.id,
          name: row.name,
          status: row.status,
          jurisdiction: row.jurisdiction,
          timeZone: row.time_zone,
          numberCode: row.number_code,
          addressBlock: row.address_block,
          footer: row.footer,
          remitTo: row.remit_to,
          email: row.email,
          addresses: addresses.map(addressOf),
          members: members.map((member) => ({
            userId: member.userId,
            displayName: member.displayName,
            status: member.status,
            isPrimary: member.isPrimary,
          })),
          firmDefault: firmDefault === row.id,
          // The logo's DESCRIPTION, never its bytes: this is the office-settings read, and a caller
          // that wants the image asks for the image.
          letterheadLogo:
            row.letterhead_logo_content_type === null || row.letterhead_logo_width_emu === null
              ? null
              : {
                  contentType: row.letterhead_logo_content_type,
                  sizeBytes: row.letterhead_logo_size_bytes ?? 0,
                  widthPixels: row.letterhead_logo_width_pixels ?? 0,
                  heightPixels: row.letterhead_logo_height_pixels ?? 0,
                  printedWidthPoints: pointsFromEmu(row.letterhead_logo_width_emu),
                  updatedAt: row.letterhead_logo_updated_at,
                },
          letterheadSource: ownLogo ? "office" : firmPrimaryMark === undefined ? "none" : "firm",
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        } satisfies z.infer<typeof LocationDetail>,
        200,
      );
    },
  );

  // PATCH /api/v1/locations/{id} — update
  app.openapi(
    {
      ...updateLocationRoute,
      middleware: chokepointMiddleware(chokepoint, updateLocationRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { id } = c.req.valid("param");
      const patch = c.req.valid("json");
      const outcome = await commitLocationEffect(c, firm.firmDatabase, idempotency, id, () =>
        updateLocation(firm.firmDatabase, id, patch, {
          clock: { now: () => new Date().toISOString() },
          actorUserId: userId,
        }),
      );
      if (!outcome.ok) return outcome.problem;
      if (outcome.replayed) c.header("Idempotency-Replayed", "true");
      return c.json({ id: outcome.id } as z.infer<typeof IdAck>, 200);
    },
  );

  // POST /api/v1/locations/{id}/close
  app.openapi(
    {
      ...closeLocationRoute,
      middleware: chokepointMiddleware(chokepoint, closeLocationRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { id } = c.req.valid("param");
      const firmDefault = await readFirmSetting(firm.firmDatabase, firmDefaultLocationDefinition);
      const outcome = await commitLocationEffect(c, firm.firmDatabase, idempotency, id, () =>
        closeLocation(firm.firmDatabase, id, {
          clock: { now: () => new Date().toISOString() },
          actorUserId: userId,
          firmDefaultLocationId: firmDefault === null ? null : (firmDefault as LocationId),
        }),
      );
      if (!outcome.ok) return outcome.problem;
      if (outcome.replayed) c.header("Idempotency-Replayed", "true");
      return c.json({ id: outcome.id } as z.infer<typeof IdAck>, 200);
    },
  );

  // PUT /api/v1/locations/{id}/letterhead-logo
  app.openapi(
    {
      ...setLetterheadLogoRoute,
      middleware: chokepointMiddleware(chokepoint, setLetterheadLogoRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { id } = c.req.valid("param");
      const { imageBase64, printedWidthPoints } = c.req.valid("json");

      const bytes = decodeBase64(imageBase64);
      if (bytes === undefined) {
        return problemJson(c, {
          type: "validation",
          title: "Not a readable file",
          status: 422,
          detail: "The image field is not valid base64.",
        });
      }
      // WHAT THE BYTES ARE IS READ FROM THE BYTES. A declared content type is a claim about an upload;
      // this is the one place it becomes a fact, and it is the same reader the assembly engine uses, so
      // nothing can be stored that the engine will later refuse to draw.
      const facts = readImageFacts(bytes);
      if (!facts.ok) {
        return problemJson(c, {
          type: "validation",
          title: "Not a usable letterhead image",
          status: 422,
          detail: facts.detail,
        });
      }

      const { bucket } = resolveFirmBucket(c.env, firm.bucketName);
      const digest = await sha256Hex(bytes);
      const objectKey = `${LETTERHEAD_OBJECT_PREFIX}${id}/${digest}.${facts.value.extension}`;
      // Written before the row that points at it: an object nothing references is a cost, whereas a row
      // pointing at an object that is not there is a letterhead that fails at assembly time.
      // A letterhead belongs to an office, and every matter's documents draw on it — so it is a firm
      // asset with no matter of its own.
      await bucket.put(objectKey, bytes as unknown as ArrayBuffer, {
        sha256: digest,
        customMetadata: firmScopedObjectDimensions("letterhead-image"),
      });

      let replaced: string | null = null;
      const outcome = await commitLocationEffect(
        c,
        firm.firmDatabase,
        idempotency,
        id,
        async () => {
          const written = await setLetterheadLogo(
            firm.firmDatabase,
            id,
            {
              objectKey,
              contentType: facts.value.contentType,
              sizeBytes: bytes.byteLength,
              sha256: digest,
              widthPixels: facts.value.widthPixels,
              heightPixels: facts.value.heightPixels,
              widthEmu: emuFromPoints(printedWidthPoints),
            },
            { clock: { now: () => new Date().toISOString() }, actorUserId: userId },
          );
          replaced = written.replacedObjectKey;
          return written;
        },
      );
      if (!outcome.ok) return outcome.problem;
      // The object the office was using until now, swept only AFTER the row stopped pointing at it —
      // and never when the new mark is the same object, since the key is the content's own hash.
      await sweepReplacedLetterhead(bucket, replaced, objectKey);
      if (outcome.replayed) c.header("Idempotency-Replayed", "true");
      return c.json({ id: outcome.id } as z.infer<typeof IdAck>, 200);
    },
  );

  // DELETE /api/v1/locations/{id}/letterhead-logo
  app.openapi(
    {
      ...clearLetterheadLogoRoute,
      middleware: chokepointMiddleware(chokepoint, clearLetterheadLogoRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { id } = c.req.valid("param");
      let replaced: string | null = null;
      const outcome = await commitLocationEffect(
        c,
        firm.firmDatabase,
        idempotency,
        id,
        async () => {
          const cleared = await clearLetterheadLogo(firm.firmDatabase, id, {
            clock: { now: () => new Date().toISOString() },
            actorUserId: userId,
          });
          replaced = cleared.replacedObjectKey;
          return cleared;
        },
      );
      if (!outcome.ok) return outcome.problem;
      const { bucket } = resolveFirmBucket(c.env, firm.bucketName);
      await sweepReplacedLetterhead(bucket, replaced, null);
      if (outcome.replayed) c.header("Idempotency-Replayed", "true");
      return c.json({ id: outcome.id } as z.infer<typeof IdAck>, 200);
    },
  );

  // PUT /api/v1/locations/{id}/addresses
  app.openapi(
    {
      ...setAddressesRoute,
      middleware: chokepointMiddleware(chokepoint, setAddressesRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { id } = c.req.valid("param");
      const { addresses } = c.req.valid("json");
      const outcome = await commitLocationEffect(c, firm.firmDatabase, idempotency, id, () =>
        setLocationAddresses(
          firm.firmDatabase,
          id,
          addresses.map((address) => ({
            kind: address.kind,
            street: address.street ?? null,
            streetTwo: address.streetTwo ?? null,
            dependentLocality: address.dependentLocality ?? null,
            city: address.city ?? null,
            region: address.region ?? null,
            postal: address.postal ?? null,
            sortingCode: address.sortingCode ?? null,
            country:
              address.country === undefined ? null : (address.country?.toUpperCase() ?? null),
            phone: address.phone ?? null,
          })),
          { clock: { now: () => new Date().toISOString() }, actorUserId: userId },
        ),
      );
      if (!outcome.ok) return outcome.problem;
      if (outcome.replayed) c.header("Idempotency-Replayed", "true");
      return c.json({ id: outcome.id } as z.infer<typeof IdAck>, 200);
    },
  );

  // PUT /api/v1/locations/{id}/members/{userId} — put one member at this office
  app.openapi(
    {
      ...addMemberRoute,
      middleware: chokepointMiddleware(chokepoint, addMemberRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const actorUserId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { id, userId } = c.req.valid("param");
      const { isPrimary } = c.req.valid("json");
      const outcome = await commitLocationEffect(c, firm.firmDatabase, idempotency, id, () =>
        addMemberToLocation(firm.firmDatabase, userId as UserId, id, isPrimary ?? false, {
          clock: { now: () => new Date().toISOString() },
          actorUserId,
        }),
      );
      if (!outcome.ok) return outcome.problem;
      if (outcome.replayed) c.header("Idempotency-Replayed", "true");
      return c.json({ id: outcome.id } as z.infer<typeof IdAck>, 200);
    },
  );

  // DELETE /api/v1/locations/{id}/members/{userId} — take one member off this office
  app.openapi(
    {
      ...removeMemberRoute,
      middleware: chokepointMiddleware(chokepoint, removeMemberRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const actorUserId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { id, userId } = c.req.valid("param");
      const outcome = await commitLocationEffect(c, firm.firmDatabase, idempotency, id, () =>
        removeMemberFromLocation(firm.firmDatabase, userId as UserId, id, {
          clock: { now: () => new Date().toISOString() },
          actorUserId,
        }),
      );
      if (!outcome.ok) return outcome.problem;
      if (outcome.replayed) c.header("Idempotency-Replayed", "true");
      return c.json({ id: outcome.id } as z.infer<typeof IdAck>, 200);
    },
  );

  // PUT /api/v1/locations/{id}/firm-default — name the firm's default office
  app.openapi(
    {
      ...setFirmDefaultRoute,
      middleware: chokepointMiddleware(chokepoint, setFirmDefaultRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { id } = c.req.valid("param");
      const outcome = await commitLocationEffect(c, firm.firmDatabase, idempotency, id, () =>
        setFirmDefaultLocation(firm.firmDatabase, id, {
          clock: { now: () => new Date().toISOString() },
          actorUserId: userId,
        }),
      );
      if (!outcome.ok) return outcome.problem;
      if (outcome.replayed) c.header("Idempotency-Replayed", "true");
      return c.json({ id: outcome.id } as z.infer<typeof IdAck>, 200);
    },
  );

  // PUT /api/v1/members/{userId}/locations — staff Location assignment
  app.openapi(
    {
      ...assignMemberRoute,
      middleware: chokepointMiddleware(chokepoint, assignMemberRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const actorUserId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { userId } = c.req.valid("param");
      const { assignments } = c.req.valid("json");
      const outcome = await commitLocationEffect(c, firm.firmDatabase, idempotency, userId, () =>
        assignMemberLocations(firm.firmDatabase, userId, assignments, {
          clock: { now: () => new Date().toISOString() },
          actorUserId,
        }),
      );
      if (!outcome.ok) return outcome.problem;
      if (outcome.replayed) c.header("Idempotency-Replayed", "true");
      return c.json({ id: outcome.id } as z.infer<typeof IdAck>, 200);
    },
  );
}
