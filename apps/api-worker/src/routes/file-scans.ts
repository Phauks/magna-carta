import { type OpenAPIHono, z } from "@hono/zod-openapi";
import { insertAuditLogStatement } from "@magna-carta/data-access/audit-statements";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import { selectFileStatement } from "@magna-carta/file-manager/file-statements";
import {
  getVersionForIntegrity,
  listVersionScanEvents,
  VERSION_SCAN_EVENTS,
} from "@magna-carta/file-manager/queries";
import { readScanEngineVersion } from "@magna-carta/file-manager/upload-policy";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FileId, FileVersionId } from "@magna-carta/identifiers/types";
import type { Bindings } from "../app.ts";
import type { Chokepoint } from "../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointUserId,
} from "../chokepoint/context-accessors.ts";
import type { AppVariables } from "../chokepoint/ports.ts";
import { chokepointMiddleware } from "../chokepoint/register.ts";
import { identifierField, identifierPathParam } from "../contracts/common.ts";
import { Problem, problemJson } from "../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../contracts/route-meta.ts";
import { FILE_RESCAN_ACTION } from "../files/ingest-consumer.ts";

const fileParam = z.object({ id: identifierPathParam("file", "id") });

const ScanEvent = z
  .object({
    id: z.string(),
    at: z.string(),
    event: z.enum(VERSION_SCAN_EVENTS),
    versionId: z.string(),
    versionNumber: z.number().int(),
    // Who asked, for a request; null for a scan the platform ran on its own.
    actorUserId: z.string().nullable(),
    actorName: z.string().nullable(),
    // What the scan found, as the event recorded it; null where the event carried no such fact.
    scanVerdict: z.enum(["unscanned", "clean", "flagged"]).nullable(),
    scanEngineVersion: z.string().nullable(),
    scanDetail: z.string().nullable(),
  })
  .openapi("FileScanEvent");

const FileScanHistory = z
  .object({
    // The engine the firm scans with today, or null while none is recorded — the reader can tell
    // a verdict reached under an older engine from one reached under this one.
    currentEngineVersion: z.string().nullable(),
    data: z.array(ScanEvent),
  })
  .openapi("FileScanHistory");

const RescanRequest = z.object({
  // The version to look at again; the file's current version when omitted.
  versionId: identifierField("fileVersion").optional(),
});

const RescanResult = z
  .object({
    // The audit id of the request. The result event that answers it carries the same id.
    requestId: z.string(),
    versionId: z.string(),
    // False when the request could not be queued: no engine is recorded for the firm, or the
    // scan queue is not bound. The request is still audited, so the history says it was asked.
    enqueued: z.boolean(),
  })
  .openapi("FileRescanResult");

const listFileScansMeta: RouteMeta = {
  operationId: "files.scans",
  surface: "app",
  authenticated: true,
  permission: null,
  resource: "matter",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

const listFileScansRoute = defineOpenAPIRoute(listFileScansMeta, {
  method: "get",
  path: "/api/v1/files/{id}/scans",
  description:
    "A file's safety history: every intake scan, re-scan, quarantine and re-scan request recorded " +
    "against any of its versions, newest first, each with the verdict, engine and detail as " +
    "recorded when it happened.",
  request: { params: fileParam },
  responses: {
    200: {
      description: "The file's scan history",
      content: { "application/json": { schema: FileScanHistory } },
    },
    401: {
      description: "No valid session",
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
  },
});

// files.rescan — a member's "look at this file again". Gated on `files:upload` on the same footing
// as the per-matter re-scan: a member who may put files on a matter may ask for one to be checked
// again. audited: true — the request row is the history line that says who asked and when.
const rescanFileMeta: RouteMeta = {
  operationId: "files.rescan",
  surface: "app",
  authenticated: true,
  permission: "files:upload",
  resource: "matter",
  audited: true,
  idempotency: "optional",
  rateLimit: "default",
};

const rescanFileRoute = defineOpenAPIRoute(rescanFileMeta, {
  method: "post",
  path: "/api/v1/files/{id}/rescan",
  description:
    "Queues a fresh malware scan of one committed version of a file (the current version unless " +
    "one is named), whether or not its verdict is current, and without reusing an earlier result " +
    "for the same bytes. The scan runs off the request path; its verdict lands as a re-scan event " +
    "in the file's scan history carrying this request's id. Records the request whether or not it " +
    "could be queued.",
  request: {
    params: fileParam,
    body: { content: { "application/json": { schema: RescanRequest } }, required: false },
  },
  responses: {
    200: {
      description: "The request, and whether a scan was queued for it",
      content: { "application/json": { schema: RescanResult } },
    },
    401: {
      description: "No valid session",
      content: { "application/problem+json": { schema: Problem } },
    },
    403: {
      description: "The member lacks files:upload",
      content: { "application/problem+json": { schema: Problem } },
    },
    404: {
      description: "The file is unknown, or the named version is not a committed version of it",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

type FileScanApp = OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>;

async function loadCurrentVersionId(
  database: Parameters<typeof selectFileStatement>[0],
  id: FileId,
): Promise<{ currentVersionId: FileVersionId | null } | undefined> {
  const { results } = await selectFileStatement(database, id).all<{
    current_version_id: FileVersionId | null;
    deleted_at: string | null;
  }>();
  const row = results[0];
  if (row === undefined || row.deleted_at !== null) return undefined;
  return { currentVersionId: row.current_version_id };
}

export function registerFileScanRoutes(app: FileScanApp, chokepoint: Chokepoint): void {
  app.openapi(
    { ...listFileScansRoute, middleware: chokepointMiddleware(chokepoint, listFileScansRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { id } = c.req.valid("param");
      const file = await loadCurrentVersionId(firm.firmDatabase, id);
      if (file === undefined) {
        return problemJson(c, {
          type: "not-found",
          title: "Not found",
          status: 404,
          detail: "No such file in this firm.",
        });
      }
      const [currentEngineVersion, events] = await Promise.all([
        readScanEngineVersion(firm.firmDatabase),
        listVersionScanEvents(firm.firmDatabase, id),
      ]);
      return c.json(
        {
          currentEngineVersion,
          data: events.map((event) => ({
            id: event.id,
            at: event.at,
            event: event.event,
            versionId: event.versionId,
            versionNumber: event.versionNumber,
            actorUserId: event.actorUserId,
            actorName: event.actorName,
            scanVerdict: event.scanVerdict,
            scanEngineVersion: event.scanEngineVersion,
            scanDetail: event.scanDetail,
          })),
        },
        200,
      );
    },
  );

  app.openapi(
    { ...rescanFileRoute, middleware: chokepointMiddleware(chokepoint, rescanFileRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const { id } = c.req.valid("param");
      const body = c.req.valid("json") ?? {};
      const file = await loadCurrentVersionId(firm.firmDatabase, id);
      if (file === undefined) {
        return problemJson(c, {
          type: "not-found",
          title: "Not found",
          status: 404,
          detail: "No such file in this firm.",
        });
      }
      const versionId = body.versionId ?? file.currentVersionId;
      // The R2 key is firm-scoped and server-resolved from the file and version ids — never taken
      // from the request — and only a committed version of THIS file resolves at all.
      const version =
        versionId === null
          ? undefined
          : await getVersionForIntegrity(firm.firmDatabase, id, versionId);
      if (version === undefined) {
        return problemJson(c, {
          type: "not-found",
          title: "No version to check",
          status: 404,
          detail:
            versionId === null
              ? "The file has no committed version yet."
              : "That is not a committed version of this file.",
        });
      }

      const requestId = newIdentifier("auditLog");
      const now = new Date().toISOString();
      // The interactive lane: a member is watching for the answer, so it goes to the shard the
      // warm-poke keeps resident rather than fanning out over the bulk instances.
      const queue = c.env.FILES_INGEST;
      const current = await readScanEngineVersion(firm.firmDatabase);
      const enqueued = queue !== undefined && firm.bucketName !== null && current !== null;
      if (enqueued) {
        await queue.send({
          bucket: firm.bucketName,
          object: { key: version.r2Key, size: version.sizeBytes ?? 0 },
          action: FILE_RESCAN_ACTION,
          requestId,
        });
      }
      await commitEffectBatch(
        firm.firmDatabase,
        {
          statements: [
            insertAuditLogStatement(firm.firmDatabase, {
              id: requestId,
              event: "file.rescan_requested",
              actorUserId: userId,
              subjectId: version.id,
              metadata: { enqueued, currentEngineVersion: current },
              now,
            }),
          ],
          outboxMessages: [],
        },
        { now: () => now },
      );
      return c.json({ requestId, versionId: version.id, enqueued }, 200);
    },
  );
}
