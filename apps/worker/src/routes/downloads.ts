import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { insertAuditLogStatement } from "@magna-carta/data-access/audit-statements";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import {
  listCleanCurrentVersionsByMatter,
  listFoldersByMatter,
} from "@magna-carta/file-manager/queries";
import {
  readLiveMaxFileCount,
  readLiveMaxTotalBytes,
} from "@magna-carta/file-manager/upload-policy";
import {
  bundleManifestHash,
  resolveZipSelection,
  type ZipEntry,
} from "@magna-carta/file-manager/zip-composition";
import type { FileId, FolderId, MatterId } from "@magna-carta/identifiers/types";
import { makeZip } from "client-zip";
import type { Bindings } from "../app.ts";
import type { Chokepoint } from "../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointFirmId,
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

// The async-build handles: a 202 carries the job handle to poll (the manifest hash IS the job id); a
// 200 JSON carries a fresh signed URL when an identical selection was already built.
const BundleAccepted = z
  .object({ jobId: z.string(), status: z.string() })
  .openapi("BundleBuildAccepted");
const BundleReady = z.object({ url: z.string() }).openapi("BundleReady");

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
      description:
        "A streamed ZIP archive of the selected files; or, when the selection exceeds the live " +
        "threshold and an identical bundle was already built, a JSON body with a fresh signed URL.",
      content: {
        "application/zip": { schema: z.string().openapi({ format: "binary" }) },
        "application/json": { schema: BundleReady },
      },
    },
    202: {
      description:
        "The selection exceeds the live-download threshold; a background build was started or is " +
        "already in progress. Poll the bundle-status endpoint with the returned jobId.",
      content: { "application/json": { schema: BundleAccepted } },
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
      const firmId = requireChokepointFirmId(c);
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

      // The two live-vs-async thresholds: a selection over EITHER the file-count or the total-bytes
      // knob is too retry-unfriendly to stream inline, so it hands off to the background build job. A
      // single-file selection always redirects (a presigned GET needs no archive), whatever its size.
      const [liveMaxFileCount, liveMaxTotalBytes] = await Promise.all([
        readLiveMaxFileCount(firm.firmDatabase),
        readLiveMaxTotalBytes(firm.firmDatabase),
      ]);
      const delivery =
        resolved.entries.length === 1
          ? "redirect"
          : resolved.fileCount > liveMaxFileCount || resolved.totalBytes > liveMaxTotalBytes
            ? "async"
            : "inline";

      // The export is recorded AFTER the delivery side-effect succeeds (matching the per-file download
      // in routes/files.ts), so the audit trail never claims an export that a later presign/build
      // failure prevented.
      const now = new Date().toISOString();
      const recordExport = () =>
        commitEffectBatch(
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
                  liveMaxFileCount,
                  liveMaxTotalBytes,
                  delivery,
                },
                now,
              }),
            ],
            outboxMessages: [],
          },
          { now: () => now },
        );

      // A single resolved file: redirect to a presigned GET, identical to the per-file download.
      if (delivery === "redirect") {
        const only = resolved.entries[0] as ZipEntry;
        const presigner = presignerForEnv(c.env);
        const url = await presigner.presignGet(bucket, only.r2Key, DOWNLOAD_TTL_SECONDS);
        await recordExport();
        return c.redirect(url, 302);
      }

      // Over the live threshold: hand off to a content-addressed background build. The manifest hash
      // is the dedup key, the R2 artifact key, AND the job id the client polls. An identical selection
      // already built hands back a fresh signed URL; otherwise the coordinator single-flights the build.
      if (delivery === "async") {
        const entries = resolved.entries.map((entry) => ({ r2Key: entry.r2Key, path: entry.path }));
        const manifestHash = await bundleManifestHash(entries);
        const artifactKey = `bundles/${manifestHash}.zip`;
        const existing = await c.env.R2.head(artifactKey);
        if (existing !== null) {
          const url = await presignerForEnv(c.env).presignGet(
            bucket,
            artifactKey,
            DOWNLOAD_TTL_SECONDS,
          );
          await recordExport();
          return c.json({ url }, 200);
        }
        const coordinator = c.env.BUNDLE_COORDINATOR.get(
          c.env.BUNDLE_COORDINATOR.idFromName(`${firmId}:${manifestHash}`),
        );
        const state = await coordinator.requestBundle({
          firmId,
          bucketName: bucket,
          manifestHash,
          entries,
        });
        await recordExport();
        return c.json({ jobId: manifestHash, status: state.status }, 202);
      }

      // Inline (multiple files under the threshold): stream a store-mode ZIP of the R2 object bodies.
      // Each entry's input
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
      await recordExport();
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
