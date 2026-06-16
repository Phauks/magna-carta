import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { insertAuditLogStatement } from "@magna-carta/data-access/audit-statements";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import {
  listCleanCurrentVersionsByMatter,
  listFoldersByMatter,
} from "@magna-carta/file-manager/queries";
import { zipAsyncThresholdDefinition } from "@magna-carta/file-manager/upload-policy";
import { readFirmSetting } from "@magna-carta/data-access/setting-statements";
import { resolveZipSelection, type ZipEntry } from "@magna-carta/file-manager/zip-composition";
import type { FileId, FolderId, MatterId } from "@magna-carta/identifiers/types";
import { makeZip } from "client-zip";
import type { Bindings } from "../app.ts";
import type { Chokepoint } from "../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointUserId,
} from "../chokepoint/context-accessors.ts";
import type { AppVariables } from "../chokepoint/ports.ts";
import { chokepointMiddleware } from "../chokepoint/register.ts";
import { identifierField } from "../contracts/common.ts";
import { Problem, problemJson } from "../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../contracts/route-meta.ts";
import { presignerForEnv } from "../files/presigner-wiring.ts";
import { requireBucket } from "../files/require-bucket.ts";

// Bulk download. A {matterId, folderIds?, fileIds?} selection resolves to the matter's clean CURRENT
// versions at request time (version-pinned: a later upload never changes what this archive holds). A
// single resolved file 302s to a presigned GET, like the per-file download; multiple files stream a
// store-mode ZIP64 of their R2 object bodies, entry paths composed from the folder tree. The bytes of
// each object flow R2 -> Worker -> client as a stream (no buffering), and an audit_log export row is
// written with counts only — never content.

const DOWNLOAD_TTL_SECONDS = 300;

const ZipRequest = z
  .object({
    matterId: identifierField("matter"),
    folderIds: z.array(identifierField("folder")).optional(),
    fileIds: z.array(identifierField("file")).optional(),
  })
  .openapi("ZipDownloadRequest");

// A POST mandates a non-null permission (defineOpenAPIRoute guards an authenticated mutating route
// against permission: null — the chokepoint would read null as "any authenticated user"). A bulk
// download is a read of file content, but the registry carries no read-only files capability, so it
// rides files:organize — the baseline "work with this matter's files" capability. It is audited
// because an export is a privileged read the trail must record.
const zipDownloadMeta: RouteMeta = {
  operationId: "downloads.zip",
  surface: "app",
  authenticated: true,
  permission: "files:organize",
  resource: "matter",
  audited: true,
  idempotency: "optional",
  rateLimit: "default",
};

const zipDownloadRoute = defineOpenAPIRoute(zipDownloadMeta, {
  method: "post",
  path: "/api/v1/downloads/zip",
  description:
    "Resolves a selection of folders and/or files within a matter to their current clean versions " +
    "at request time, then streams a ZIP of those bytes (entry paths follow the folder tree). A " +
    "selection that resolves to a single file redirects (302) to a presigned download instead. An " +
    "empty selection (matter only) bundles the whole matter.",
  request: {
    body: { content: { "application/json": { schema: ZipRequest } }, required: true },
  },
  responses: {
    200: {
      description: "A streamed ZIP archive of the selected files",
      content: { "application/zip": { schema: z.string().openapi({ format: "binary" }) } },
    },
    302: { description: "A single-file selection redirects to a presigned download URL" },
    401: {
      description: "No valid session",
      content: { "application/problem+json": { schema: Problem } },
    },
    403: {
      description: "The session member lacks files:organize",
      content: { "application/problem+json": { schema: Problem } },
    },
    404: {
      description: "The firm is unreachable, the member is deactivated, or the selection is empty",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

type DownloadsApp = OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>;

// An archive filename safe for a Content-Disposition header: any non-filename character collapses to
// a dash, so a matter id never breaks the header.
function archiveFileName(matterId: MatterId): string {
  const safe = matterId.replace(/[^A-Za-z0-9._-]/g, "-");
  return `${safe}.zip`;
}

export function registerDownloadsRoutes(app: DownloadsApp, chokepoint: Chokepoint): void {
  app.openapi(
    {
      ...zipDownloadRoute,
      middleware: chokepointMiddleware(chokepoint, zipDownloadRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const bucket = requireBucket(firm.bucketName);
      const request = c.req.valid("json");
      const matterId: MatterId = request.matterId;

      // Resolve the selection to version-pinned clean entries (the status-gated reads in queries.ts).
      const [folders, cleanFiles] = await Promise.all([
        listFoldersByMatter(firm.firmDatabase, matterId),
        listCleanCurrentVersionsByMatter(firm.firmDatabase, matterId),
      ]);
      const resolved = resolveZipSelection(
        {
          folderIds: request.folderIds as readonly FolderId[] | undefined,
          fileIds: request.fileIds as readonly FileId[] | undefined,
        },
        folders,
        cleanFiles,
      );

      if (resolved.entries.length === 0) {
        return problemJson(c, {
          type: "not-found",
          title: "Nothing to download",
          status: 404,
          detail: "The selection resolved to no downloadable files.",
        });
      }

      // The async-job threshold is read and recorded so the audit trail captures the decision input;
      // acting on it (handing a large bundle to a background job) is built in a later phase.
      const zipAsyncThreshold = await readFirmSetting(
        firm.firmDatabase,
        zipAsyncThresholdDefinition,
      );

      const now = new Date().toISOString();
      await commitEffectBatch(
        firm.firmDatabase,
        {
          statements: [
            insertAuditLogStatement(firm.firmDatabase, {
              id: newIdentifier("auditLog"),
              event: "files.bulkDownloaded",
              actorUserId: userId,
              subjectId: matterId,
              metadata: {
                fileCount: resolved.fileCount,
                totalBytes: resolved.totalBytes,
                zipAsyncThreshold,
              },
              now,
            }),
          ],
          outboxMessages: [],
        },
        { now: () => now },
      );

      // A single resolved file: redirect to a presigned GET, identical to the per-file download.
      if (resolved.entries.length === 1) {
        const only = resolved.entries[0] as ZipEntry;
        const presigner = presignerForEnv(c.env);
        const url = await presigner.presignGet(bucket, only.r2Key, DOWNLOAD_TTL_SECONDS);
        return c.redirect(url, 302);
      }

      // Multiple files: stream a store-mode ZIP of the resolved R2 object bodies. Each entry's input
      // is the R2 object stream — never buffered into memory — so a large bundle streams within the
      // Worker's limits. A missing object (reaped between resolve and stream) is skipped rather than
      // aborting the whole archive.
      const env = c.env;
      async function* zipInputs() {
        for (const entry of resolved.entries) {
          const object = await env.R2.get(entry.r2Key);
          if (object === null) continue;
          yield { name: entry.path, input: object.body };
        }
      }
      const zipStream = makeZip(zipInputs());
      return new Response(zipStream, {
        status: 200,
        headers: {
          "content-type": "application/zip",
          "content-disposition": `attachment; filename="${archiveFileName(matterId)}"`,
        },
      });
    },
  );
}
