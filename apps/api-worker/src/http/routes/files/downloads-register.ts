import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { insertAuditLogStatement } from "@magna-carta/data-access/audit-statements";
import {
  deleteDownloadItemStatement,
  readDownloadItem,
  readDownloadShelf,
  recordDownloadedFormatStatement,
} from "@magna-carta/data-access/download-register-statements";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { DownloadItemId } from "@magna-carta/identifiers/types";
import { storedTabularDocumentSchema } from "@magna-carta/export-document/renderable";
import type { Bindings } from "../../../bindings.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointUserId,
} from "../../chokepoint/context-accessors.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { cursorQuery, paginated } from "../../contracts/pagination.ts";
import { Problem, problemJson } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";
import {
  readSnapshotDocument,
  recordExportSnapshot,
  SHELF_READ_LIMIT,
  shelfExpiry,
  snapshotObjectKey,
} from "../../../downloads/download-register.ts";
import { decodeCursor, encodeCursor } from "@magna-carta/data-access/cursor-pagination";
import { resolveFirmBucket } from "../../../files/firm-bucket.ts";
import { presignerForEnv } from "../../../files/presigner-wiring.ts";

// The same short life a per-file download URL gets: long enough for the browser to start, short
// enough that a copied link is not a standing grant.
const FETCH_TTL_SECONDS = 300;

const DownloadItemView = z
  .object({
    id: z.string(),
    title: z.string(),
    kind: z.enum(["artifact", "snapshot", "reference", "record"]),
    producer: z.enum(["export", "bundle", "conversion", "file", "discovery"]),
    // The matter file a reference points at, so the screen can offer the way back to it. Null on
    // every other kind.
    subjectFileId: z.string().nullable(),
    byteSize: z.number().nullable(),
    // What it was made for, distinct from what has been taken.
    requestedFormat: z.string().nullable(),
    // Which formats this member has already taken. Empty means built and never fetched, which is a
    // real state the shelf shows rather than hides.
    downloadedFormats: z.array(z.string()),
    createdAt: z.string(),
    // When the BYTES let go, not the row — the register keeps what a member downloaded. Null on a
    // reference, which holds no bytes of the register's to release.
    expiresAt: z.string().nullable(),
    state: z.enum(["building", "ready", "failed", "expired"]),
  })
  .openapi("DownloadItem");

/*
 * The register is paged, on the platform's one list envelope.
 *
 * It used to answer `{ items: [...] }` — one bounded read, on the reasoning that a shelf is short-
 * lived by construction. Two changes took that premise away: every download registers now, not only
 * what the platform made, and the row outlives the bytes rather than being swept with them. A
 * member's register therefore grows without bound, and a whole read of it would get slower for the
 * rest of their time at the firm.
 *
 * Naming the array `data` is not cosmetic either. `pnpm run lint:list-pagination` reads the EMITTED
 * contract for GETs answering `{ data: [...] }` with no `nextCursor` beside them — so a list that
 * called its array something else was invisible to the gate that exists to catch exactly this.
 */
const DownloadShelfPage = paginated(DownloadItemView).openapi("DownloadShelfPage");

// One fetch answers for every kind, because the member performed one act. An artifact hands back a
// freshly minted presigned URL — the register never proxies bytes, so the browser's own download
// manager keeps pause, resume and speed. A snapshot hands back the stored DOCUMENT, which the client
// renders in whichever format it asked for (text, CSV and Excel in the browser; Word and PDF through
// the report-export printer), so the register grows no renderer of its own.
//
// A REFERENCE HANDS BACK THIS PLATFORM'S OWN ADDRESS FOR THE FILE, and that is the security design
// rather than a convenience. The file lives on a matter and is reached through the files route,
// which runs the whole chokepoint — tenancy, authentication, the matter capability — on every
// request. Presigning it here instead would mint a standing grant from a register row, so a member
// screened off a matter afterwards would keep a working handle to its files. Handing back the route
// means the answer to "may they still have this" is re-asked by the one thing that knows, at the
// moment they ask for it.
const DownloadFetchResponse = z
  .object({
    kind: z.enum(["artifact", "snapshot", "reference", "record"]),
    url: z.string().optional(),
    document: z.unknown().optional(),
  })
  .openapi("DownloadFetchResponse");

const FetchRequest = z
  .object({
    // What the member is about to take it as. Recorded on the row so the shelf can say what has
    // already been downloaded — the half of the question a bare list does not answer.
    format: z.string().min(1).max(16),
  })
  .openapi("DownloadFetchRequest");

const SnapshotRequest = z
  .object({
    title: z.string().min(1).max(200),
    // The format the member CHOSE on the export control. The document itself is format-free, so
    // this is what a later download defaults to.
    format: z.string().min(1).max(16),
    // Whether that format has actually been downloaded. Exporting GENERATES onto the shelf by
    // default and produces no file, so the format asked for is not yet a format taken; only the
    // member's download-immediately setting makes it both at once. Recording an untaken format as
    // taken would tell them they already have a file that was never made.
    taken: z.boolean().default(false),
    document: storedTabularDocumentSchema,
  })
  .openapi("DownloadSnapshotRequest");

const SnapshotCreatedResponse = z
  .object({ id: z.string(), expiresAt: z.string() })
  .openapi("DownloadSnapshotCreatedResponse");

export const downloadSnapshotMeta: RouteMeta = {
  operationId: "downloads.recordSnapshot",
  surface: "app",
  authenticated: true,
  permission: "downloads:shelf",
  resource: "firm",
  // AUDITED. An export is firm data leaving the platform in a file, which is the same class of act
  // the bulk-download row records — and the register is the first place that act becomes visible at
  // all, since the render route is a stateless printer that writes nothing.
  audited: true,
  idempotency: "optional",
  rateLimit: "default",
};

export const downloadShelfMeta: RouteMeta = {
  operationId: "downloads.shelf",
  surface: "app",
  authenticated: true,
  permission: "downloads:shelf",
  resource: "firm",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

export const downloadFetchMeta: RouteMeta = {
  operationId: "downloads.fetch",
  surface: "app",
  authenticated: true,
  permission: "downloads:shelf",
  resource: "firm",
  // AUDITED, and deliberately not allow-listed as a read-shaped write. An artifact on the shelf is a
  // bundle of the firm's own files, and a second fetch of it is a second download of that content —
  // the act the original `files.bulkDownloaded` row exists to record. A shelf that let a member take
  // the same archive repeatedly with only the first one visible to the firm would be a hole in the
  // record rather than a convenience.
  audited: true,
  idempotency: "optional",
  rateLimit: "default",
};

export const downloadRemoveMeta: RouteMeta = {
  operationId: "downloads.remove",
  surface: "app",
  authenticated: true,
  permission: "downloads:shelf",
  resource: "firm",
  audited: true,
  idempotency: "optional",
  rateLimit: "default",
};

export const downloadSnapshotRoute = defineOpenAPIRoute(downloadSnapshotMeta, {
  method: "post",
  path: "/api/v1/downloads/snapshots",
  description:
    "Put an export the caller has just taken onto their own shelf. The tabular DOCUMENT is stored rather than a rendered file, so one shelf item serves every format and the figures stay frozen at the instant of the export. The render route stays a stateless printer; this is the deliberate act of keeping a copy.",
  request: {
    body: { content: { "application/json": { schema: SnapshotRequest } }, required: true },
  },
  responses: {
    201: {
      description: "The shelf item that was created",
      content: { "application/json": { schema: SnapshotCreatedResponse } },
    },
    401: {
      description: "No valid session",
      content: { "application/problem+json": { schema: Problem } },
    },
    403: {
      description: "Authenticated, but the member lacks downloads:shelf",
      content: { "application/problem+json": { schema: Problem } },
    },
    422: {
      description: "The document is past the register's bounds",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

export const downloadShelfRoute = defineOpenAPIRoute(downloadShelfMeta, {
  method: "get",
  path: "/api/v1/downloads",
  request: {
    // `search` narrows the whole register on the server rather than the page in hand: the register
    // has no bound, so narrowing what a client already loaded would answer confidently about a
    // fraction of it. `limit` exists for the same reason from the other end — the top-bar tray shows
    // the newest four on every screen in the application, and asking for a full page of a register
    // that now keeps everything would make that chrome cost more than the screen under it.
    query: cursorQuery.extend({
      search: z.string().max(200).optional(),
      limit: z.coerce.number().int().min(1).max(SHELF_READ_LIMIT).optional(),
    }),
  },
  description:
    "The session member's own register of everything they have downloaded, newest first, with what has already been taken and when each item's bytes expire. Optionally narrowed to titles containing `search`. Scoped to the member, never the firm.",
  responses: {
    200: {
      description: "The member's shelf",
      content: { "application/json": { schema: DownloadShelfPage } },
    },
    401: {
      description: "No valid session",
      content: { "application/problem+json": { schema: Problem } },
    },
    403: {
      description: "Authenticated, but the member lacks downloads:shelf",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

export const downloadFetchRoute = defineOpenAPIRoute(downloadFetchMeta, {
  method: "post",
  path: "/api/v1/downloads/{downloadItemId}/fetches",
  description:
    "Take a shelf item again, in the stated format, and record that it was taken. An artifact answers with a freshly minted short-lived URL the browser downloads directly; a snapshot answers with the stored export document for the client to render. An item whose bytes have already been swept answers 410.",
  request: {
    params: z.object({ downloadItemId: z.string() }),
    body: { content: { "application/json": { schema: FetchRequest } }, required: true },
  },
  responses: {
    200: {
      description: "The URL to download, or the document to render",
      content: { "application/json": { schema: DownloadFetchResponse } },
    },
    401: {
      description: "No valid session",
      content: { "application/problem+json": { schema: Problem } },
    },
    403: {
      description: "Authenticated, but the member lacks downloads:shelf",
      content: { "application/problem+json": { schema: Problem } },
    },
    404: {
      description: "No such item on this member's shelf",
      content: { "application/problem+json": { schema: Problem } },
    },
    410: {
      description: "The item's retention window has closed and its bytes are gone",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

export const downloadRemoveRoute = defineOpenAPIRoute(
  {
    ...downloadRemoveMeta,
    reversal: {
      kind: "none",
      reason:
        "A shelf item points at an artifact somebody asked for. Asking again produces a new one with its own snapshot; nothing puts this row back.",
    },
  },
  {
    method: "delete",
    path: "/api/v1/downloads/{downloadItemId}",
    description:
      "Clear one item off the session member's own shelf, and delete the stored document behind a snapshot. An artifact's bytes belong to its own producer and its own lifecycle rule, so they are left alone.",
    request: { params: z.object({ downloadItemId: z.string() }) },
    responses: {
      204: { description: "Removed" },
      401: {
        description: "No valid session",
        content: { "application/problem+json": { schema: Problem } },
      },
      403: {
        description: "Authenticated, but the member lacks downloads:shelf",
        content: { "application/problem+json": { schema: Problem } },
      },
      404: {
        description: "No such item on this member's shelf",
        content: { "application/problem+json": { schema: Problem } },
      },
      429: {
        description: "Rate limit exceeded",
        content: { "application/problem+json": { schema: Problem } },
      },
    },
  },
);

export function registerDownloadRegisterRoutes(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  chokepoint: Chokepoint,
): void {
  app.openapi(
    {
      ...downloadSnapshotRoute,
      middleware: chokepointMiddleware(chokepoint, downloadSnapshotRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const { title, format, taken, document } = c.req.valid("json");
      const { bucket } = resolveFirmBucket(c.env, firm.bucketName);
      const now = new Date();
      const id = await recordExportSnapshot({
        database: firm.firmDatabase,
        bucket,
        memberId: userId,
        title,
        document,
        requestedFormat: format,
        now,
      });
      // The audit row for the export itself — the first record of it anywhere, since the printer
      // that rendered it stores nothing — plus the taken-format only when a file really was produced.
      await commitEffectBatch(
        firm.firmDatabase,
        {
          statements: [
            ...(taken
              ? [recordDownloadedFormatStatement(firm.firmDatabase, userId, id, format)]
              : []),
            insertAuditLogStatement(firm.firmDatabase, {
              id: newIdentifier("auditLog"),
              event: "downloads.exportKept",
              actorUserId: userId,
              subjectId: id,
              metadata: { title, format, taken, sections: document.sections.length },
              now: now.toISOString(),
            }),
          ],
          outboxMessages: [],
        },
        { now: () => now.toISOString() },
      );
      return c.json({ id, expiresAt: shelfExpiry(now) }, 201);
    },
  );

  app.openapi(
    { ...downloadShelfRoute, middleware: chokepointMiddleware(chokepoint, downloadShelfRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const { cursor, search, limit } = c.req.valid("query");
      const after = decodeCursor(cursor);
      const size = limit ?? SHELF_READ_LIMIT;
      // One more than the page, so "is there another page" is answered by the read rather than by a
      // second count that could disagree with it.
      const rows = await readDownloadShelf(firm.firmDatabase, userId, size + 1, after, search);
      const page = rows.slice(0, size);
      const last = page.at(-1);
      return c.json(
        {
          nextCursor:
            rows.length > size && last !== undefined ? encodeCursor(last.createdAt, last.id) : null,
          data: page.map((row) => ({
            id: row.id,
            title: row.title,
            kind: row.kind,
            producer: row.producer,
            subjectFileId: row.subjectFileId,
            byteSize: row.byteSize,
            requestedFormat: row.requestedFormat,
            downloadedFormats: [...row.downloadedFormats],
            createdAt: row.createdAt,
            expiresAt: row.expiresAt,
            state: row.state,
          })),
        },
        200,
      );
    },
  );

  app.openapi(
    { ...downloadFetchRoute, middleware: chokepointMiddleware(chokepoint, downloadFetchRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const { downloadItemId } = c.req.valid("param");
      const { format } = c.req.valid("json");
      // The member scope is part of the lookup rather than a check after it, so an item belonging to
      // a colleague answers exactly as one that does not exist.
      const row = await readDownloadItem(
        firm.firmDatabase,
        userId,
        downloadItemId as DownloadItemId,
      );
      if (row === undefined) {
        return problemJson(c, {
          type: "not-found",
          title: "No such download",
          status: 404,
          detail: "That item is not on your shelf.",
        });
      }
      if (row.state !== "ready") {
        return problemJson(c, {
          type: "not-found",
          title: "Download not ready",
          status: 410,
          detail:
            row.state === "building"
              ? "That download is still being prepared."
              : "That download is no longer available.",
        });
      }

      const { bucketName, bucket } = resolveFirmBucket(c.env, firm.bucketName);
      const now = new Date();
      const recordTaken = async (): Promise<void> => {
        await commitEffectBatch(
          firm.firmDatabase,
          {
            statements: [
              recordDownloadedFormatStatement(firm.firmDatabase, userId, row.id, format),
              insertAuditLogStatement(firm.firmDatabase, {
                id: newIdentifier("auditLog"),
                event: "downloads.itemFetched",
                actorUserId: userId,
                subjectId: row.id,
                metadata: { producer: row.producer, kind: row.kind, format },
                now: now.toISOString(),
              }),
            ],
            outboxMessages: [],
          },
          { now: () => now.toISOString() },
        );
      };

      if (row.kind === "reference") {
        // The file's own address on this platform, never a presigned URL. The files route re-runs
        // the matter capability check, so access is decided now rather than at the instant the row
        // was written. A row with no file id cannot exist — the schema's CHECK ties the two — but
        // the read is typed as nullable, and refusing is the honest answer to a row that broke it.
        if (row.subjectFileId === null) {
          return problemJson(c, {
            type: "not-found",
            title: "Download unavailable",
            status: 410,
            detail: "That download no longer names a file.",
          });
        }
        await recordTaken();
        return c.json(
          {
            kind: "reference" as const,
            url: `/api/v1/files/${encodeURIComponent(row.subjectFileId)}/download`,
          },
          200,
        );
      }

      // Past the reference branch every remaining kind holds bytes of its own, so a missing key is a
      // row whose object has already been released rather than a shape this code should carry.
      if (row.objectKey === null) {
        return problemJson(c, {
          type: "not-found",
          title: "Download expired",
          status: 410,
          detail: "That download has passed its retention window and is no longer stored.",
        });
      }

      if (row.kind === "snapshot") {
        const document = await readSnapshotDocument(bucket, row.objectKey);
        if (document === undefined) {
          return problemJson(c, {
            type: "not-found",
            title: "Download expired",
            status: 410,
            detail: "That export is no longer stored. Run it again from the screen it came from.",
          });
        }
        await recordTaken();
        return c.json({ kind: "snapshot" as const, document }, 200);
      }

      // An artifact: the bytes belong to their producer's prefix and its lifecycle rule, so a read
      // that finds them gone reports it rather than handing over a URL that 404s at R2.
      const head = await bucket.head(row.objectKey);
      if (head === null) {
        return problemJson(c, {
          type: "not-found",
          title: "Download expired",
          status: 410,
          detail: "That file has passed its retention window and is no longer stored.",
        });
      }
      const url = await presignerForEnv(c.env).presignGet(
        bucketName,
        row.objectKey,
        FETCH_TTL_SECONDS,
      );
      await recordTaken();
      return c.json({ kind: "artifact" as const, url }, 200);
    },
  );

  app.openapi(
    { ...downloadRemoveRoute, middleware: chokepointMiddleware(chokepoint, downloadRemoveRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const { downloadItemId } = c.req.valid("param");
      const row = await readDownloadItem(
        firm.firmDatabase,
        userId,
        downloadItemId as DownloadItemId,
      );
      if (row === undefined) {
        return problemJson(c, {
          type: "not-found",
          title: "No such download",
          status: 404,
          detail: "That item is not on your shelf.",
        });
      }
      const now = new Date().toISOString();
      await commitEffectBatch(
        firm.firmDatabase,
        {
          statements: [
            deleteDownloadItemStatement(firm.firmDatabase, userId, row.id),
            insertAuditLogStatement(firm.firmDatabase, {
              id: newIdentifier("auditLog"),
              event: "downloads.itemRemoved",
              actorUserId: userId,
              subjectId: row.id,
              metadata: { producer: row.producer, kind: row.kind },
              now,
            }),
          ],
          outboxMessages: [],
        },
        { now: () => now },
      );
      // A snapshot's document is the register's own object, so removing the row removes it. An
      // artifact's bytes are its producer's and may be shared with a colleague's row, so they stay.
      if (row.kind === "snapshot") {
        const { bucket } = resolveFirmBucket(c.env, firm.bucketName);
        await bucket.delete(snapshotObjectKey(row.id));
      }
      return c.body(null, 204);
    },
  );
}
