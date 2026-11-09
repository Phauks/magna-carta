import { type OpenAPIHono, z } from "@hono/zod-openapi";
import { insertAuthAuditStatement } from "@magna-carta/data-access/auth-audit-statements";
import {
  readMemberPhoto,
  removeMemberPhotoStatement,
  setMemberPhotoStatement,
} from "@magna-carta/data-access/member-photo-statements";
import { readImageFacts } from "@magna-carta/document-assembly/ooxml-image";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { UserId } from "@magna-carta/identifiers/types";
import { firmScopedObjectDimensions } from "@magna-carta/object-dimensions/dimensions";
import type { Bindings } from "../../../bindings.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointUserId,
} from "../../chokepoint/context-accessors.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { Problem, problemJson } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";
import { resolveFirmBucket } from "../../../files/firm-bucket.ts";
import { decodeBase64, imageResponse, sha256Hex } from "../shared/image-bytes.ts";

// A MEMBER'S OWN PICTURE — the read, the write and the removal, all addressed to the session's own
// member and to nobody else.
//
// WHAT IT IS FOR. A roster of names is a list a person reads; a roster of faces is one they
// recognise. The picture is the member's own to set, which is why this sits on the account surface
// beside their name rather than under an administrator's members screen.
//
// THE BYTES AND THE ROW ARE SEPARATE STORES AND ARE WRITTEN IN THAT ORDER, the firm brand image's
// reasoning (routes/firm-profile.ts): the object goes to the firm's bucket first, keyed by its own
// hash, and the row that points at it second. An object nothing references is a storage cost; a row
// pointing at nothing is a screen with a broken picture on it. Content-addressed, so uploading the
// same bytes twice writes the same object and replacing a picture never overwrites the bytes a
// screen still holding the old row is drawing.
//
// WHY THIS TAKES A PERMISSION, when the actor is the subject: the chokepoint refuses an
// authenticated mutation naming none, and the platform has no self-scoped mutation concept. It is
// the same key the member's own name takes — `firm:editOwnProfile`, seeded to every default role,
// because a picture of oneself is not a privilege — and every statement below binds the SESSION's
// user id, which is what makes the key safe to give everybody.
//
// THE CONTENT ROUTE IS NOT IDEMPOTENT-KEYED AND THE WRITES ARE NOT EITHER. A write here is a total
// replacement of one row by the person that row describes, so running it twice lands the same row;
// demanding a header would turn a retried upload into a 400 for no safety gained. Same ruling, same
// reasoning, as the member's own name.

const PERMISSION = "firm:editOwnProfile" as const;

/** Where a member's picture lives in the firm's bucket. */
const MEMBER_PHOTO_OBJECT_PREFIX = "member-photo/";

const MemberPhoto = z
  .object({
    sha256: z.string().openapi({ description: "The SHA-256 of the bytes, which keys the object." }),
    contentType: z.string(),
    sizeBytes: z.number().int(),
    widthPixels: z.number().int(),
    heightPixels: z.number().int(),
    updatedAt: z.string(),
  })
  .openapi("MemberPhoto");

const MemberPhotoResponse = z
  .object({
    // NULL for a member who holds no picture, rather than absent, so a consumer has to read it.
    photo: MemberPhoto.nullable(),
  })
  .openapi("MemberPhotoResponse");

const SetMemberPhotoRequest = z
  .object({
    // Base64 of the image itself. What the bytes ARE is decided by reading them, never by what the
    // browser called the file.
    imageBase64: z.string().min(1),
  })
  .openapi("SetMemberPhotoRequest");

const errorResponses = {
  401: {
    description: "No valid session",
    content: { "application/problem+json": { schema: Problem } },
  },
  403: {
    description: "The session member lacks firm:editOwnProfile",
    content: { "application/problem+json": { schema: Problem } },
  },
  404: {
    description:
      "The firm is unreachable, the session member is deactivated, or there is no picture",
    content: { "application/problem+json": { schema: Problem } },
  },
  422: {
    description: "The bytes are not a readable PNG or JPEG, or are larger than the image ceiling",
    content: { "application/problem+json": { schema: Problem } },
  },
  429: {
    description: "Rate limit exceeded",
    content: { "application/problem+json": { schema: Problem } },
  },
} as const;

const readMeta: RouteMeta = {
  operationId: "me.photo",
  surface: "app",
  authenticated: true,
  // A read of one's own row, the me.name precedent: there is no capability to name for reading what
  // you yourself uploaded.
  permission: null,
  resource: "firm",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

const contentMeta: RouteMeta = { ...readMeta, operationId: "me.photoContent" };

function writeMeta(operationId: string): RouteMeta {
  return {
    operationId,
    surface: "app",
    authenticated: true,
    permission: PERMISSION,
    resource: "firm",
    // Audited on the control plane rather than in the firm, the member-name precedent: a change to
    // how somebody appears is a fact about the ACCOUNT, and the auth audit is where an account's own
    // history lives.
    audited: true,
    idempotency: "optional",
    rateLimit: "default",
  };
}

const readRoute = defineOpenAPIRoute(readMeta, {
  method: "get",
  path: "/api/v1/me/photo",
  description:
    "The session member's own picture, as facts about it — what the bytes are, how large they are, " +
    "and when they were set. Null where they hold none. The bytes themselves are a separate read.",
  responses: {
    200: {
      description: "The member's picture, or null",
      content: { "application/json": { schema: MemberPhotoResponse } },
    },
    401: errorResponses[401],
    404: errorResponses[404],
    429: errorResponses[429],
  },
});

const contentRoute = defineOpenAPIRoute(contentMeta, {
  method: "get",
  path: "/api/v1/me/photo/content",
  description:
    "The bytes of the session member's own picture, in the type they were sniffed to be when they " +
    "were stored. Rides the session like every other read and is never publicly addressable.",
  responses: {
    200: {
      description: "The image",
      content: { "image/png": { schema: z.string() }, "image/jpeg": { schema: z.string() } },
    },
    401: errorResponses[401],
    404: errorResponses[404],
    429: errorResponses[429],
  },
});

const setRoute = defineOpenAPIRoute(writeMeta("me.setPhoto"), {
  method: "put",
  path: "/api/v1/me/photo",
  description:
    "Sets the session member's own picture, replacing whatever they held. The bytes are read to " +
    "decide what they are — a PNG or a JPEG, and nothing else — so nothing can be stored that a " +
    "screen will later refuse to draw.",
  request: {
    body: { required: true, content: { "application/json": { schema: SetMemberPhotoRequest } } },
  },
  responses: {
    200: {
      description: "The member's picture after the write",
      content: { "application/json": { schema: MemberPhotoResponse } },
    },
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
    422: errorResponses[422],
    429: errorResponses[429],
  },
});

const removeRoute = defineOpenAPIRoute(
  {
    ...writeMeta("me.removePhoto"),
    // Uploading one again is the way back, and it is the same act a person performs to change their
    // picture at all — same subject, same door. The bytes are the member's own to keep or not; the
    // platform does not hold a copy of a picture somebody removed so that it can offer to put it
    // back, which is the only thing that would make this anything else.
    reversal: { kind: "inverse", by: "me.setPhoto" },
  },
  {
    method: "delete",
    path: "/api/v1/me/photo",
    description:
      "Removes the session member's own picture. A member who holds none is answered the same way: " +
      "the act says what is true afterwards, not what was true before.",
    responses: {
      200: {
        description: "The member holds no picture",
        content: { "application/json": { schema: MemberPhotoResponse } },
      },
      401: errorResponses[401],
      403: errorResponses[403],
      404: errorResponses[404],
      429: errorResponses[429],
    },
  },
);

type PhotoApp = OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>;

const NO_PHOTO = { photo: null } satisfies z.infer<typeof MemberPhotoResponse>;

export function registerMePhotoRoutes(app: PhotoApp, chokepoint: Chokepoint): void {
  // GET /api/v1/me/photo
  app.openapi(
    { ...readRoute, middleware: chokepointMiddleware(chokepoint, readRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const row = await readMemberPhoto(firm.firmDatabase, requireChokepointUserId(c));
      if (row === undefined) return c.json(NO_PHOTO, 200);
      return c.json(
        {
          photo: {
            sha256: row.sha256,
            contentType: row.contentType,
            sizeBytes: row.sizeBytes,
            widthPixels: row.widthPixels,
            heightPixels: row.heightPixels,
            updatedAt: row.updatedAt,
          },
        } satisfies z.infer<typeof MemberPhotoResponse>,
        200,
      );
    },
  );

  // GET /api/v1/me/photo/content
  app.openapi(
    { ...contentRoute, middleware: chokepointMiddleware(chokepoint, contentRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const row = await readMemberPhoto(firm.firmDatabase, requireChokepointUserId(c));
      const { bucket } = resolveFirmBucket(c.env, firm.bucketName);
      const response =
        row === undefined ? null : await imageResponse(bucket, row.objectKey, row.contentType);
      if (response === null) {
        return problemJson(c, {
          type: "not-found",
          title: "Not found",
          status: 404,
          detail: "You have no picture stored.",
        });
      }
      return response;
    },
  );

  // PUT /api/v1/me/photo
  app.openapi(
    { ...setRoute, middleware: chokepointMiddleware(chokepoint, setRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
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
      // WHAT THE BYTES ARE IS READ FROM THE BYTES — the same reader the firm's marks and the assembly
      // engine use, which is also what keeps anything that is not an image out of the bucket.
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
      const objectKey = `${MEMBER_PHOTO_OBJECT_PREFIX}${digest}.${facts.value.extension}`;
      // Read BEFORE the write, because the row is the only thing that names the object it is about
      // to replace: the upsert below overwrites that key and nothing could find the object again.
      const replaced = await readMemberPhoto(firm.firmDatabase, userId);
      // The object first, the row second — see the ordering note at the top of this file.
      await bucket.put(objectKey, bytes as unknown as ArrayBuffer, {
        sha256: digest,
        customMetadata: firmScopedObjectDimensions("member-photo"),
      });

      const now = new Date().toISOString();
      await firm.firmDatabase.batch([
        setMemberPhotoStatement(firm.firmDatabase, {
          memberUserId: userId,
          sha256: digest,
          objectKey,
          contentType: facts.value.contentType,
          sizeBytes: bytes.byteLength,
          widthPixels: facts.value.widthPixels,
          heightPixels: facts.value.heightPixels,
          now,
        }),
      ]);
      await auditPhoto(c.env, userId, "member.photo_changed");
      await sweepReplacedPhoto(bucket, replaced?.objectKey ?? null, objectKey);

      return c.json(
        {
          photo: {
            sha256: digest,
            contentType: facts.value.contentType,
            sizeBytes: bytes.byteLength,
            widthPixels: facts.value.widthPixels,
            heightPixels: facts.value.heightPixels,
            updatedAt: now,
          },
        } satisfies z.infer<typeof MemberPhotoResponse>,
        200,
      );
    },
  );

  // DELETE /api/v1/me/photo
  app.openapi(
    { ...removeRoute, middleware: chokepointMiddleware(chokepoint, removeRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const existing = await readMemberPhoto(firm.firmDatabase, userId);
      if (existing === undefined) return c.json(NO_PHOTO, 200);

      await firm.firmDatabase.batch([removeMemberPhotoStatement(firm.firmDatabase, userId)]);
      // The object is swept AFTER the row, and a failure is swallowed: an orphaned object is a
      // storage cost, while a deleted object still referenced by a row is a broken picture on a
      // colleague's screen. The same posture the letterhead sweep takes.
      try {
        await resolveFirmBucket(c.env, firm.bucketName).bucket.delete(existing.objectKey);
      } catch {
        // Deliberate: the row is gone, which is what the member asked for.
      }
      await auditPhoto(c.env, userId, "member.photo_removed");
      return c.json(NO_PHOTO, 200);
    },
  );
}

/**
 * Removes the object a member has stopped pointing at.
 *
 * AFTER the row is committed and best-effort, the letterhead sweep's posture: a delete that fails
 * leaves an orphan, which is a storage cost, while a delete that ran first would leave a row
 * pointing at nothing — a broken picture on a colleague's screen rather than a bill.
 *
 * It never deletes the key just written. The key IS the content's hash, so somebody re-uploading
 * the picture they already hold resolves to the same object, and sweeping "the old one" would
 * delete the one the new row points at.
 */
async function sweepReplacedPhoto(
  bucket: R2Bucket,
  replacedObjectKey: string | null,
  keepObjectKey: string,
): Promise<void> {
  if (replacedObjectKey === null || replacedObjectKey === keepObjectKey) return;
  try {
    await bucket.delete(replacedObjectKey);
  } catch {
    // Deliberate: the member's picture is set, which is what they asked for.
  }
}

/**
 * Files the act on the account's own history.
 *
 * NOTHING ABOUT THE BYTES GOES IN THE ROW. An audit row is read by a person asking what happened to
 * an account, and a hash of somebody's photograph answers no question they have while being one more
 * copy of a fact about a person. The event and the subject are the whole record.
 *
 * Guarded the way every other auth-audit write is: observability must never break the act it
 * describes, so a failed INSERT is swallowed rather than turned into a refusal of a change that
 * already landed.
 */
async function auditPhoto(env: Bindings, userId: UserId, event: string): Promise<void> {
  try {
    await insertAuthAuditStatement(env.DB_CONTROL, {
      id: newIdentifier("authAudit"),
      event,
      userId,
      metadata: null,
      now: new Date().toISOString(),
    }).run();
  } catch {
    // See above.
  }
}
