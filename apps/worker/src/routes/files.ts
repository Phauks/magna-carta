import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import { insertAuditLogStatement } from "@magna-carta/data-access/audit-statements";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import {
  assignDocumentType,
  moveFile,
  renameFile,
  softDeleteFile,
} from "@magna-carta/file-manager/file-service";
import { selectFileStatement } from "@magna-carta/file-manager/file-statements";
import {
  getCurrentCleanVersion,
  getCurrentCleanVersionForPreview,
  listCleanVersions,
  listFiles,
} from "@magna-carta/file-manager/queries";
import { decidePreview } from "@magna-carta/file-manager/preview-policy";
import { documentSessionStub } from "../editing/document-session.ts";
import { mintPreviewDeliveryToken } from "../files/preview-token.ts";
import { FileManagerValidationError } from "@magna-carta/file-manager/validation";
import type { FileId, FileVersionId, FolderId, MatterId } from "@magna-carta/identifiers/types";
import type { OutboxMessage } from "@magna-carta/data-access/outbox-statements";
import type { SqlStatement } from "@magna-carta/data-access/idempotency-statements";
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
import { presignerForEnv } from "../files/presigner-wiring.ts";
import { requireBucket } from "../files/require-bucket.ts";
import {
  problemResponseForIdempotencyConflict,
  storedResponseBody,
} from "../idempotency-conflict-problems.ts";

// File metadata + download. List/get are open to any authenticated firm member (reads, permission
// null); rename/move/document-type ride files:organize, soft-delete rides files:delete. Every read
// serves only clean, non-deleted content (the file-manager queries enforce the status gate).
// /download resolves the current clean version and 302s to a short-TTL presigned GET — the bytes flow
// client↔R2, never through the Worker — and writes an audit_log export row.

const FILES_ORGANIZE = "files:organize" as const;
const FILES_DELETE = "files:delete" as const;
// A short life for a download credential — long enough to start the GET, short enough that a leaked
// URL expires quickly.
const DOWNLOAD_TTL_SECONDS = 300;

const FileSummary = z
  .object({
    id: z.string(),
    matterId: z.string(),
    folderId: z.string().nullable(),
    name: z.string(),
    documentTypeId: z.string().nullable(),
    currentVersionId: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi("FileSummary");

const FileListResponse = z
  .object({ data: z.array(FileSummary), nextCursor: z.string().nullable() })
  .openapi("FileListResponse");

const FileVersionItem = z
  .object({
    id: z.string(),
    versionNumber: z.number().int(),
    sizeBytes: z.number().int().nullable(),
    sniffedContentType: z.string().nullable(),
    contentSha256: z.string().nullable(),
    committedAt: z.string().nullable(),
  })
  .openapi("FileVersionItem");

const FileVersionsResponse = z
  .object({ data: z.array(FileVersionItem) })
  .openapi("FileVersionsResponse");

const PreviewGrant = z
  .object({
    mode: z.enum(["inline-media", "download-only"]),
    // The stored verdict, READ not computed (the sniffer is deferred). NULL = never sniffed; at
    // launch the whole corpus is NULL so every grant is download-only / unknown-verdict.
    verdict: z.enum(["playable", "download-only", "indeterminate"]).nullable(),
    // Present iff mode === "inline-media": the cookieless files-host URL the player loads as a
    // <video>/<audio> subresource. The transcode rendition wires in here when the player UI lands.
    streamUrl: z.string().optional(),
    contentType: z.string().optional(), // the SNIFFED type, echoed for the player
    sizeBytes: z.number().int().nullable().optional(),
    // Present iff mode === "download-only". "host-unavailable" = the files host is not yet bound
    // (the verdict may have been playable); distinct from "unknown-verdict" (never-sniffed).
    reason: z
      .enum([
        "verdict",
        "unknown-verdict",
        "tiered",
        "encoded",
        "derived",
        "unknown-type",
        "host-unavailable",
      ])
      .optional(),
    // ALWAYS present, download-intent only — the AUDITED /download path (302), never a raw inline URL,
    // so an active format can only ever reach an explicit download, never an auto-embedding context.
    downloadUrl: z.string(),
  })
  .openapi("PreviewGrant");

const PatchFileRequest = z
  .object({
    name: z.string().min(1).optional(),
    // Present (incl. explicit null = the matter root) = a move.
    folderId: identifierField("folder").nullable().optional(),
    // Present (incl. explicit null = clear) = a document-type assignment.
    documentTypeId: identifierField("documentType").nullable().optional(),
  })
  .openapi("PatchFileRequest");

const FileActionAck = z.object({ fileId: z.string() }).openapi("FileActionAck");

const fileParam = z.object({ id: identifierPathParam("file", "id") });

const authErrors = {
  401: {
    description: "No valid session",
    content: { "application/problem+json": { schema: Problem } },
  },
  403: {
    description: "The session member lacks the required permission",
    content: { "application/problem+json": { schema: Problem } },
  },
  404: {
    description: "The firm is unreachable, the member is deactivated, or the file is unknown",
    content: { "application/problem+json": { schema: Problem } },
  },
  429: {
    description: "Rate limit exceeded",
    content: { "application/problem+json": { schema: Problem } },
  },
} as const;

const idempotencyErrors = {
  400: {
    description: "Missing Idempotency-Key (this operation requires one)",
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
} as const;

const listFilesMeta: RouteMeta = {
  operationId: "files.list",
  surface: "app",
  authenticated: true,
  permission: null,
  resource: "matter",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

const getFileMeta: RouteMeta = {
  operationId: "files.get",
  surface: "app",
  authenticated: true,
  permission: null,
  resource: "matter",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

const listFileVersionsMeta: RouteMeta = {
  operationId: "files.versions",
  surface: "app",
  authenticated: true,
  permission: null,
  resource: "matter",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

const patchFileMeta: RouteMeta = {
  operationId: "files.update",
  surface: "app",
  authenticated: true,
  permission: FILES_ORGANIZE,
  resource: "matter",
  audited: true,
  idempotency: "required",
  idempotencyStore: "firm",
  rateLimit: "default",
};

const deleteFileMeta: RouteMeta = {
  operationId: "files.delete",
  surface: "app",
  authenticated: true,
  permission: FILES_DELETE,
  resource: "matter",
  audited: true,
  idempotency: "required",
  idempotencyStore: "firm",
  rateLimit: "default",
};

// The download is a GET that exports bytes. A GET cannot carry an Idempotency-Key (it has no body to
// fingerprint and re-issuing it is harmless), so idempotency is "optional"; it is still audited
// because an export is a privileged read the audit trail must record (the upload signPart GET is not
// audited — it mints a credential but exports nothing).
const downloadFileMeta: RouteMeta = {
  operationId: "files.download",
  surface: "app",
  authenticated: true,
  permission: null,
  resource: "matter",
  audited: true,
  idempotency: "optional",
  rateLimit: "default",
};

// The preview grant is a GET that exports a delivery DECISION (and, for inline media, a signed
// delivery credential) — no body to fingerprint, harmless to re-issue, so idempotency is "optional".
// permission: null is the files.list/get/download read posture — the registry deliberately has no
// read-only files capability; access is gated by which matter the member can reach, enforced by the
// firm-scoped query against the session firm's physically-isolated D1. audited: false because inline
// preview is a cheap, high-frequency in-place view (no per-view logging); the moment the user pulls
// the full file, the audited /download path records it. Reasoning home: docs/conventions/security.md.
const previewFileMeta: RouteMeta = {
  operationId: "files.preview",
  surface: "app",
  authenticated: true,
  permission: null,
  resource: "matter",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

const listFilesRoute = defineOpenAPIRoute(listFilesMeta, {
  method: "get",
  path: "/api/v1/files",
  description:
    "Lists a matter's files (optionally a single folder), clean and undeleted only, cursor-paginated. " +
    "A file appears once it has a committed clean version; pending, quarantined, and soft-deleted " +
    "files are excluded.",
  request: {
    query: z.object({
      matterId: identifierField("matter"),
      folderId: identifierField("folder").optional(),
      cursor: z.string().optional(),
      pageSize: z.coerce.number().int().positive().max(200).optional(),
    }),
  },
  responses: {
    200: {
      description: "A page of files",
      content: { "application/json": { schema: FileListResponse } },
    },
    401: authErrors[401],
    404: authErrors[404],
    429: authErrors[429],
  },
});

const getFileRoute = defineOpenAPIRoute(getFileMeta, {
  method: "get",
  path: "/api/v1/files/{id}",
  description:
    "Returns one file's metadata. A pending-only, quarantined, or soft-deleted file is 404.",
  request: { params: fileParam },
  responses: {
    200: { description: "The file", content: { "application/json": { schema: FileSummary } } },
    401: authErrors[401],
    404: authErrors[404],
    429: authErrors[429],
  },
});

const listFileVersionsRoute = defineOpenAPIRoute(listFileVersionsMeta, {
  method: "get",
  path: "/api/v1/files/{id}/versions",
  description: "Lists a file's committed (clean) version history, newest first.",
  request: { params: fileParam },
  responses: {
    200: {
      description: "The file's clean version history",
      content: { "application/json": { schema: FileVersionsResponse } },
    },
    401: authErrors[401],
    404: authErrors[404],
    429: authErrors[429],
  },
});

const patchFileRoute = defineOpenAPIRoute(patchFileMeta, {
  method: "patch",
  path: "/api/v1/files/{id}",
  description:
    "Renames a file, moves it to another folder (or the matter root), and/or assigns a document " +
    "type. Metadata only — the file's bytes and versions are untouched.",
  request: {
    headers: idempotencyKeyHeader,
    params: fileParam,
    body: { content: { "application/json": { schema: PatchFileRequest } }, required: true },
  },
  responses: {
    200: {
      description: "The file was updated",
      content: { "application/json": { schema: FileActionAck } },
    },
    400: idempotencyErrors[400],
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    409: idempotencyErrors[409],
    422: idempotencyErrors[422],
    429: authErrors[429],
  },
});

const deleteFileRoute = defineOpenAPIRoute(deleteFileMeta, {
  method: "delete",
  path: "/api/v1/files/{id}",
  description:
    "Soft-deletes a file: it leaves the default listing and download but its rows and bytes are " +
    "retained for the recovery window.",
  request: { headers: idempotencyKeyHeader, params: fileParam },
  responses: {
    200: {
      description: "The file was soft-deleted",
      content: { "application/json": { schema: FileActionAck } },
    },
    400: idempotencyErrors[400],
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    409: idempotencyErrors[409],
    422: idempotencyErrors[422],
    429: authErrors[429],
  },
});

const downloadFileRoute = defineOpenAPIRoute(downloadFileMeta, {
  method: "get",
  path: "/api/v1/files/{id}/download",
  description:
    "Resolves the file's current clean version and redirects (302) to a short-TTL presigned GET URL " +
    "the client downloads the bytes directly from. 404 when the file has no clean current version.",
  request: { params: fileParam },
  responses: {
    302: { description: "Redirect to the presigned download URL" },
    401: authErrors[401],
    404: authErrors[404],
    429: authErrors[429],
  },
});

const previewFileRoute = defineOpenAPIRoute(previewFileMeta, {
  method: "get",
  path: "/api/v1/files/{id}/preview",
  description:
    "Authorizes inline preview of the file's current clean version and returns a delivery " +
    "descriptor. When the verdict + storage facts permit inline media, the descriptor carries a " +
    "short-lived signed streamUrl on the cookieless files host the player loads as a <video>/<audio> " +
    "subresource; otherwise it carries download-only with a reason. downloadUrl (the audited " +
    "download path) is always present. Untrusted bytes are served cookieless so a malicious file " +
    "reaches only the media decoder, never a privileged origin. 404 when the file has no clean " +
    "current version.",
  request: { params: fileParam },
  responses: {
    200: {
      description: "The preview delivery descriptor",
      content: { "application/json": { schema: PreviewGrant } },
    },
    401: authErrors[401],
    404: authErrors[404],
    429: authErrors[429],
  },
});

type FilesApp = OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>;

function fileErrorResponse(c: Context, error: FileManagerValidationError): ProblemResponse<404> {
  if (
    error.code === "unknown-file" ||
    error.code === "unknown-folder" ||
    // A move whose target folder lives in another matter targets a resource not in this matter —
    // surfaced as not-found, never a 500.
    error.code === "file-cross-matter"
  ) {
    return problemJson(c, {
      type: "not-found",
      title: "Not found",
      status: 404,
      detail: "No such file in this firm.",
    });
  }
  throw error;
}

// The visible file (clean current version, not soft-deleted) by id — the get/versions/download reads
// all start here so a pending-only, quarantined, or deleted file is uniformly 404.
async function loadVisibleFile(
  database: Parameters<typeof selectFileStatement>[0],
  id: FileId,
): Promise<
  | {
      id: FileId;
      matterId: MatterId;
      folderId: FolderId | null;
      name: string;
      documentTypeId: string | null;
      currentVersionId: FileVersionId | null;
      deletedAt: string | null;
      createdAt: string;
    }
  | undefined
> {
  const { results } = await selectFileStatement(database, id).all<{
    id: FileId;
    matter_id: MatterId;
    folder_id: FolderId | null;
    name: string;
    document_type_id: string | null;
    current_version_id: FileVersionId | null;
    deleted_at: string | null;
    created_at: string;
  }>();
  const row = results[0];
  if (row === undefined || row.deleted_at !== null || row.current_version_id === null) {
    return undefined;
  }
  return {
    id: row.id,
    matterId: row.matter_id,
    folderId: row.folder_id,
    name: row.name,
    documentTypeId: row.document_type_id,
    currentVersionId: row.current_version_id,
    deletedAt: row.deleted_at,
    createdAt: row.created_at,
  };
}

export function registerFilesRoutes(app: FilesApp, chokepoint: Chokepoint): void {
  // GET /api/v1/files — list
  app.openapi(
    {
      ...listFilesRoute,
      middleware: chokepointMiddleware(chokepoint, listFilesRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const query = c.req.valid("query");
      const page = await listFiles(firm.firmDatabase, {
        matterId: query.matterId,
        folderId: query.folderId,
        cursor: query.cursor,
        pageSize: query.pageSize,
      });
      return c.json(
        {
          data: page.data.map((file) => ({
            id: file.id,
            matterId: file.matterId,
            folderId: file.folderId,
            name: file.name,
            documentTypeId: file.documentTypeId,
            currentVersionId: file.currentVersionId,
            createdAt: file.createdAt,
          })),
          nextCursor: page.nextCursor,
        } as z.infer<typeof FileListResponse>,
        200,
      );
    },
  );

  // GET /api/v1/files/{id} — detail
  app.openapi(
    { ...getFileRoute, middleware: chokepointMiddleware(chokepoint, getFileRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { id } = c.req.valid("param");
      const file = await loadVisibleFile(firm.firmDatabase, id);
      if (file === undefined) {
        return problemJson(c, {
          type: "not-found",
          title: "Not found",
          status: 404,
          detail: "No such file in this firm.",
        });
      }
      return c.json(
        {
          id: file.id,
          matterId: file.matterId,
          folderId: file.folderId,
          name: file.name,
          documentTypeId: file.documentTypeId,
          currentVersionId: file.currentVersionId,
          createdAt: file.createdAt,
        } as z.infer<typeof FileSummary>,
        200,
      );
    },
  );

  // GET /api/v1/files/{id}/versions — clean version history
  app.openapi(
    {
      ...listFileVersionsRoute,
      middleware: chokepointMiddleware(chokepoint, listFileVersionsRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { id } = c.req.valid("param");
      const file = await loadVisibleFile(firm.firmDatabase, id);
      if (file === undefined) {
        return problemJson(c, {
          type: "not-found",
          title: "Not found",
          status: 404,
          detail: "No such file in this firm.",
        });
      }
      const versions = await listCleanVersions(firm.firmDatabase, id);
      return c.json(
        {
          data: versions.map((version) => ({
            id: version.id,
            versionNumber: version.versionNumber,
            sizeBytes: version.sizeBytes,
            sniffedContentType: version.sniffedContentType,
            contentSha256: version.contentSha256,
            committedAt: version.committedAt,
          })),
        } as z.infer<typeof FileVersionsResponse>,
        200,
      );
    },
  );

  // PATCH /api/v1/files/{id} — rename / move / assign document type
  app.openapi(
    {
      ...patchFileRoute,
      middleware: chokepointMiddleware(chokepoint, patchFileRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { id } = c.req.valid("param");
      const patch = c.req.valid("json");
      const now = () => new Date().toISOString();
      try {
        const result = await runIdempotentEffect({
          database: firm.firmDatabase,
          key: idempotency.key,
          fingerprint: idempotency.fingerprint,
          effect: async () => {
            const statements: SqlStatement[] = [];
            const outboxMessages: OutboxMessage[] = [];
            if (patch.name !== undefined) {
              const renamed = await renameFile(firm.firmDatabase, id, patch.name, {
                clock: { now },
                actorUserId: userId,
              });
              statements.push(...renamed.effect.statements);
              outboxMessages.push(...renamed.effect.outboxMessages);
            }
            if (patch.folderId !== undefined) {
              const moved = await moveFile(firm.firmDatabase, id, patch.folderId, {
                clock: { now },
                actorUserId: userId,
              });
              statements.push(...moved.effect.statements);
              outboxMessages.push(...moved.effect.outboxMessages);
            }
            if (patch.documentTypeId !== undefined) {
              const assigned = await assignDocumentType(
                firm.firmDatabase,
                id,
                patch.documentTypeId,
                {
                  clock: { now },
                  actorUserId: userId,
                },
              );
              statements.push(...assigned.effect.statements);
              outboxMessages.push(...assigned.effect.outboxMessages);
            }
            return {
              write: { statements, outboxMessages },
              responseCode: 200,
              responseBody: canonicalJsonStringify({ fileId: id }),
            };
          },
        });
        if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch") {
          return problemResponseForIdempotencyConflict(c, result);
        }
        if (result.kind === "replayed") c.header("Idempotency-Replayed", "true");
        const body = JSON.parse(storedResponseBody(result)) as z.infer<typeof FileActionAck>;
        return c.json(body, 200);
      } catch (caught) {
        if (caught instanceof FileManagerValidationError) return fileErrorResponse(c, caught);
        throw caught;
      }
    },
  );

  // DELETE /api/v1/files/{id} — soft delete
  app.openapi(
    {
      ...deleteFileRoute,
      middleware: chokepointMiddleware(chokepoint, deleteFileRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { id } = c.req.valid("param");
      const now = () => new Date().toISOString();
      // Reap any live editing session first so the file is not deleted out from under live editors with
      // a stranded session/lock. Idempotent — force-closing an already-idle session is a no-op.
      await documentSessionStub(c.env, id).forceClose();
      // Captured inside the effect so the working-copy object is destroyed only after the soft-delete
      // batch commits (and only by the winner of the idempotency race).
      let currentR2KeyToDestroy: string | null = null;
      try {
        const result = await runIdempotentEffect({
          database: firm.firmDatabase,
          key: idempotency.key,
          fingerprint: idempotency.fingerprint,
          effect: async () => {
            const deleted = await softDeleteFile(firm.firmDatabase, id, {
              clock: { now },
              actorUserId: userId,
            });
            currentR2KeyToDestroy = deleted.currentR2Key;
            return {
              write: deleted.effect,
              responseCode: 200,
              responseBody: canonicalJsonStringify({ fileId: id }),
            };
          },
        });
        if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch") {
          return problemResponseForIdempotencyConflict(c, result);
        }
        // Destroy the live working copy only on the winning execution (a replay's batch rolled back and
        // the winner already handled it); the committed versions and their bytes are retained.
        if (result.kind === "executed" && currentR2KeyToDestroy !== null) {
          await c.env.R2.delete(currentR2KeyToDestroy);
        }
        if (result.kind === "replayed") c.header("Idempotency-Replayed", "true");
        const body = JSON.parse(storedResponseBody(result)) as z.infer<typeof FileActionAck>;
        return c.json(body, 200);
      } catch (caught) {
        if (caught instanceof FileManagerValidationError) return fileErrorResponse(c, caught);
        throw caught;
      }
    },
  );

  // GET /api/v1/files/{id}/download — 302 to a presigned GET of the current clean version
  app.openapi(
    {
      ...downloadFileRoute,
      middleware: chokepointMiddleware(chokepoint, downloadFileRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const bucket = requireBucket(firm.bucketName);
      const { id } = c.req.valid("param");
      const version = await getCurrentCleanVersion(firm.firmDatabase, id);
      if (version === undefined) {
        return problemJson(c, {
          type: "not-found",
          title: "Not found",
          status: 404,
          detail: "No such file with a downloadable version in this firm.",
        });
      }
      const presigner = presignerForEnv(c.env);
      const url = await presigner.presignGet(bucket, version.r2Key, DOWNLOAD_TTL_SECONDS);
      // The export is recorded before the redirect — metadata names the version exported, no content.
      const now = new Date().toISOString();
      await commitEffectBatch(
        firm.firmDatabase,
        {
          statements: [
            insertAuditLogStatement(firm.firmDatabase, {
              id: newIdentifier("auditLog"),
              event: "file.downloaded",
              actorUserId: userId,
              subjectId: version.id,
              metadata: { fileId: id, versionId: version.id },
              now,
            }),
          ],
          outboxMessages: [],
        },
        { now: () => now },
      );
      return c.redirect(url, 302);
    },
  );

  // GET /api/v1/files/{id}/preview — authorize inline preview; mint a signed cookieless streamUrl
  app.openapi(
    {
      ...previewFileRoute,
      middleware: chokepointMiddleware(chokepoint, previewFileRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const bucket = requireBucket(firm.bucketName);
      const { id } = c.req.valid("param");
      const version = await getCurrentCleanVersionForPreview(firm.firmDatabase, id);
      if (version === undefined) {
        return problemJson(c, {
          type: "not-found",
          title: "Not found",
          status: 404,
          detail: "No such file with a previewable version in this firm.",
        });
      }
      const downloadUrl = `/api/v1/files/${id}/download`;
      const decision = decidePreview(version);
      const filesOrigin = c.env.FILES_ORIGIN;

      // Degrade to download-only when inline is not warranted OR the files host is not yet bound. The
      // reason distinguishes the two: a real decidePreview reason when the gate refused, else
      // "host-unavailable" when the gate WOULD have served inline but the cookieless host is unbound.
      if (decision.kind === "download-only" || filesOrigin === undefined) {
        const grant: z.infer<typeof PreviewGrant> = {
          mode: "download-only",
          verdict: version.inlinePlayable,
          reason: decision.kind === "download-only" ? decision.reason : "host-unavailable",
          downloadUrl,
        };
        return c.json(grant, 200, { "Cache-Control": "private, no-store" });
      }

      const exp = Math.floor(Date.now() / 1000) + DOWNLOAD_TTL_SECONDS;
      const token = await mintPreviewDeliveryToken(c.env.AUTH_SECRET, {
        r2Key: decision.r2Key,
        bucket,
        sniffedContentType: decision.sniffedContentType,
        verdict: version.inlinePlayable,
        exp,
      });
      const grant: z.infer<typeof PreviewGrant> = {
        mode: "inline-media",
        verdict: version.inlinePlayable,
        streamUrl: `https://${filesOrigin}/api/files-preview/${token}`,
        contentType: decision.sniffedContentType,
        sizeBytes: decision.sizeBytes,
        downloadUrl,
      };
      return c.json(grant, 200, { "Cache-Control": "private, no-store" });
    },
  );
}
