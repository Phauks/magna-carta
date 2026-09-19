import { type OpenAPIHono, z } from "@hono/zod-openapi";
import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import { insertAuditLogStatement } from "@magna-carta/data-access/audit-statements";
import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import { readImageFacts } from "@magna-carta/document-assembly/ooxml-image";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import {
  MAX_ADDITIONAL_BRAND_IMAGES,
  removeFirmBrandImage,
  setFirmBrandImage,
  updateFirmBrandImage,
} from "@magna-carta/locations/brand-image-service";
import {
  readFirmBrandImage,
  readFirmBrandImages,
  type FirmBrandImageRow,
} from "@magna-carta/locations/brand-image-statements";
import { LocationValidationError } from "@magna-carta/locations/validation";
import { firmScopedObjectDimensions } from "@magna-carta/object-dimensions/dimensions";
import type { Context } from "hono";
import type { Bindings } from "../bindings.ts";
import type { Chokepoint } from "../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointFirmId,
  requireChokepointIdempotency,
  requireChokepointUserId,
} from "../chokepoint/context-accessors.ts";
import type { AppVariables } from "../chokepoint/ports.ts";
import { chokepointMiddleware } from "../chokepoint/register.ts";
import { idempotencyKeyHeader } from "../contracts/common.ts";
import { Problem, problemJson, type ProblemResponse } from "../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../contracts/route-meta.ts";
import { resolveFirmBucket } from "../files/firm-bucket.ts";
import { problemResponseForIdempotencyConflict } from "../idempotency-conflict-problems.ts";
import { decodeBase64, imageResponse, sha256Hex } from "./locations.ts";

// THE FIRM'S OWN NAME, as its clients read it.
//
// There is deliberately no GET here. Every session already resolves the firm's display name — the
// bootstrap returns it as `firm.name`, and the chokepoint's own firm context reads it for every
// request — so a second read would be a second answer to the same question, and the one a screen
// would have to reconcile against the session it is already holding.
//
// WHICH COLUMN, AND WHY IT IS NOT THE OTHER ONE. `firm.name` is the provisioner's resume identity:
// it is UNIQUE, it is what a crashed provisioning run finds its own partial row by, and for a
// self-serve firm it is a platform-generated handle rather than anything a person chose. Renaming
// it would break that and would let one firm's chosen name refuse another's. `firm.display_name` is
// the human-facing one, unique to nobody, and null there means "the operator-typed name stands" —
// which is why clearing it is a real act rather than a validation failure.
//
// The write lands on the CONTROL plane and its audit row lands in the FIRM's own log, which cannot
// share that batch. The ordering follows the release-channel route exactly: the idempotency record
// and the name commit together, and the audit row is written after, on the first execution only, so
// a replay short-circuits before it and cannot double-write history.

const PERMISSION = "firm:manageProfile" as const;

const FirmProfileResponse = z
  .object({
    displayName: z.string().openapi({
      description:
        "What the firm is called to its clients — on invoices, in the portal, and on every " +
        "generated document. Never the provisioning handle behind it.",
    }),
  })
  .openapi("FirmProfileResponse");

const SetFirmProfileRequest = z
  .object({
    displayName: z
      .string()
      .trim()
      .min(1)
      .max(200)
      // The same normalization the joining door applies to a firm name it is given, so a name
      // typed here and the same name typed there are the same name.
      .transform((value) => value.normalize("NFC"))
      .openapi({
        description:
          "The firm's human-facing name. Required and non-empty: a firm with no name prints none " +
          "on the documents it sends.",
      }),
  })
  .openapi("SetFirmProfileRequest");

const errorResponses = {
  400: {
    description: "Missing Idempotency-Key (this operation requires one)",
    content: { "application/problem+json": { schema: Problem } },
  },
  401: {
    description: "No valid session",
    content: { "application/problem+json": { schema: Problem } },
  },
  403: {
    description: "The session member lacks firm:manageProfile",
    content: { "application/problem+json": { schema: Problem } },
  },
  404: {
    description: "The firm is unreachable or the member is deactivated",
    content: { "application/problem+json": { schema: Problem } },
  },
  409: {
    description: "A request with this Idempotency-Key is already in progress",
    content: { "application/problem+json": { schema: Problem } },
  },
  422: {
    description:
      "The name is empty or too long, or the Idempotency-Key was reused with a different body",
    content: { "application/problem+json": { schema: Problem } },
  },
  429: {
    description: "Rate limit exceeded",
    content: { "application/problem+json": { schema: Problem } },
  },
} as const;

const setMeta: RouteMeta = {
  operationId: "firmProfile.set",
  surface: "app",
  authenticated: true,
  permission: PERMISSION,
  resource: "firm",
  // Audited: the name on an invoice is what a client recognises the firm by, and a later "when did
  // we start calling ourselves this" turns on who changed it and when.
  audited: true,
  idempotency: "required",
  // The business write is the control-plane firm row, so its idempotency record commits there too —
  // atomic with the write, on the members.invite precedent.
  idempotencyStore: "control",
  rateLimit: "default",
};

const setRoute = defineOpenAPIRoute(setMeta, {
  method: "put",
  path: "/api/v1/firm/profile",
  description:
    "Sets what the firm is called to its clients. The name reaches invoices, the client portal " +
    "and generated documents from the moment it is saved; documents already produced keep the " +
    "name they were produced under. Read it from the session bootstrap, which resolves it for " +
    "every request already.",
  request: {
    headers: idempotencyKeyHeader,
    body: { required: true, content: { "application/json": { schema: SetFirmProfileRequest } } },
  },
  responses: {
    200: {
      description: "The firm's name after the write",
      content: { "application/json": { schema: FirmProfileResponse } },
    },
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
    409: errorResponses[409],
    422: errorResponses[422],
    429: errorResponses[429],
  },
});

// ---- the firm's brand images -------------------------------------------------------------------
//
// THE FIRM'S OWN MARKS: a primary mark, and the additional images a firm keeps beside it — a seal,
// a wordmark, a monogram. Firm-wide, where the letterhead logo on an office is per office, and the
// office's letterhead falls back to the primary mark, so a single-office firm sets its mark ONCE.
// The bytes go to the firm's own bucket under their hash; the row carries what a document needs to
// draw them. The read answers a SHAPE rather than a list — the one primary, then the rest — and
// the rest is bounded by construction (MAX_ADDITIONAL_BRAND_IMAGES), which is what lets a
// letterhead resolve it in one read. Uploaded inline as base64, the way the office logo is: a mark
// is tens of kilobytes, and one request carrying the bytes is the only shape where reading what
// they are, measuring them and writing the row happen together.

const BRAND_IMAGE_OBJECT_PREFIX = "brand/";

const Sha256Field = z.string().regex(/^[0-9a-f]{64}$/u);
const brandImageParam = z.object({ sha256: Sha256Field });

const BrandImage = z
  .object({
    // The image's identity: the SHA-256 of its bytes. Uploading the same mark twice is the same row.
    sha256: z.string(),
    role: z.enum(["primary", "additional"]),
    label: z.string().nullable(),
    contentType: z.string(),
    sizeBytes: z.number().int(),
    widthPixels: z.number().int(),
    heightPixels: z.number().int(),
    updatedAt: z.string(),
  })
  .openapi("FirmBrandImage");

const BrandImagesResponse = z
  .object({
    primary: BrandImage.nullable(),
    additional: z.array(BrandImage),
    // The bound on `additional`, stated so the screen can say when the set is full rather than
    // offering an upload the server will refuse.
    additionalLimit: z.number().int(),
  })
  .openapi("FirmBrandImagesResponse");

const SetBrandImageRequest = z
  .object({
    // Base64 of the image itself. What the bytes ARE is decided by reading them.
    imageBase64: z.string().min(1),
    role: z.enum(["primary", "additional"]),
    // What the image is FOR, in the firm's words. Optional: a primary mark needs no caption.
    label: z.string().max(80).nullable().optional(),
  })
  .openapi("SetFirmBrandImageRequest");

const UpdateBrandImageRequest = z
  .object({
    role: z.enum(["primary", "additional"]).optional(),
    label: z.string().max(80).nullable().optional(),
  })
  .openapi("UpdateFirmBrandImageRequest");

const BrandImageAck = z.object({ sha256: z.string() }).openapi("FirmBrandImageAck");

const brandReadErrors = {
  401: errorResponses[401],
  404: errorResponses[404],
  429: errorResponses[429],
} as const;

function brandWriteMeta(operationId: string): RouteMeta {
  return {
    operationId,
    surface: "app",
    authenticated: true,
    permission: PERMISSION,
    resource: "firm",
    // Audited: a firm's mark is what a client recognises its documents by.
    audited: true,
    idempotency: "required",
    // The rows live in the firm's own database, so the idempotency record commits there too.
    idempotencyStore: "firm",
    rateLimit: "default",
  };
}

const listBrandImagesMeta: RouteMeta = {
  operationId: "firmProfile.listBrandImages",
  surface: "app",
  authenticated: true,
  // Every member may see the firm's marks: they are on every document the firm sends.
  permission: null,
  resource: "firm",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};
const getBrandImageContentMeta: RouteMeta = {
  ...listBrandImagesMeta,
  operationId: "firmProfile.getBrandImageContent",
};

const listBrandImagesRoute = defineOpenAPIRoute(listBrandImagesMeta, {
  method: "get",
  path: "/api/v1/firm/profile/brand-images",
  description:
    "The firm's brand images: its primary mark, and the additional images kept beside it. The set " +
    "is small by construction, which is why it answers whole rather than by page.",
  responses: {
    200: {
      description: "The firm's marks",
      content: { "application/json": { schema: BrandImagesResponse } },
    },
    401: brandReadErrors[401],
    404: brandReadErrors[404],
    429: brandReadErrors[429],
  },
});

const getBrandImageContentRoute = defineOpenAPIRoute(getBrandImageContentMeta, {
  method: "get",
  path: "/api/v1/firm/profile/brand-images/{sha256}/content",
  description: "Streams one brand image's bytes, in the type they were read to be when stored.",
  request: { params: brandImageParam },
  responses: {
    200: {
      description: "The image bytes",
      content: {
        "image/png": { schema: z.string() },
        "image/jpeg": { schema: z.string() },
      },
    },
    401: brandReadErrors[401],
    404: brandReadErrors[404],
    429: brandReadErrors[429],
  },
});

const setBrandImageRoute = defineOpenAPIRoute(brandWriteMeta("firmProfile.setBrandImage"), {
  method: "put",
  path: "/api/v1/firm/profile/brand-images",
  description:
    "Adds a brand image, or re-files one the firm already holds under a new role or caption. The " +
    "image must be a PNG or a JPEG, decided by reading the file. Adding a primary demotes the " +
    "previous primary to an additional image rather than removing it.",
  request: {
    headers: idempotencyKeyHeader,
    body: { content: { "application/json": { schema: SetBrandImageRequest } }, required: true },
  },
  responses: {
    200: {
      description: "The image is held",
      content: { "application/json": { schema: BrandImageAck } },
    },
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
    409: errorResponses[409],
    422: {
      description:
        "The request is invalid, the file is not a PNG or a JPEG, it is too large, the firm already " +
        "holds as many additional images as it may, or the Idempotency-Key was reused with a " +
        "different payload",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: errorResponses[429],
  },
});

const updateBrandImageRoute = defineOpenAPIRoute(brandWriteMeta("firmProfile.updateBrandImage"), {
  method: "patch",
  path: "/api/v1/firm/profile/brand-images/{sha256}",
  description:
    "Changes what a held image is: makes it the primary mark, or gives it a different caption.",
  request: {
    headers: idempotencyKeyHeader,
    params: brandImageParam,
    body: { content: { "application/json": { schema: UpdateBrandImageRequest } }, required: true },
  },
  responses: {
    200: {
      description: "The image was changed",
      content: { "application/json": { schema: BrandImageAck } },
    },
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
    409: errorResponses[409],
    422: errorResponses[422],
    429: errorResponses[429],
  },
});

const removeBrandImageRoute = defineOpenAPIRoute(
  {
    ...brandWriteMeta("firmProfile.removeBrandImage"),
    reversal: { kind: "inverse", by: "firmProfile.setBrandImage" },
  },
  {
    method: "delete",
    path: "/api/v1/firm/profile/brand-images/{sha256}",
    description:
      "Removes a brand image. Documents already produced keep the mark they were produced with; " +
      "an office whose letterhead fell back to a removed primary prints no mark until another is set.",
    request: { headers: idempotencyKeyHeader, params: brandImageParam },
    responses: {
      200: {
        description: "The image was removed",
        content: { "application/json": { schema: BrandImageAck } },
      },
      400: errorResponses[400],
      401: errorResponses[401],
      403: errorResponses[403],
      404: errorResponses[404],
      409: errorResponses[409],
      422: errorResponses[422],
      429: errorResponses[429],
    },
  },
);

function brandImageOf(row: FirmBrandImageRow): z.infer<typeof BrandImage> {
  return {
    sha256: row.id,
    role: row.role,
    label: row.label,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    widthPixels: row.widthPixels,
    heightPixels: row.heightPixels,
    updatedAt: row.updatedAt,
  };
}

function brandImageErrorResponse(
  c: Context,
  error: LocationValidationError,
): ProblemResponse<404> | ProblemResponse<422> {
  if (error.code === "unknown-brand-image") {
    return problemJson(c, {
      type: "not-found",
      title: "Not found",
      status: 404,
      detail: "The firm holds no brand image under that hash.",
    });
  }
  return problemJson(c, {
    type: "validation",
    title: "Invalid brand image request",
    status: 422,
    detail: error.message,
  });
}

type BrandImageOutcome =
  | { ok: true; replayed: boolean }
  | {
      ok: false;
      problem:
        | ProblemResponse<400>
        | ProblemResponse<404>
        | ProblemResponse<409>
        | ProblemResponse<422>;
    };

// Commits a brand-image effect idempotently against the firm's own database. The success response
// stays in the handler so it carries the route's exact typed shape.
async function commitBrandImageEffect(
  c: Context,
  database: Parameters<typeof runIdempotentEffect>[0]["database"],
  idempotency: { key: string | undefined; fingerprint: string },
  sha256: string,
  call: () => Promise<{ effect: EffectWrite }>,
): Promise<BrandImageOutcome> {
  let result;
  try {
    result = await runIdempotentEffect({
      database,
      key: idempotency.key,
      fingerprint: idempotency.fingerprint,
      now: () => new Date().toISOString(),
      effect: async () => {
        const { effect } = await call();
        return {
          write: effect,
          responseCode: 200,
          responseBody: canonicalJsonStringify({ sha256 }),
        };
      },
    });
  } catch (caught) {
    if (caught instanceof LocationValidationError) {
      return { ok: false, problem: brandImageErrorResponse(c, caught) };
    }
    throw caught;
  }
  if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch") {
    return { ok: false, problem: problemResponseForIdempotencyConflict(c, result) };
  }
  return { ok: true, replayed: result.kind === "replayed" };
}

// Remove an object the firm has stopped pointing at — best-effort, AFTER the row is gone, and never
// while any other row still names the key (the key is the content's hash, so two roles could once
// have shared it). An orphan is a storage cost; a row pointing at nothing is a document that fails
// at assembly time.
async function sweepBrandObject(bucket: R2Bucket, objectKey: string): Promise<void> {
  try {
    await bucket.delete(objectKey);
  } catch {
    // The row is already gone; the object's cost is the only thing left, and it is not a fault.
  }
}

export function registerFirmProfileRoutes(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  chokepoint: Chokepoint,
): void {
  // GET /api/v1/firm/profile/brand-images
  app.openapi(
    { ...listBrandImagesRoute, middleware: chokepointMiddleware(chokepoint, listBrandImagesRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const rows = await readFirmBrandImages(firm.firmDatabase);
      const primary = rows.find((row) => row.role === "primary");
      return c.json(
        {
          primary: primary === undefined ? null : brandImageOf(primary),
          additional: rows.filter((row) => row.role !== "primary").map(brandImageOf),
          additionalLimit: MAX_ADDITIONAL_BRAND_IMAGES,
        } satisfies z.infer<typeof BrandImagesResponse>,
        200,
      );
    },
  );

  // GET /api/v1/firm/profile/brand-images/{sha256}/content
  app.openapi(
    {
      ...getBrandImageContentRoute,
      middleware: chokepointMiddleware(chokepoint, getBrandImageContentRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { sha256 } = c.req.valid("param");
      const row = await readFirmBrandImage(firm.firmDatabase, sha256);
      const { bucket } = resolveFirmBucket(c.env, firm.bucketName);
      const response =
        row === undefined ? null : await imageResponse(bucket, row.objectKey, row.contentType);
      if (response === null) {
        return problemJson(c, {
          type: "not-found",
          title: "Not found",
          status: 404,
          detail: "The firm holds no brand image under that hash.",
        });
      }
      return response;
    },
  );

  // PUT /api/v1/firm/profile/brand-images
  app.openapi(
    { ...setBrandImageRoute, middleware: chokepointMiddleware(chokepoint, setBrandImageRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { imageBase64, role, label } = c.req.valid("json");

      const bytes = decodeBase64(imageBase64);
      if (bytes === undefined) {
        return problemJson(c, {
          type: "validation",
          title: "Not a readable file",
          status: 422,
          detail: "The image field is not valid base64.",
        });
      }
      // WHAT THE BYTES ARE IS READ FROM THE BYTES — the same reader the office logo and the assembly
      // engine use, so nothing can be stored that a document will later refuse to draw.
      const facts = readImageFacts(bytes);
      if (!facts.ok) {
        return problemJson(c, {
          type: "validation",
          title: "Not a usable brand image",
          status: 422,
          detail: facts.detail,
        });
      }

      const { bucket } = resolveFirmBucket(c.env, firm.bucketName);
      const digest = await sha256Hex(bytes);
      const objectKey = `${BRAND_IMAGE_OBJECT_PREFIX}${digest}.${facts.value.extension}`;
      // Written before the row that points at it, on the office logo's reasoning: an object nothing
      // references is a cost; a row pointing at nothing is a document that fails at assembly time.
      // A firm's mark belongs to every matter's documents and to none of them.
      await bucket.put(objectKey, bytes as unknown as ArrayBuffer, {
        sha256: digest,
        customMetadata: firmScopedObjectDimensions("letterhead-image"),
      });

      const outcome = await commitBrandImageEffect(c, firm.firmDatabase, idempotency, digest, () =>
        setFirmBrandImage(
          firm.firmDatabase,
          {
            sha256: digest,
            role,
            label: label ?? null,
            objectKey,
            contentType: facts.value.contentType,
            sizeBytes: bytes.byteLength,
            widthPixels: facts.value.widthPixels,
            heightPixels: facts.value.heightPixels,
          },
          { clock: { now: () => new Date().toISOString() }, actorUserId: userId },
        ),
      );
      if (!outcome.ok) return outcome.problem;
      if (outcome.replayed) c.header("Idempotency-Replayed", "true");
      return c.json({ sha256: digest } satisfies z.infer<typeof BrandImageAck>, 200);
    },
  );

  // PATCH /api/v1/firm/profile/brand-images/{sha256}
  app.openapi(
    {
      ...updateBrandImageRoute,
      middleware: chokepointMiddleware(chokepoint, updateBrandImageRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { sha256 } = c.req.valid("param");
      const patch = c.req.valid("json");
      const outcome = await commitBrandImageEffect(c, firm.firmDatabase, idempotency, sha256, () =>
        updateFirmBrandImage(firm.firmDatabase, sha256, patch, {
          clock: { now: () => new Date().toISOString() },
          actorUserId: userId,
        }),
      );
      if (!outcome.ok) return outcome.problem;
      if (outcome.replayed) c.header("Idempotency-Replayed", "true");
      return c.json({ sha256 } satisfies z.infer<typeof BrandImageAck>, 200);
    },
  );

  // DELETE /api/v1/firm/profile/brand-images/{sha256}
  app.openapi(
    {
      ...removeBrandImageRoute,
      middleware: chokepointMiddleware(chokepoint, removeBrandImageRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { sha256 } = c.req.valid("param");
      let removedObjectKey: string | null = null;
      const outcome = await commitBrandImageEffect(
        c,
        firm.firmDatabase,
        idempotency,
        sha256,
        async () => {
          const removed = await removeFirmBrandImage(firm.firmDatabase, sha256, {
            clock: { now: () => new Date().toISOString() },
            actorUserId: userId,
          });
          removedObjectKey = removed.removedObjectKey;
          return removed;
        },
      );
      if (!outcome.ok) return outcome.problem;
      if (removedObjectKey !== null) {
        const { bucket } = resolveFirmBucket(c.env, firm.bucketName);
        await sweepBrandObject(bucket, removedObjectKey);
      }
      if (outcome.replayed) c.header("Idempotency-Replayed", "true");
      return c.json({ sha256 } satisfies z.infer<typeof BrandImageAck>, 200);
    },
  );

  app.openapi(
    { ...setRoute, middleware: chokepointMiddleware(chokepoint, setRoute) },
    async (c) => {
      const userId = requireChokepointUserId(c);
      const firmId = requireChokepointFirmId(c);
      const firmContext = requireChokepointFirmContext(c);
      const { displayName } = c.req.valid("json");
      const idempotency = requireChokepointIdempotency(c);

      // Captured inside the effect for the post-commit audit row, which cannot ride its batch.
      let previousName = "";
      let capturedNow = new Date().toISOString();

      const result = await runIdempotentEffect({
        database: c.env.DB_CONTROL,
        key: idempotency.key,
        fingerprint: idempotency.fingerprint,
        effect: async () => {
          capturedNow = new Date().toISOString();
          const row = await c.env.DB_CONTROL.prepare(
            "SELECT name, display_name FROM firm WHERE id = ?1",
          )
            .bind(firmId)
            .first<{ name: string; display_name: string | null }>();
          // What the firm was CALLED before, resolved the same way every read resolves it, so the
          // audit row records the change a person would have seen rather than a null.
          previousName = row === null ? "" : (row.display_name ?? row.name);

          return {
            write: {
              statements: [
                c.env.DB_CONTROL.prepare("UPDATE firm SET display_name = ?2 WHERE id = ?1").bind(
                  firmId,
                  displayName,
                ),
              ],
              outboxMessages: [],
            },
            responseCode: 200,
            responseBody: canonicalJsonStringify({ displayName }),
          };
        },
      });

      if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch") {
        return problemResponseForIdempotencyConflict(c, result);
      }

      if (result.kind === "replayed") {
        c.header("Idempotency-Replayed", "true");
      } else {
        // First execution only: the firm's own log, after the control-plane batch is durable. A
        // replay short-circuits above and cannot reach this.
        await insertAuditLogStatement(firmContext.firmDatabase, {
          id: newIdentifier("auditLog"),
          event: "firm.profile_updated",
          actorUserId: userId,
          subjectId: firmId,
          // The firm's own name on both sides. It is the firm's, not a person's, and it is the fact
          // the row exists to record.
          metadata: { from: previousName, to: displayName },
          now: capturedNow,
        }).run();
      }

      return c.json({ displayName }, 200);
    },
  );
}
