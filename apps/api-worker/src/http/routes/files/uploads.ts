import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import { readFirmSetting } from "@magna-carta/data-access/setting-statements";
import { setUploadSessionR2UploadIdStatement } from "@magna-carta/file-manager/file-statements";
import {
  abortUploadSession,
  completeUploadSession,
  duplicateVersionIntoMatter,
  initiateUpload,
  loadUploadSession,
} from "@magna-carta/file-manager/file-service";
import {
  findCurrentVersionsByContent,
  getUploadSessionStatus,
} from "@magna-carta/file-manager/queries";
import { modeThresholdDefinition } from "@magna-carta/file-manager/upload-policy";
import { FileManagerValidationError } from "@magna-carta/file-manager/validation";
import type { UploadSessionId } from "@magna-carta/identifiers/types";
import type { ObjectDimensions } from "@magna-carta/object-dimensions/dimensions";
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
import { Problem, problemJson } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";
import { resolveFirmBucket } from "../../../files/firm-bucket.ts";
import { copyObjectIntoMatter } from "../../../files/object-stamping.ts";
import { presignerForEnv } from "../../../files/presigner-wiring.ts";
import {
  problemResponseForIdempotencyConflict,
  storedResponseBody,
} from "../../idempotency-conflict-problems.ts";

// The direct-to-R2 upload surface: the Worker never touches the bytes — it mints the pending
// file/version/session rows and a single-key, single-method, short-TTL presigned URL the client
// uploads to. A single-shot PUT at or below the firm's mode threshold; a resumable multipart session
// above it. The R2 object-create event then drives the ingest consumer (gates + hash + scan).

const PRESIGN_TTL_SECONDS = 3600; // 1 hour to start a PUT or sign a part — well within a session's life
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24h: the stale-pending sweep aborts sessions past this

// Body field handles — branded identifier fields (pattern-checked; the brand is compile-time only, so
// each emits as a plain constrained string and a handler passes the parsed value straight to a domain
// service that demands the branded type).
const matterIdField = identifierField("matter");
const folderIdField = identifierField("folder");
const fileIdField = identifierField("file");
const documentTypeIdField = identifierField("documentType");

const InitiateUploadRequest = z
  .object({
    matterId: matterIdField,
    folderId: folderIdField.nullable().optional(),
    name: z.string().min(1),
    declaredSize: z.number().int().nonnegative().nullable(),
    declaredContentType: z.string().min(1).nullable(),
    documentTypeId: documentTypeIdField.nullable().optional(),
    // Present = a new version on an existing file; absent = a new file.
    fileId: fileIdField.optional(),
    // Absent or "interactive" = the file lands in the interactive ingest lane (files/ key prefix);
    // "bulk" = the file lands in the bulk ingest lane (bulk/ key prefix, lower queue concurrency).
    uploadKind: z.enum(["interactive", "bulk"]).optional(),
    // The last-modified instant the reader's device reported for the source file. Recorded on the
    // version whichever way the file is dated; the browser's File.lastModified, as an ISO-8601 instant.
    sourceModifiedAt: z.string().datetime({ offset: true }).nullable().optional(),
    // How a NEW file is dated: "upload" (default) at this reservation, "source" at the source file's
    // own last-modified instant, clamped to now. Ignored for a new version of an existing file.
    createdAtBasis: z.enum(["upload", "source"]).optional(),
  })
  .openapi("InitiateUploadRequest");

// The response is a discriminated union on mode: a single-shot PUT carries the URL + headers the
// client uploads with; a multipart session carries only the session id (Uppy's uploadId) and key —
// the client then signs parts and completes through the endpoints below.
const InitiateUploadResponse = z
  .discriminatedUnion("mode", [
    z.object({
      mode: z.literal("put"),
      uploadId: z.string(),
      fileId: z.string(),
      versionId: z.string(),
      key: z.string(),
      method: z.literal("PUT"),
      url: z.string(),
      headers: z.record(z.string(), z.string()),
    }),
    z.object({
      mode: z.literal("multipart"),
      uploadId: z.string(),
      fileId: z.string(),
      versionId: z.string(),
      key: z.string(),
    }),
  ])
  .openapi("InitiateUploadResponse");

const SignPartResponse = z.object({ url: z.string() }).openapi("SignUploadPartResponse");

const CompleteUploadRequest = z
  .object({
    // The multipart parts (omitted for a single-shot PUT, whose object is already in R2).
    parts: z
      .array(z.object({ partNumber: z.number().int().positive(), etag: z.string().min(1) }))
      .optional(),
  })
  .openapi("CompleteUploadRequest");

const CompleteUploadResponse = z
  .object({ key: z.string(), location: z.string() })
  .openapi("CompleteUploadResponse");

const AbortUploadResponse = z
  .object({ status: z.literal("aborted") })
  .openapi("AbortUploadResponse");

// The upload-status poll's payload: how far the direct-to-R2 ceremony got (sessionStatus) and what
// ingest decided about the bytes (versionStatus), plus the quarantine reason when the bytes were
// rejected as malware. quarantineReason is present only when versionStatus is "quarantined".
const UploadStatusResponse = z
  .object({
    sessionStatus: z.enum(["open", "completed", "aborted", "expired"]),
    versionStatus: z.enum(["pending", "clean", "quarantined", "abandoned"]),
    quarantineReason: z.string().nullable(),
  })
  .openapi("UploadStatusResponse");

const uploadSessionParam = z.object({ id: identifierPathParam("uploadSession", "id") });

// The question the upload dialog asks before sending a byte: does the firm already hold these bytes?
// The digest is the reader's browser's own SHA-256 over the file; the size is a second key.
const UploadMatchesRequest = z
  .object({
    matterId: matterIdField,
    sha256: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .openapi({ description: "SHA-256 of the file's bytes, lowercase hex." }),
    sizeBytes: z.number().int().nonnegative(),
  })
  .openapi("UploadMatchesRequest");

const UploadMatchesResponse = z
  .object({
    // Live files on the TARGET matter whose current version is these bytes: the file is already there.
    onMatter: z.array(
      z.object({
        fileId: z.string(),
        versionId: z.string(),
        folderId: z.string().nullable(),
        name: z.string(),
      }),
    ),
    // Live files elsewhere in the firm with these bytes: a duplicate can be made without an upload.
    elsewhere: z.array(
      z.object({ fileId: z.string(), versionId: z.string(), matterId: z.string() }),
    ),
  })
  .openapi("UploadMatchesResponse");

const DuplicateUploadRequest = z
  .object({
    sourceVersionId: identifierField("fileVersion"),
    matterId: matterIdField,
    folderId: folderIdField.nullable().optional(),
    name: z.string().min(1),
    documentTypeId: documentTypeIdField.nullable().optional(),
    sourceModifiedAt: z.string().datetime({ offset: true }).nullable().optional(),
    createdAtBasis: z.enum(["upload", "source"]).optional(),
  })
  .openapi("DuplicateUploadRequest");

const DuplicateUploadResponse = z
  .object({ fileId: z.string(), versionId: z.string() })
  .openapi("DuplicateUploadResponse");

const FILES_PERMISSION = "files:upload" as const;

export const initiateUploadMeta: RouteMeta = {
  operationId: "uploads.initiate",
  surface: "app",
  authenticated: true,
  permission: FILES_PERMISSION,
  resource: "matter",
  audited: true,
  idempotency: "required",
  // Firm-scoped business → the per-firm idempotency store (record + rows + outbox in one batch).
  idempotencyStore: "firm",
  rateLimit: "default",
};

export const initiateUploadRoute = defineOpenAPIRoute(initiateUploadMeta, {
  method: "post",
  path: "/api/v1/uploads",
  description:
    "Begins a direct-to-R2 upload: mints the pending file/version/upload-session rows and returns " +
    "either a single-shot presigned PUT (at or below the firm's mode threshold) or a multipart " +
    "session (above it). The bytes never transit the Worker.",
  request: {
    headers: idempotencyKeyHeader,
    body: { content: { "application/json": { schema: InitiateUploadRequest } }, required: true },
  },
  responses: {
    201: {
      description: "The upload was initiated; use the returned URL (PUT) or session (multipart)",
      content: { "application/json": { schema: InitiateUploadResponse } },
    },
    400: {
      description: "Missing Idempotency-Key (this operation requires one)",
      content: { "application/problem+json": { schema: Problem } },
    },
    401: {
      description: "No valid session",
      content: { "application/problem+json": { schema: Problem } },
    },
    403: {
      description: "The session member lacks files:upload",
      content: { "application/problem+json": { schema: Problem } },
    },
    404: {
      description:
        "The firm is unreachable, the member is deactivated, or the target file is unknown",
      content: { "application/problem+json": { schema: Problem } },
    },
    409: {
      description: "A request with this Idempotency-Key is still in progress",
      content: { "application/problem+json": { schema: Problem } },
    },
    422: {
      description:
        "The firm policy refuses this upload, or the Idempotency-Key was reused with a different payload",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

export const uploadMatchesMeta: RouteMeta = {
  operationId: "uploads.matches",
  surface: "app",
  authenticated: true,
  permission: FILES_PERMISSION,
  resource: "matter",
  // A read over the firm's committed hashes: no state moves, so no audit row and no idempotency key.
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

export const uploadMatchesRoute = defineOpenAPIRoute(uploadMatchesMeta, {
  method: "post",
  path: "/api/v1/uploads/matches",
  description:
    "Answers whether the firm already holds a file's bytes, by SHA-256 and size, before they are " +
    "uploaded: the live files on the target matter whose current version is those bytes, and the " +
    "live files elsewhere in the firm. Either kind of match can be duplicated into a new file on " +
    "the matter server-side (uploads.duplicate) with no bytes sent — holding the bytes already is " +
    "a reason not to send them, never a reason not to file what the caller chose to file.",
  request: {
    body: { content: { "application/json": { schema: UploadMatchesRequest } }, required: true },
  },
  responses: {
    200: {
      description: "The files that hold these bytes, on the matter and elsewhere in the firm",
      content: { "application/json": { schema: UploadMatchesResponse } },
    },
    401: {
      description: "No valid session",
      content: { "application/problem+json": { schema: Problem } },
    },
    403: {
      description: "The session member lacks files:upload",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

export const duplicateUploadMeta: RouteMeta = {
  operationId: "uploads.duplicate",
  surface: "app",
  authenticated: true,
  permission: FILES_PERMISSION,
  resource: "matter",
  audited: true,
  idempotency: "required",
  idempotencyStore: "firm",
  rateLimit: "default",
};

export const duplicateUploadRoute = defineOpenAPIRoute(duplicateUploadMeta, {
  method: "post",
  path: "/api/v1/uploads/duplicates",
  description:
    "Makes a new file on a matter out of bytes the firm already holds: the named committed version " +
    "is copied server-side into the new file's own key and committed at once with the verdict the " +
    "gate reached on those bytes. No bytes cross the network. The dating and the document type are " +
    "the new file's own, as for an upload.",
  request: {
    headers: idempotencyKeyHeader,
    body: { content: { "application/json": { schema: DuplicateUploadRequest } }, required: true },
  },
  responses: {
    201: {
      description: "The file was made from the held bytes",
      content: { "application/json": { schema: DuplicateUploadResponse } },
    },
    400: {
      description: "Missing Idempotency-Key (this operation requires one)",
      content: { "application/problem+json": { schema: Problem } },
    },
    401: {
      description: "No valid session",
      content: { "application/problem+json": { schema: Problem } },
    },
    403: {
      description: "The session member lacks files:upload",
      content: { "application/problem+json": { schema: Problem } },
    },
    404: {
      description: "No committed version by that id in this firm, or no such folder on the matter",
      content: { "application/problem+json": { schema: Problem } },
    },
    409: {
      description: "A request with this Idempotency-Key is still in progress",
      content: { "application/problem+json": { schema: Problem } },
    },
    422: {
      description: "The Idempotency-Key was reused with a different payload",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

export const signUploadPartMeta: RouteMeta = {
  operationId: "uploads.signPart",
  surface: "app",
  authenticated: true,
  permission: FILES_PERMISSION,
  resource: "matter",
  // A GET: signing a part is a read-like credential mint, not a state mutation — no audit row, no
  // idempotency record. The bytes go straight to R2 with the returned URL.
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

export const signUploadPartRoute = defineOpenAPIRoute(signUploadPartMeta, {
  method: "get",
  path: "/api/v1/uploads/{id}/parts/{partNumber}",
  description:
    "Signs one part of an open multipart upload session, returning a short-TTL presigned PUT URL " +
    "the client uploads the part to. The session must be open and multipart.",
  request: {
    params: uploadSessionParam.extend({
      partNumber: z
        .string()
        .regex(/^[1-9][0-9]*$/)
        .openapi({ param: { name: "partNumber", in: "path" } }),
    }),
  },
  responses: {
    200: {
      description: "A presigned PUT URL for the requested part",
      content: { "application/json": { schema: SignPartResponse } },
    },
    401: {
      description: "No valid session",
      content: { "application/problem+json": { schema: Problem } },
    },
    403: {
      description: "The session member lacks files:upload",
      content: { "application/problem+json": { schema: Problem } },
    },
    404: {
      description: "No such upload session in this firm",
      content: { "application/problem+json": { schema: Problem } },
    },
    409: {
      description: "The session is not open, or is not a multipart session",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

export const completeUploadMeta: RouteMeta = {
  operationId: "uploads.complete",
  surface: "app",
  authenticated: true,
  permission: FILES_PERMISSION,
  resource: "matter",
  audited: true,
  idempotency: "optional",
  rateLimit: "default",
};

export const completeUploadRoute = defineOpenAPIRoute(completeUploadMeta, {
  method: "post",
  path: "/api/v1/uploads/{id}/complete",
  description:
    "Finalizes an open upload session: completes the multipart upload at R2 (when multipart) and " +
    "marks the session completed. The version stays pending until ingest commits or quarantines it.",
  request: {
    params: uploadSessionParam,
    body: { content: { "application/json": { schema: CompleteUploadRequest } }, required: false },
  },
  responses: {
    200: {
      description: "The session was completed; the object is in R2 awaiting ingest",
      content: { "application/json": { schema: CompleteUploadResponse } },
    },
    401: {
      description: "No valid session",
      content: { "application/problem+json": { schema: Problem } },
    },
    403: {
      description: "The session member lacks files:upload",
      content: { "application/problem+json": { schema: Problem } },
    },
    404: {
      description: "No such upload session in this firm",
      content: { "application/problem+json": { schema: Problem } },
    },
    409: {
      description: "The session is not open, or a multipart completion was sent without parts",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

export const abortUploadMeta: RouteMeta = {
  operationId: "uploads.abort",
  surface: "app",
  authenticated: true,
  permission: FILES_PERMISSION,
  resource: "matter",
  audited: true,
  idempotency: "optional",
  rateLimit: "default",
};

export const abortUploadRoute = defineOpenAPIRoute(abortUploadMeta, {
  method: "post",
  path: "/api/v1/uploads/{id}/abort",
  description:
    "Aborts an open upload session: aborts the multipart upload at R2 (when multipart), marks the " +
    "session aborted, and abandons the pending version.",
  request: { params: uploadSessionParam },
  responses: {
    200: {
      description: "The session was aborted and its pending version abandoned",
      content: { "application/json": { schema: AbortUploadResponse } },
    },
    401: {
      description: "No valid session",
      content: { "application/problem+json": { schema: Problem } },
    },
    403: {
      description: "The session member lacks files:upload",
      content: { "application/problem+json": { schema: Problem } },
    },
    404: {
      description: "No such upload session in this firm",
      content: { "application/problem+json": { schema: Problem } },
    },
    409: {
      description: "The session is not open",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

export const getUploadMeta: RouteMeta = {
  operationId: "uploads.get",
  surface: "app",
  authenticated: true,
  // The status poll is part of the upload ceremony (initiate → sign/complete → poll), so it carries the
  // same files:upload capability as the rest of the surface; resource "matter" (file objects are
  // matter-rooted). A read: not audited, no idempotency key.
  permission: FILES_PERMISSION,
  resource: "matter",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

export const getUploadRoute = defineOpenAPIRoute(getUploadMeta, {
  method: "get",
  path: "/api/v1/uploads/{id}",
  description:
    "Reports an upload session's progress: the session status (open, completed, aborted, expired), " +
    "its version's ingest status (pending, clean, quarantined, abandoned), and — when the bytes were " +
    "rejected as malware — the quarantine reason. A session that belongs to another firm is 404.",
  request: { params: uploadSessionParam },
  responses: {
    200: {
      description: "The upload session's status",
      content: { "application/json": { schema: UploadStatusResponse } },
    },
    401: {
      description: "No valid session",
      content: { "application/problem+json": { schema: Problem } },
    },
    403: {
      description: "The session member lacks files:upload",
      content: { "application/problem+json": { schema: Problem } },
    },
    404: {
      description: "No such upload session in this firm",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

type UploadsApp = OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>;

export function registerUploadsRoutes(app: UploadsApp, chokepoint: Chokepoint): void {
  app.openapi(
    {
      ...initiateUploadRoute,
      middleware: chokepointMiddleware(chokepoint, initiateUploadRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      // The bucket every leg of this upload targets, resolved through the one seam the ingest
      // consumer reads through — so the bytes land where they will be read back from.
      const bucket = resolveFirmBucket(c.env, firm.bucketName).bucketName;
      const idempotency = requireChokepointIdempotency(c);
      const request = c.req.valid("json");
      const presigner = presignerForEnv(c.env);
      const now = () => new Date().toISOString();
      const threshold = await readFirmSetting(firm.firmDatabase, modeThresholdDefinition);
      const declaredSize = request.declaredSize;
      const mode: "put" | "multipart" =
        declaredSize !== null && declaredSize > threshold ? "multipart" : "put";
      const contentType = request.declaredContentType ?? "application/octet-stream";

      // The multipart session's r2_upload_id is filled in AFTER the idempotency batch commits, not
      // inside the effect: creating an R2 multipart upload there would leak a real upload at R2 on a
      // lost idempotency race (the loser's batch rolls back, but the side effect already happened).
      // The effect only reserves the session (open, r2_upload_id null) + the file/version rows + the
      // idempotency record. The multipart initiate response carries no upload id (sign-part/complete
      // load it from the session), so deferring it is safe; the put branch presigns a URL, which is a
      // pure credential mint with no server-side R2 state to leak.
      let multipartToCreate:
        | { sessionId: UploadSessionId; r2Key: string; dimensions: ObjectDimensions }
        | undefined;
      let result;
      try {
        result = await runIdempotentEffect({
          database: firm.firmDatabase,
          key: idempotency.key,
          fingerprint: idempotency.fingerprint,
          effect: async () => {
            const initiated = await initiateUpload(
              firm.firmDatabase,
              {
                matterId: request.matterId,
                folderId: request.folderId ?? null,
                name: request.name,
                declaredSize,
                declaredContentType: request.declaredContentType,
                uploadedBy: userId,
                mode,
                documentTypeId: request.documentTypeId ?? null,
                fileId: request.fileId,
                expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
                uploadKind: request.uploadKind,
                sourceModifiedAt: request.sourceModifiedAt ?? null,
                createdAtBasis: request.createdAtBasis,
              },
              { clock: { now }, actorUserId: userId },
            );
            let responseBody: Record<string, unknown>;
            if (mode === "put") {
              // The presigned URL carries the object's scope as signed metadata headers, returned
              // here for the client to send back verbatim. They are part of the signature, so an
              // upload that drops one is rejected by R2 rather than landing an unscoped object.
              const presigned = await presigner.presignPut(
                bucket,
                initiated.r2Key,
                contentType,
                PRESIGN_TTL_SECONDS,
                initiated.dimensions,
              );
              responseBody = {
                mode: "put",
                uploadId: initiated.uploadSessionId,
                fileId: initiated.fileId,
                versionId: initiated.versionId,
                key: initiated.r2Key,
                method: "PUT",
                url: presigned.url,
                // EXACTLY the signed set, and nothing beside it. This used to spread a
                // "Content-Type" of its own over a set that already carried "content-type": two
                // spellings of one header, which the browser's Headers merges into a single doubled
                // value ("application/pdf, application/pdf"). That value is not what was signed, so
                // R2 refused every production PUT with a signature mismatch while the same-origin
                // development route, which never checks the signature, passed. The presigner is the
                // one place that knows what it signed, so the presigner's set is the whole answer.
                headers: presigned.headers,
              };
            } else {
              // Defer the R2 multipart create until the batch commits (see above).
              multipartToCreate = {
                sessionId: initiated.uploadSessionId as UploadSessionId,
                r2Key: initiated.r2Key,
                dimensions: initiated.dimensions,
              };
              responseBody = {
                mode: "multipart",
                uploadId: initiated.uploadSessionId,
                fileId: initiated.fileId,
                versionId: initiated.versionId,
                key: initiated.r2Key,
              };
            }
            return {
              write: initiated.effect,
              responseCode: 201,
              responseBody: canonicalJsonStringify(responseBody),
            };
          },
        });
      } catch (caught) {
        if (caught instanceof FileManagerValidationError) {
          if (caught.code === "upload-policy-size" || caught.code === "upload-policy-type") {
            return problemJson(c, {
              type: "upload-not-allowed",
              title: "Upload not allowed",
              status: 422,
              detail: caught.message,
            });
          }
          if (
            caught.code === "unknown-file" ||
            // A new version of a soft-deleted file is refused the same way a missing one is: the
            // file is invisible to every read, and an upload must not be what reveals it.
            caught.code === "file-deleted" ||
            caught.code === "unknown-folder" ||
            // A cross-matter target (file's matter, or its folder's) is not a resource of the
            // requested matter — surfaced as not-found, never a 500.
            caught.code === "file-matter-mismatch" ||
            caught.code === "file-cross-matter"
          ) {
            return problemJson(c, {
              type: "not-found",
              title: "Not found",
              status: 404,
              detail: "No such resource in this firm.",
            });
          }
        }
        throw caught;
      }

      if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch") {
        return problemResponseForIdempotencyConflict(c, result);
      }
      // Only the winner (a fresh execute) creates the R2 multipart upload and persists its id; a
      // replayed hit returns the stored response and creates nothing (the loser never reserved a
      // session of its own — its batch rolled back). createMultipartUpload runs OUTSIDE the
      // idempotency batch, so a lost race can never leave an orphaned multipart upload at R2.
      if (result.kind === "executed" && multipartToCreate !== undefined) {
        const created = await presigner.createMultipartUpload(
          bucket,
          multipartToCreate.r2Key,
          contentType,
          multipartToCreate.dimensions,
        );
        await commitEffectBatch(
          firm.firmDatabase,
          {
            statements: [
              setUploadSessionR2UploadIdStatement(
                firm.firmDatabase,
                multipartToCreate.sessionId,
                created.uploadId,
              ),
            ],
            outboxMessages: [],
          },
          { now },
        );
      }
      if (result.kind === "replayed") c.header("Idempotency-Replayed", "true");
      const responseBody = JSON.parse(storedResponseBody(result)) as z.infer<
        typeof InitiateUploadResponse
      >;
      return c.json(responseBody, 201);
    },
  );

  app.openapi(
    { ...uploadMatchesRoute, middleware: chokepointMiddleware(chokepoint, uploadMatchesRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const request = c.req.valid("json");
      const matches = await findCurrentVersionsByContent(
        firm.firmDatabase,
        request.sha256,
        request.sizeBytes,
      );
      return c.json(
        {
          onMatter: matches
            .filter((match) => match.matterId === request.matterId)
            .map((match) => ({
              fileId: match.fileId,
              versionId: match.versionId,
              folderId: match.folderId,
              name: match.name,
            })),
          elsewhere: matches
            .filter((match) => match.matterId !== request.matterId)
            .map((match) => ({
              fileId: match.fileId,
              versionId: match.versionId,
              matterId: match.matterId,
            })),
        } as z.infer<typeof UploadMatchesResponse>,
        200,
      );
    },
  );

  app.openapi(
    {
      ...duplicateUploadRoute,
      middleware: chokepointMiddleware(chokepoint, duplicateUploadRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const request = c.req.valid("json");
      const { bucket } = resolveFirmBucket(c.env, firm.bucketName);
      const now = () => new Date().toISOString();
      let result;
      try {
        result = await runIdempotentEffect({
          database: firm.firmDatabase,
          key: idempotency.key,
          fingerprint: idempotency.fingerprint,
          effect: async () => {
            // The bucket copy runs inside the effect and before its batch: a replayed key never
            // reaches here, and a copy that fails leaves no row pointing at a missing object.
            const duplicated = await duplicateVersionIntoMatter(
              firm.firmDatabase,
              {
                sourceVersionId: request.sourceVersionId,
                matterId: request.matterId,
                folderId: request.folderId ?? null,
                name: request.name,
                documentTypeId: request.documentTypeId ?? null,
                uploadedBy: userId,
                sourceModifiedAt: request.sourceModifiedAt ?? null,
                ...(request.createdAtBasis === undefined
                  ? {}
                  : { createdAtBasis: request.createdAtBasis }),
              },
              { clock: { now }, actorUserId: userId },
              (fromKey, toKey, dimensions) =>
                copyObjectIntoMatter(bucket, fromKey, toKey, dimensions),
            );
            return {
              write: duplicated.effect,
              responseCode: 201,
              responseBody: canonicalJsonStringify({
                fileId: duplicated.fileId,
                versionId: duplicated.versionId,
              }),
            };
          },
        });
      } catch (caught) {
        if (
          caught instanceof FileManagerValidationError &&
          (caught.code === "version-not-clean" ||
            caught.code === "unknown-file" ||
            caught.code === "file-deleted" ||
            caught.code === "unknown-folder" ||
            caught.code === "file-cross-matter")
        ) {
          return problemJson(c, {
            type: "not-found",
            title: "Not found",
            status: 404,
            detail: "No such resource in this firm.",
          });
        }
        throw caught;
      }
      if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch") {
        return problemResponseForIdempotencyConflict(c, result);
      }
      if (result.kind === "replayed") c.header("Idempotency-Replayed", "true");
      return c.json(
        JSON.parse(storedResponseBody(result)) as z.infer<typeof DuplicateUploadResponse>,
        201,
      );
    },
  );

  app.openapi(
    { ...getUploadRoute, middleware: chokepointMiddleware(chokepoint, getUploadRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { id } = c.req.valid("param");
      const status = await getUploadSessionStatus(firm.firmDatabase, id);
      if (status === undefined) {
        return problemJson(c, {
          type: "not-found",
          title: "Not found",
          status: 404,
          detail: "No such upload session in this firm.",
        });
      }
      return c.json(
        {
          sessionStatus: status.sessionStatus,
          versionStatus: status.versionStatus,
          quarantineReason: status.quarantineReason,
        } as z.infer<typeof UploadStatusResponse>,
        200,
      );
    },
  );

  app.openapi(
    {
      ...signUploadPartRoute,
      middleware: chokepointMiddleware(chokepoint, signUploadPartRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const bucket = resolveFirmBucket(c.env, firm.bucketName).bucketName;
      const { id, partNumber } = c.req.valid("param");
      const session = await loadUploadSession(firm.firmDatabase, id);
      if (session === undefined) {
        return problemJson(c, {
          type: "not-found",
          title: "Not found",
          status: 404,
          detail: "No such upload session in this firm.",
        });
      }
      if (
        session.status !== "open" ||
        session.mode !== "multipart" ||
        session.r2UploadId === null
      ) {
        return problemJson(c, {
          type: "conflict",
          title: "Upload session not signable",
          status: 409,
          detail: "The upload session is not an open multipart session.",
        });
      }
      const presigner = presignerForEnv(c.env);
      const url = await presigner.presignUploadPart(
        bucket,
        session.r2Key,
        session.r2UploadId,
        Number(partNumber),
        PRESIGN_TTL_SECONDS,
      );
      return c.json({ url }, 200);
    },
  );

  app.openapi(
    {
      ...completeUploadRoute,
      middleware: chokepointMiddleware(chokepoint, completeUploadRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const bucket = resolveFirmBucket(c.env, firm.bucketName).bucketName;
      const { id } = c.req.valid("param");
      const request = c.req.valid("json");
      const session = await loadUploadSession(firm.firmDatabase, id);
      if (session === undefined) {
        return problemJson(c, {
          type: "not-found",
          title: "Not found",
          status: 404,
          detail: "No such upload session in this firm.",
        });
      }
      if (session.status !== "open") {
        return problemJson(c, {
          type: "conflict",
          title: "Upload session not open",
          status: 409,
          detail: `The upload session is ${session.status}, not open.`,
        });
      }
      const presigner = presignerForEnv(c.env);
      if (session.mode === "multipart") {
        const parts = request?.parts;
        if (parts === undefined || parts.length === 0) {
          return problemJson(c, {
            type: "conflict",
            title: "Multipart completion requires parts",
            status: 409,
            detail: "Completing a multipart upload requires the part manifest.",
          });
        }
        if (session.r2UploadId === null) {
          throw new Error(
            "open multipart session has no R2 upload id — initiate did not record it",
          );
        }
        await presigner.completeMultipartUpload(bucket, session.r2Key, session.r2UploadId, parts);
      }
      const now = () => new Date().toISOString();
      const completed = await completeUploadSession(firm.firmDatabase, id, {
        clock: { now },
        actorUserId: userId,
      });
      await commitEffectBatch(firm.firmDatabase, completed.effect, { now });
      return c.json({ key: session.r2Key, location: session.r2Key }, 200);
    },
  );

  app.openapi(
    {
      ...abortUploadRoute,
      middleware: chokepointMiddleware(chokepoint, abortUploadRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const bucket = resolveFirmBucket(c.env, firm.bucketName).bucketName;
      const { id } = c.req.valid("param");
      const session = await loadUploadSession(firm.firmDatabase, id);
      if (session === undefined) {
        return problemJson(c, {
          type: "not-found",
          title: "Not found",
          status: 404,
          detail: "No such upload session in this firm.",
        });
      }
      if (session.status !== "open") {
        return problemJson(c, {
          type: "conflict",
          title: "Upload session not open",
          status: 409,
          detail: `The upload session is ${session.status}, not open.`,
        });
      }
      const now = () => new Date().toISOString();
      const aborted = await abortUploadSession(firm.firmDatabase, id, {
        clock: { now },
        actorUserId: userId,
      });
      // Abort the multipart upload at R2 first (idempotent; a 404 there is success), then commit the
      // status flip — a thrown R2 abort leaves the session open and the operation retryable.
      if (aborted.mode === "multipart" && aborted.r2UploadId !== null) {
        const presigner = presignerForEnv(c.env);
        await presigner.abortMultipartUpload(bucket, aborted.r2Key, aborted.r2UploadId);
      }
      await commitEffectBatch(firm.firmDatabase, aborted.effect, { now });
      return c.json({ status: "aborted" as const }, 200);
    },
  );
}
