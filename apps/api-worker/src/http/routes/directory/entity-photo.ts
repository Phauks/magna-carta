import { type OpenAPIHono, z } from "@hono/zod-openapi";
import { directoryEntityIdPattern } from "@magna-carta/directory/contract";
import { MergedEntityError, UnknownEntityError } from "@magna-carta/directory/entity-kind";
import {
  readEntityPhoto,
  removeEntityPhoto,
  setEntityPhoto,
  type EntityPhotoRow,
} from "@magna-carta/directory/entity-photo";
import {
  DirectoryIdempotencyConflictError,
  type DirectoryIdempotencyContext,
} from "@magna-carta/directory/run-directory-effect";
import type { DirectoryWriteOptions } from "@magna-carta/directory/audit";
import { readImageFacts } from "@magna-carta/document-assembly/ooxml-image";
import { cryptoRandomSource } from "@magna-carta/identifiers/random";
import { firmScopedObjectDimensions } from "@magna-carta/object-dimensions/dimensions";
import type { Context } from "hono";
import type { Bindings } from "../../../bindings.ts";
import { resolveFirmBucket } from "../../../files/firm-bucket.ts";
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
import { decodeBase64, imageResponse, sha256Hex } from "../shared/image-bytes.ts";

// A DIRECTORY RECORD'S PICTURE — a person's photograph or an organization's logo: the facts, the
// bytes, the write and the removal.
//
// The member's own picture (routes/session/me-photo.ts) is the model, and the reasoning carries
// over: the bytes go to the firm's bucket first, keyed by their own hash, and the row that points at
// them second, so a row never names an object that is not there; what the bytes ARE is read from the
// bytes, so nothing is stored that a screen would refuse to draw; and the object a record stops
// pointing at is swept afterwards, best-effort, because an orphan is a storage cost while a row
// pointing at nothing is a broken picture on somebody's screen.
//
// Two things differ, both because a record is not the person looking at it. The write takes the
// directory's own edit permission and its idempotency key, like every other directory write, and is
// filed in the firm's audit trail against the record. And the object key carries the record as well
// as the hash: two records holding the same image must never share one object, or removing one
// record's picture would take the other's with it.

const WRITE_PERMISSION = "directory:edit" as const;

/** Where a record's picture lives in the firm's bucket, under the record's own id. */
const OBJECT_PREFIX = "directory-photo/";

const entityParam = z.object({
  id: z
    .string()
    .regex(directoryEntityIdPattern)
    .openapi({ param: { name: "id", in: "path" } }),
});

const EntityPhoto = z
  .object({
    sha256: z.string().openapi({ description: "The SHA-256 of the bytes." }),
    contentType: z.string(),
    sizeBytes: z.number().int(),
    widthPixels: z.number().int(),
    heightPixels: z.number().int(),
    updatedAt: z.string(),
  })
  .openapi("DirectoryEntityPhoto");

const EntityPhotoResponse = z
  .object({
    // NULL for a record that holds no picture, rather than absent, so a consumer has to read it.
    photo: EntityPhoto.nullable(),
  })
  .openapi("DirectoryEntityPhotoResponse");

const SetEntityPhotoRequest = z
  .object({
    // Base64 of the image itself. What the bytes are is decided by reading them, never by what the
    // browser called the file.
    imageBase64: z.string().min(1),
  })
  .openapi("SetDirectoryEntityPhotoRequest");

const problem = (description: string) => ({
  description,
  content: { "application/problem+json": { schema: Problem } },
});

const errors = {
  400: problem("Missing Idempotency-Key (this operation requires one)"),
  401: problem("No valid session"),
  403: problem("The session member lacks directory:edit"),
  404: problem("The record is unknown, or it holds no picture"),
  409: problem("The record was merged into another, or the Idempotency-Key is still in progress"),
  422: problem("The bytes are not a readable PNG or JPEG, or the Idempotency-Key was reused"),
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

const readRoute = defineOpenAPIRoute(readMeta("directory.entityPhoto"), {
  method: "get",
  path: "/api/v1/directory/entities/{id}/photo",
  description:
    "A record's picture, as facts about it: what the bytes are, how large, and when they were set. " +
    "Null where the record holds none. The bytes themselves are a separate read.",
  request: { params: entityParam },
  responses: {
    200: {
      description: "The record's picture, or null",
      content: { "application/json": { schema: EntityPhotoResponse } },
    },
    401: errors[401],
    404: errors[404],
    429: errors[429],
  },
});

const contentRoute = defineOpenAPIRoute(readMeta("directory.entityPhotoContent"), {
  method: "get",
  path: "/api/v1/directory/entities/{id}/photo/content",
  description:
    "The bytes of a record's picture, in the type they were read to be when stored. Rides the " +
    "session like every other read and is never publicly addressable.",
  request: { params: entityParam },
  responses: {
    200: {
      description: "The image",
      content: { "image/png": { schema: z.string() }, "image/jpeg": { schema: z.string() } },
    },
    401: errors[401],
    404: errors[404],
    429: errors[429],
  },
});

const setRoute = defineOpenAPIRoute(writeMeta("directory.setEntityPhoto"), {
  method: "put",
  path: "/api/v1/directory/entities/{id}/photo",
  description:
    "Sets a record's picture, replacing whatever it held. The bytes are read to decide what they " +
    "are, a PNG or a JPEG and nothing else, so nothing is stored that a screen will refuse to draw.",
  request: {
    headers: idempotencyKeyHeader,
    params: entityParam,
    body: { required: true, content: { "application/json": { schema: SetEntityPhotoRequest } } },
  },
  responses: {
    200: {
      description: "The record's picture after the write",
      content: { "application/json": { schema: EntityPhotoResponse } },
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

const removeRoute = defineOpenAPIRoute(
  {
    ...writeMeta("directory.removeEntityPhoto"),
    // Uploading one again is the way back. The platform keeps no copy of a removed picture to offer
    // to restore, which is the only thing that would make this anything else.
    reversal: { kind: "inverse", by: "directory.setEntityPhoto" },
  },
  {
    method: "delete",
    path: "/api/v1/directory/entities/{id}/photo",
    description:
      "Removes a record's picture. A record that holds none is answered the same way: the act says " +
      "what is true afterwards, not what was true before.",
    request: { headers: idempotencyKeyHeader, params: entityParam },
    responses: {
      200: {
        description: "The record holds no picture",
        content: { "application/json": { schema: EntityPhotoResponse } },
      },
      400: errors[400],
      401: errors[401],
      403: errors[403],
      404: errors[404],
      409: errors[409],
      422: errors[422],
      429: errors[429],
    },
  },
);

type PhotoApp = OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>;

const NO_PHOTO = { photo: null } satisfies z.infer<typeof EntityPhotoResponse>;

function photoOf(row: EntityPhotoRow): z.infer<typeof EntityPhotoResponse> {
  return {
    photo: {
      sha256: row.sha256,
      contentType: row.contentType,
      sizeBytes: row.sizeBytes,
      widthPixels: row.widthPixels,
      heightPixels: row.heightPixels,
      updatedAt: row.updatedAt,
    },
  };
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

/** A directory refusal as its problem; anything else goes to the standard error pipeline. */
function refusal(c: Context, caught: unknown) {
  if (caught instanceof DirectoryIdempotencyConflictError) {
    return problemResponseForIdempotencyConflict(c, caught);
  }
  if (caught instanceof UnknownEntityError) {
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
  throw caught;
}

/**
 * Removes the object a record has stopped pointing at, after the row is committed and best-effort.
 * Never the key just written: the key is the content's hash, so re-uploading the same picture
 * resolves to the same object.
 */
async function sweep(
  bucket: R2Bucket,
  objectKey: string | null,
  keep: string | null,
): Promise<void> {
  if (objectKey === null || objectKey === keep) return;
  try {
    await bucket.delete(objectKey);
  } catch {
    // Deliberate: the record's picture is what was asked for; an orphan is only a storage cost.
  }
}

export function registerEntityPhotoRoutes(app: PhotoApp, chokepoint: Chokepoint): void {
  // GET /api/v1/directory/entities/{id}/photo
  app.openapi(
    { ...readRoute, middleware: chokepointMiddleware(chokepoint, readRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { id } = c.req.valid("param");
      const row = await readEntityPhoto(firm.firmDatabase, id);
      return c.json(row === undefined ? NO_PHOTO : photoOf(row), 200);
    },
  );

  // GET /api/v1/directory/entities/{id}/photo/content
  app.openapi(
    { ...contentRoute, middleware: chokepointMiddleware(chokepoint, contentRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { id } = c.req.valid("param");
      const row = await readEntityPhoto(firm.firmDatabase, id);
      const { bucket } = resolveFirmBucket(c.env, firm.bucketName);
      const response =
        row === undefined ? null : await imageResponse(bucket, row.objectKey, row.contentType);
      if (response === null) {
        return problemJson(c, {
          type: "not-found",
          title: "Not found",
          status: 404,
          detail: "This record has no picture stored.",
        });
      }
      return response;
    },
  );

  // PUT /api/v1/directory/entities/{id}/photo
  app.openapi(
    { ...setRoute, middleware: chokepointMiddleware(chokepoint, setRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { id } = c.req.valid("param");
      const { imageBase64 } = c.req.valid("json");

      const bytes = decodeBase64(imageBase64);
      if (bytes === undefined) {
        return problemJson(c, {
          type: "validation",
          title: "Not a readable file",
          status: 422,
          detail: "The image field is not valid base64.",
        });
      }
      const facts = readImageFacts(bytes);
      if (!facts.ok) {
        return problemJson(c, {
          type: "validation",
          title: "Not a usable picture",
          status: 422,
          detail: facts.detail,
        });
      }

      const { bucket } = resolveFirmBucket(c.env, firm.bucketName);
      const digest = await sha256Hex(bytes);
      const objectKey = `${OBJECT_PREFIX}${id}/${digest}.${facts.value.extension}`;
      try {
        // Read before the write: the row is the only thing that names the object it replaces.
        const replaced = await readEntityPhoto(firm.firmDatabase, id);
        await bucket.put(objectKey, bytes, {
          sha256: digest,
          customMetadata: firmScopedObjectDimensions("directory-photo"),
        });
        const row = await setEntityPhoto(
          firm.firmDatabase,
          id,
          {
            sha256: digest,
            objectKey,
            contentType: facts.value.contentType,
            sizeBytes: bytes.byteLength,
            widthPixels: facts.value.widthPixels,
            heightPixels: facts.value.heightPixels,
          },
          writeOptions(userId, idempotency),
        );
        await sweep(bucket, replaced?.objectKey ?? null, row.objectKey);
        return c.json(photoOf(row), 200);
      } catch (caught) {
        return refusal(c, caught);
      }
    },
  );

  // DELETE /api/v1/directory/entities/{id}/photo
  app.openapi(
    { ...removeRoute, middleware: chokepointMiddleware(chokepoint, removeRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { id } = c.req.valid("param");
      try {
        const removed = await removeEntityPhoto(
          firm.firmDatabase,
          id,
          writeOptions(userId, idempotency),
        );
        if (removed !== undefined) {
          await sweep(resolveFirmBucket(c.env, firm.bucketName).bucket, removed.objectKey, null);
        }
        return c.json(NO_PHOTO, 200);
      } catch (caught) {
        return refusal(c, caught);
      }
    },
  );
}
