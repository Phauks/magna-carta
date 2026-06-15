import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import { readFirmSetting } from "@magna-carta/data-access/setting-statements";
import { setUploadSessionR2UploadIdStatement } from "@magna-carta/file-manager/file-statements";
import {
  abortUploadSession,
  completeUploadSession,
  initiateUpload,
  loadUploadSession,
} from "@magna-carta/file-manager/file-service";
import { modeThresholdDefinition } from "@magna-carta/file-manager/upload-policy";
import { FileManagerValidationError } from "@magna-carta/file-manager/validation";
import type { UploadSessionId } from "@magna-carta/identifiers/types";
import type { Bindings } from "../app.ts";
import type { Chokepoint } from "../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointUserId,
} from "../chokepoint/context-accessors.ts";
import type { AppVariables } from "../chokepoint/ports.ts";
import { chokepointMiddleware } from "../chokepoint/register.ts";
import { idempotencyKeyHeader, identifierField, identifierPathParam } from "../contracts/common.ts";
import { Problem, problemJson } from "../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../contracts/route-meta.ts";
import { presignerForEnv } from "../files/presigner-wiring.ts";
import {
  problemResponseForIdempotencyConflict,
  storedResponseBody,
} from "../idempotency-conflict-problems.ts";

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

const uploadSessionParam = z.object({ id: identifierPathParam("uploadSession", "id") });

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

type UploadsApp = OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>;

function requireBucket(bucketName: string | null): string {
  if (bucketName === null) {
    // An active session firm always has a provisioned bucket; null is a broken provisioning
    // invariant — fail loud (→ 500) rather than presign against a missing bucket.
    throw new Error("session firm has no R2 bucket — provisioning is incomplete");
  }
  return bucketName;
}

export function registerUploadsRoutes(app: UploadsApp, chokepoint: Chokepoint): void {
  app.openapi(
    {
      ...initiateUploadRoute,
      middleware: chokepointMiddleware(chokepoint, initiateUploadMeta, initiateUploadRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const bucket = requireBucket(firm.bucketName);
      const idempotency = c.get("idempotency");
      if (idempotency === undefined) {
        throw new Error(
          "idempotency context missing — the chokepoint idempotency gate did not run on a required-idempotency route",
        );
      }
      const request = c.req.valid("json");
      const presigner = presignerForEnv(c.env);
      const now = () => new Date().toISOString();
      const threshold = await readFirmSetting(firm.firmDatabase, modeThresholdDefinition);
      const declaredSize = request.declaredSize;
      const mode: "put" | "multipart" =
        declaredSize !== null && declaredSize > threshold ? "multipart" : "put";
      const contentType = request.declaredContentType ?? "application/octet-stream";

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
              },
              { clock: { now }, actorUserId: userId },
            );
            const statements = [...initiated.effect.statements];
            let responseBody: Record<string, unknown>;
            if (mode === "put") {
              const url = await presigner.presignPut(
                bucket,
                initiated.r2Key,
                contentType,
                PRESIGN_TTL_SECONDS,
              );
              responseBody = {
                mode: "put",
                uploadId: initiated.uploadSessionId,
                fileId: initiated.fileId,
                versionId: initiated.versionId,
                key: initiated.r2Key,
                method: "PUT",
                url,
                headers: { "Content-Type": contentType },
              };
            } else {
              const created = await presigner.createMultipartUpload(
                bucket,
                initiated.r2Key,
                contentType,
              );
              statements.push(
                setUploadSessionR2UploadIdStatement(
                  firm.firmDatabase,
                  initiated.uploadSessionId as UploadSessionId,
                  created.uploadId,
                ),
              );
              responseBody = {
                mode: "multipart",
                uploadId: initiated.uploadSessionId,
                fileId: initiated.fileId,
                versionId: initiated.versionId,
                key: initiated.r2Key,
              };
            }
            return {
              write: {
                statements,
                outboxMessages: initiated.effect.outboxMessages,
              },
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
          if (caught.code === "unknown-file" || caught.code === "unknown-folder") {
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
      if (result.kind === "replayed") c.header("Idempotency-Replayed", "true");
      const responseBody = JSON.parse(storedResponseBody(result)) as z.infer<
        typeof InitiateUploadResponse
      >;
      return c.json(responseBody, 201);
    },
  );

  app.openapi(
    {
      ...signUploadPartRoute,
      middleware: chokepointMiddleware(chokepoint, signUploadPartMeta, signUploadPartRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const bucket = requireBucket(firm.bucketName);
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
      middleware: chokepointMiddleware(chokepoint, completeUploadMeta, completeUploadRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const bucket = requireBucket(firm.bucketName);
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
      middleware: chokepointMiddleware(chokepoint, abortUploadMeta, abortUploadRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const bucket = requireBucket(firm.bucketName);
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
