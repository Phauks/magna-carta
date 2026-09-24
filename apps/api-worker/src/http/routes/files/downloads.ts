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
  bundleCacheKey,
  bundleManifestHash,
  resolveZipSelection,
  type ZipEntry,
} from "@magna-carta/file-manager/zip-composition";
import { zipEntriesFromR2 } from "@magna-carta/file-manager/zip-entries-from-r2";
import { bundleOptionsSchema } from "@magna-carta/file-manager/bundle-options";
import {
  FORMAT_CAPABILITIES,
  validateOptionsForFormat,
} from "@magna-carta/file-manager/bundle-formats";
import { applyBundleLayout } from "@magna-carta/file-manager/bundle-layout";
import { buildBundleManifest } from "@magna-carta/file-manager/bundle-manifest";
import type { ManifestEntry } from "@magna-carta/file-manager/contents-manifest";
import type { FileId, FolderId, MatterId } from "@magna-carta/identifiers/types";
import { makeZip } from "client-zip";
import {
  registerDownload,
  type DownloadRegistration,
} from "../../../downloads/download-register.ts";
import type { Bindings } from "../../../bindings.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointFirmId,
  requireChokepointUserId,
} from "../../chokepoint/context-accessors.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { identifierField } from "../../contracts/common.ts";
import { Problem, problemJson } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";
import { resolveFirmBucket } from "../../../files/firm-bucket.ts";
import { presignerForEnv } from "../../../files/presigner-wiring.ts";
import { selectBundleLane } from "../../../downloads/bundle-lane.ts";
import { bundleContainerAdapter } from "../../../downloads/bundle-container-adapter.ts";

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
    // Bundle format options: absent means the existing plain-ZIP fast lane unchanged.
    options: bundleOptionsSchema.optional(),
    // The archive password for an encrypted bundle. Must be present when options.encryption is
    // non-null and absent otherwise. Held only for the duration of the request — never stored,
    // never logged, never included in any queue message or audit metadata.
    password: z.string().min(1).optional(),
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
    422: {
      description:
        "The supplied bundle options are incoherent for the chosen format (e.g. ZIP with split " +
        "enabled, or encryption combined with split). The detail field lists each violation.",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/problem+json": { schema: Problem } },
    },
    503: {
      description:
        "The bundle service worker binding is not configured. This is a deploy-time activation; " +
        "the plain-ZIP fast lane is always available without it.",
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
      const firmBucket = resolveFirmBucket(c.env, firm.bucketName);
      const request = c.req.valid("json");
      const matterId: MatterId = request.matterId;
      const options = request.options;
      const password = request.password;

      // Validate format-capability constraints before any expensive operations. An incoherent option
      // set (e.g. ZIP + split, encryption + split) is rejected here with each violation listed so the
      // caller can fix all problems in one round trip. This check is purely structural — the lane
      // selector runs immediately after.
      if (options !== undefined) {
        const violations = validateOptionsForFormat(options);
        if (violations.length > 0) {
          return problemJson(c, {
            type: "validation",
            title: "Invalid bundle options",
            status: 422,
            detail: violations.join("; "),
          });
        }
      }

      // Cross-field password checks: encryption and a password must be supplied together or not at
      // all. These fire before any selection query so an incoherent request fails fast without a
      // round trip to the database.
      if (options?.encryption != null && !password) {
        return problemJson(c, {
          type: "validation",
          title: "Encryption requires a password",
          status: 422,
          detail: "encryption requires a password",
        });
      }
      if (password && options?.encryption == null) {
        return problemJson(c, {
          type: "validation",
          title: "Password supplied without encryption",
          status: 422,
          detail: "password supplied without encryption",
        });
      }

      // Select the delivery lane based on the options. All three lanes (plain, heavyAsync, and
      // encryptedStream) resolve the selection below before branching into their delivery logic.
      const lane = selectBundleLane(options);

      // Fail fast (before any selection query) when the encrypted lane is requested but the bundle
      // service binding is absent — a deploy-time activation that may be unbound during a staged
      // rollout. Same fail-before-DB discipline as the validation checks above.
      if (lane === "encryptedStream" && c.env.BUNDLE_SERVICE === undefined) {
        return problemJson(c, {
          type: "service-unavailable",
          title: "Bundle service not configured",
          status: 503,
          detail: "The bundle service is not available. Contact support if this persists.",
        });
      }

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

      // The live thresholds drive the plain lane's inline-vs-async decision; both are also recorded in
      // the audit metadata for every lane, so they are read once here regardless of lane.
      const [liveMaxFileCount, liveMaxTotalBytes] = await Promise.all([
        readLiveMaxFileCount(firm.firmDatabase),
        readLiveMaxTotalBytes(firm.firmDatabase),
      ]);

      // The export is recorded AFTER the delivery side-effect succeeds (matching the per-file download
      // in routes/files/files.ts), so the audit trail never claims an export that a later presign/build
      // failure prevented. Bundle-option flags (counts and booleans only — never password or content)
      // are included when options are present so the audit trail reflects what format was requested.
      const now = new Date().toISOString();
      // The audit entry and the register row ride ONE batch, so a bundle cannot be audited without
      // being registered or the reverse. `registration` is what the member actually received — the
      // chokepoint (../downloads/download-register.ts) turns that into a kind, and this route never
      // chooses one, which is what stops a lane filing a matter file as presignable bytes.
      const recordExport = (delivery: string, registration: DownloadRegistration) =>
        commitEffectBatch(
          firm.firmDatabase,
          {
            statements: [
              registerDownload(firm.firmDatabase, {
                memberId: userId,
                now: new Date(now),
                registration,
              }).statement,
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
                  // Options flags: absent when no options were supplied (legacy path).
                  ...(options !== undefined && {
                    format: options.format,
                    compression: options.compression,
                    encrypted: options.encryption !== null,
                    split: options.split !== null,
                  }),
                },
                now,
              }),
            ],
            outboxMessages: [],
          },
          { now: () => now },
        );

      // Encrypted single-file stream lane: the container receives the manifest (with the password) and
      // streams the encrypted archive back through the worker to the client. No queue, no coordinator,
      // no R2 artifact, no cache — the password and the bytes exist only for the request. The password
      // is validated non-null above; this lane is only reached when options.encryption is non-null.
      if (lane === "encryptedStream" && options !== undefined) {
        // The fail-fast check before the DB read already returns 503 for this case; this re-check is the
        // type-narrowing guard so the compiler knows BUNDLE_SERVICE is defined at the buildStream call
        // below (the earlier guard's narrowing does not carry across the intervening await).
        if (c.env.BUNDLE_SERVICE === undefined) {
          return problemJson(c, {
            type: "service-unavailable",
            title: "Bundle service not configured",
            status: 503,
            detail: "The bundle service is not available. Contact support if this persists.",
          });
        }

        // The manifest builder applies the layout internally; the un-laid-out resolved set is passed
        // so the layout is not applied twice. The laid-out entries are only needed here to build the
        // optional CONTENTS manifest rows (path + size for each file in its final archive path).
        const laidOut = options.manifest ? applyBundleLayout(resolved, options) : null;
        const manifestEntries: ManifestEntry[] = (laidOut?.entries ?? []).map((entry) => ({
          path: entry.path,
          sizeBytes: entry.sizeBytes,
          // Wire the file_version sha256 when the matter resolver projects content_sha256.
          sha256: "",
        }));

        const streamManifest = buildBundleManifest({
          jobId: newIdentifier("auditLog"),
          resolved,
          options,
          // password is guaranteed non-null here: the cross-field check above returns 422 when
          // encryption is non-null but password is absent, so this branch is only reached when
          // password is present.
          password: password!,
          manifestEntries,
          // Streaming lane: the container streams the archive to the client rather than writing
          // it to R2, so no output key prefix is used.
          outputKeyPrefix: "",
          mtimeByR2Key: new Map(),
        });

        const containerResponse = await bundleContainerAdapter(c.env.BUNDLE_SERVICE).buildStream(
          streamManifest,
        );

        const contentType =
          options.format === "zip" ? "application/zip" : "application/x-7z-compressed";
        // Sanitize for the Content-Disposition header; fall back to a generic name if the output name
        // is entirely non-filename characters (so the header is never an all-dashes string).
        const sanitizedOutputName = options.outputName.replace(/[^A-Za-z0-9._-]/g, "-");
        const safeOutputName = /[A-Za-z0-9]/.test(sanitizedOutputName)
          ? sanitizedOutputName
          : "download.zip";

        await recordExport("stream", {
          producer: "bundle",
          title: safeOutputName,
          bytes: { retained: false },
        });
        return new Response(containerResponse.body, {
          status: 200,
          headers: {
            "content-type": contentType,
            "content-disposition": `attachment; filename="${safeOutputName}"`,
          },
        });
      }

      // Heavy unencrypted async lane: a compressed / 7z / split bundle the bundle container builds off
      // the hot path. The optioned bundle is content-addressed — the cache key folds the selection's
      // content together with the non-secret options — and that key is the dedup key, the R2 output
      // key prefix, AND the job id the client polls. A single-file bundle already built hands back a
      // fresh signed URL; otherwise the coordinator single-flights the container build via the queue.
      if (lane === "heavyAsync" && options !== undefined) {
        // Compose the user's layout (wrapper / flatten) over the version-pinned entries. This drives
        // the cache key and the queue message. buildBundleManifest re-derives the same layout from the
        // original resolved set, so it is handed the un-laid-out `resolved` — passing `laidOut` would
        // apply the wrapper/flatten a second time.
        const laidOut = applyBundleLayout(resolved, options);
        const entries = laidOut.entries.map((entry) => ({ r2Key: entry.r2Key, path: entry.path }));
        const cacheKey = await bundleCacheKey(entries, options);
        const extension = FORMAT_CAPABILITIES[options.format].extension;
        // A non-split bundle is one object at <cacheKey>.<ext>; a split bundle is N volumes the
        // container names under the <cacheKey> prefix. The fast-path HEAD only applies to the former.
        const outputKeyPrefix =
          options.split === null ? `bundles/${cacheKey}.${extension}` : `bundles/${cacheKey}`;

        // The CONTENTS manifest rows (path / size / sha256) only when the user asked for a manifest.
        const manifestEntries: ManifestEntry[] = options.manifest
          ? laidOut.entries.map((entry) => ({
              path: entry.path,
              sizeBytes: entry.sizeBytes,
              // slice: wire the file_version sha256 (the matter resolver does not yet project
              // content_sha256, so the CONTENTS manifest records an empty hash for now).
              sha256: "",
            }))
          : [];

        const bundleManifest = buildBundleManifest({
          jobId: cacheKey,
          resolved,
          options,
          password: null, // the unencrypted lane never carries a password
          manifestEntries,
          outputKeyPrefix,
          // slice: wire file mtime from R2 object metadata (none recorded yet → null per entry).
          mtimeByR2Key: new Map(),
        });

        // Fast path (single-file bundles only): an identical optioned selection already built hands
        // back a fresh signed URL without re-running the container.
        if (options.split === null) {
          const existing = await firmBucket.bucket.head(outputKeyPrefix);
          if (existing !== null) {
            const url = await presignerForEnv(c.env).presignGet(
              firmBucket.bucketName,
              outputKeyPrefix,
              DOWNLOAD_TTL_SECONDS,
            );
            await recordExport("async", {
              producer: "bundle",
              title: options.outputName,
              bytes: { retained: true, objectKey: outputKeyPrefix, byteSize: existing.size },
            });
            return c.json({ url }, 200);
          }
        }

        const coordinator = c.env.BUNDLE_COORDINATOR.get(
          c.env.BUNDLE_COORDINATOR.idFromName(`${firmId}:${cacheKey}`),
        );
        const state = await coordinator.requestBundle({
          firmId,
          bucketName: firmBucket.bucketName,
          manifestHash: cacheKey,
          entries,
          options,
          manifest: bundleManifest,
        });
        await recordExport("async", {
          producer: "bundle",
          title: options.outputName,
          bytes: { retained: true, objectKey: outputKeyPrefix, byteSize: null },
          building: true,
        });
        return c.json({ jobId: cacheKey, status: state.status }, 202);
      }

      // Plain lane: the existing client-zip behavior. A single resolved file redirects; a selection
      // over EITHER live threshold hands off to a content-addressed background build; otherwise the
      // store-mode ZIP streams inline.
      const delivery =
        resolved.entries.length === 1
          ? "redirect"
          : resolved.fileCount > liveMaxFileCount || resolved.totalBytes > liveMaxTotalBytes
            ? "async"
            : "inline";

      // A single resolved file: redirect to a presigned GET, identical to the per-file download.
      if (delivery === "redirect") {
        const only = resolved.entries[0] as ZipEntry;
        const presigner = presignerForEnv(c.env);
        const url = await presigner.presignGet(
          firmBucket.bucketName,
          only.r2Key,
          DOWNLOAD_TTL_SECONDS,
        );
        await recordExport(delivery, {
          producer: "file",
          title: only.path,
          fileId: only.fileId,
          byteSize: only.sizeBytes,
        });
        return c.redirect(url, 302);
      }

      // Over the live threshold: hand off to a content-addressed background build. The manifest hash
      // is the dedup key, the R2 artifact key, AND the job id the client polls. An identical selection
      // already built hands back a fresh signed URL; otherwise the coordinator single-flights the build.
      if (delivery === "async") {
        const entries = resolved.entries.map((entry) => ({ r2Key: entry.r2Key, path: entry.path }));
        const manifestHash = await bundleManifestHash(entries);
        const artifactKey = `bundles/${manifestHash}.zip`;
        const existing = await firmBucket.bucket.head(artifactKey);
        if (existing !== null) {
          const url = await presignerForEnv(c.env).presignGet(
            firmBucket.bucketName,
            artifactKey,
            DOWNLOAD_TTL_SECONDS,
          );
          await recordExport(delivery, {
            producer: "bundle",
            title: archiveFileName(matterId),
            bytes: { retained: true, objectKey: artifactKey, byteSize: existing.size },
          });
          return c.json({ url }, 200);
        }
        const coordinator = c.env.BUNDLE_COORDINATOR.get(
          c.env.BUNDLE_COORDINATOR.idFromName(`${firmId}:${manifestHash}`),
        );
        const state = await coordinator.requestBundle({
          firmId,
          bucketName: firmBucket.bucketName,
          manifestHash,
          entries,
        });
        await recordExport(delivery, {
          producer: "bundle",
          title: archiveFileName(matterId),
          bytes: { retained: true, objectKey: artifactKey, byteSize: null },
          building: true,
        });
        return c.json({ jobId: manifestHash, status: state.status }, 202);
      }

      // Inline (multiple files under the threshold): stream a store-mode ZIP of the R2 object bodies.
      // Each entry's input is the R2 object stream — never buffered into memory — so a large bundle
      // streams within the Worker's limits. A missing object (reaped between resolve and stream) is
      // skipped rather than aborting the whole archive (zipEntriesFromR2, shared with the async build).
      await recordExport(delivery, {
        producer: "bundle",
        title: archiveFileName(matterId),
        bytes: { retained: false },
      });
      const zipStream = makeZip(zipEntriesFromR2(firmBucket.bucket, resolved.entries));
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
