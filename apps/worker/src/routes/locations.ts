import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import type { BatchDatabase, EffectWrite } from "@magna-carta/data-access/effect-batch";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import { readFirmSetting } from "@magna-carta/data-access/setting-statements";
import { readImageFacts } from "@magna-carta/document-assembly/ooxml-image";
import {
  assignMemberLocations,
  clearLetterheadLogo,
  closeLocation,
  createLocation,
  setLetterheadLogo,
  setLocationAddresses,
  updateLocation,
} from "@magna-carta/locations/location-service";
import { firmDefaultLocationDefinition } from "@magna-carta/locations/settings";
import { LocationValidationError } from "@magna-carta/locations/validation";
import type { LocationId } from "@magna-carta/identifiers/types";
import type { Context } from "hono";
import type { Bindings } from "../app.ts";
import type { Chokepoint } from "../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointIdempotency,
  requireChokepointUserId,
} from "../chokepoint/context-accessors.ts";
import type { AppVariables } from "../chokepoint/ports.ts";
import { chokepointMiddleware } from "../chokepoint/register.ts";
import { idempotencyKeyHeader, identifierField, identifierPathParam } from "../contracts/common.ts";
import { Problem, problemJson, type ProblemResponse } from "../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../contracts/route-meta.ts";
import { resolveFirmBucket } from "../files/firm-bucket.ts";
import { problemResponseForIdempotencyConflict } from "../idempotency-conflict-problems.ts";

// Locations: the firm's offices (numbering code, letterhead/remit fields, addresses, staff
// assignment). The locations package owns validation (one-primary-per-member, firm-default close
// refusal); these handlers commit the returned effect idempotently. Reads are open to any
// authenticated firm member; writes require locations:manage.

const LocationRequest = z
  .object({
    name: z.string().min(1),
    jurisdiction: z.string().nullable().optional(),
    numberCode: z.string().nullable().optional(),
    addressBlock: z.string().nullable().optional(),
    footer: z.string().nullable().optional(),
    remitTo: z.string().nullable().optional(),
  })
  .openapi("LocationRequest");

const PatchLocationRequest = z
  .object({
    name: z.string().min(1).optional(),
    jurisdiction: z.string().nullable().optional(),
    numberCode: z.string().nullable().optional(),
    addressBlock: z.string().nullable().optional(),
    footer: z.string().nullable().optional(),
    remitTo: z.string().nullable().optional(),
  })
  .openapi("PatchLocationRequest");

const AddressInputSchema = z.object({
  kind: z.enum(["physical", "mailing"]),
  street: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  region: z.string().nullable().optional(),
  postal: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
});
const AddressesRequest = z
  .object({ addresses: z.array(AddressInputSchema) })
  .openapi("LocationAddressesRequest");

const MemberLocationsRequest = z
  .object({
    assignments: z.array(
      z.object({ locationId: identifierField("location"), isPrimary: z.boolean() }),
    ),
  })
  .openapi("MemberLocationsRequest");

const LocationSummary = z
  .object({
    id: z.string(),
    name: z.string(),
    status: z.enum(["active", "closed"]),
    jurisdiction: z.string().nullable(),
    numberCode: z.string().nullable(),
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
    numberCode: z.string().nullable(),
    addressBlock: z.string().nullable(),
    footer: z.string().nullable(),
    remitTo: z.string().nullable(),
    letterheadLogo: LetterheadLogo.nullable(),
  })
  .openapi("LocationDetail");
const IdAck = z.object({ id: z.string() }).openapi("LocationAck");

const locationParam = z.object({ id: identifierPathParam("location", "id") });
const memberParam = z.object({ userId: identifierPathParam("user", "userId") });

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

const clearLetterheadLogoRoute = defineOpenAPIRoute(clearLetterheadLogoMeta, {
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

// Base64 to bytes, refusing anything that is not base64 rather than decoding it into garbage that would
// then fail the format sniff with a message about the wrong thing.
function decodeBase64(encoded: string): Uint8Array | undefined {
  try {
    const binary = atob(encoded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    return undefined;
  }
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
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
                numberCode: request.numberCode ?? null,
                addressBlock: request.addressBlock ?? null,
                footer: request.footer ?? null,
                remitTo: request.remitTo ?? null,
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
      const { results } = await firm.firmDatabase
        .prepare("SELECT id, name, status, jurisdiction, number_code FROM location ORDER BY name")
        .all<{
          id: string;
          name: string;
          status: "active" | "closed";
          jurisdiction: string | null;
          number_code: string | null;
        }>();
      return c.json(
        {
          data: results.map((row) => ({
            id: row.id,
            name: row.name,
            status: row.status,
            jurisdiction: row.jurisdiction,
            numberCode: row.number_code,
          })),
        },
        200,
      );
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
          "SELECT id, name, status, jurisdiction, number_code, address_block, footer, remit_to, letterhead_logo_content_type, letterhead_logo_size_bytes, letterhead_logo_width_pixels, letterhead_logo_height_pixels, letterhead_logo_width_emu, letterhead_logo_updated_at FROM location WHERE id = ?1",
        )
        .bind(id)
        .all<{
          id: string;
          name: string;
          status: "active" | "closed";
          jurisdiction: string | null;
          number_code: string | null;
          address_block: string | null;
          footer: string | null;
          remit_to: string | null;
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
      return c.json(
        {
          id: row.id,
          name: row.name,
          status: row.status,
          jurisdiction: row.jurisdiction,
          numberCode: row.number_code,
          addressBlock: row.address_block,
          footer: row.footer,
          remitTo: row.remit_to,
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
        },
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
      await bucket.put(objectKey, bytes as unknown as ArrayBuffer, { sha256: digest });

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
            city: address.city ?? null,
            region: address.region ?? null,
            postal: address.postal ?? null,
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
