import { type OpenAPIHono, z } from "@hono/zod-openapi";
import { insertAuditLogStatement } from "@magna-carta/data-access/audit-statements";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import { listStaleMatterVersionsForRescan } from "@magna-carta/file-manager/queries";
import { readScanEngineVersion } from "@magna-carta/file-manager/upload-policy";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import { assertIdentifier } from "@magna-carta/identifiers/validate";
import type { Bindings } from "../../../bindings.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointUserId,
} from "../../chokepoint/context-accessors.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { identifierPathParam } from "../../contracts/common.ts";
import { Problem } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";

// Cap the per-request fan-out so a very large matter (the owner has 20k+-file matters) cannot blow the
// request's subrequest/time budget; the response reports `capped` so a caller knows more remain — and
// access-triggered re-scan still catches every uncapped file the next time it is opened, so nothing is
// ever silently skipped.
const MATTER_RESCAN_MAX = 10_000;
const QUEUE_BATCH = 100; // Cloudflare Queues sendBatch cap

const MatterRescanResult = z
  .object({
    enqueued: z.number().int(), // current clean versions queued for a background re-scan
    capped: z.boolean(), // true ⇒ more stale files remain than one request fans out; re-run to continue
  })
  .openapi("MatterRescanResult");

const matterParam = z.object({ id: identifierPathParam("matter", "id") });

// scan.matter — user-initiated "scan this matter now". Gated on `files:upload` (a member who works with
// a matter's files may request a re-scan of them; a files-namespace capability binds to the matter
// resource). audited: true — the request row records who asked and how many files were queued.
const scanMatterMeta: RouteMeta = {
  operationId: "scan.matter",
  surface: "app",
  authenticated: true,
  permission: "files:upload",
  resource: "matter",
  audited: true,
  idempotency: "optional",
  rateLimit: "default",
};

const scanMatterRoute = defineOpenAPIRoute(scanMatterMeta, {
  method: "post",
  path: "/api/v1/scan/matter/{id}",
  description:
    "Queues a background malware re-scan of every current file in a matter whose scan is stale relative " +
    "to the firm's current engine (a file already scanned under the current engine is skipped, so a " +
    "matter already current enqueues nothing). User-initiated; the scans run off the request path on " +
    "the bulk lane. No-op (enqueued 0) when no current engine version is recorded. `capped` is true " +
    "when more stale files remain than one request fans out — re-run to continue (any uncapped file is " +
    "still re-scanned on next access).",
  request: { params: matterParam },
  responses: {
    200: {
      description: "The re-scan enqueue result",
      content: { "application/json": { schema: MatterRescanResult } },
    },
    401: {
      description: "Not authenticated",
      content: { "application/problem+json": { schema: Problem } },
    },
    403: {
      description: "The member lacks files:upload",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

type ScanApp = OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>;

export function registerScanMatterRoute(app: ScanApp, chokepoint: Chokepoint): void {
  app.openapi(
    { ...scanMatterRoute, middleware: chokepointMiddleware(chokepoint, scanMatterRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      // The matter id is firm-scoped by the data-access layer — a foreign matter simply returns no
      // rows (no cross-firm leak), so this needs no separate matter-ownership check.
      const matterId = assertIdentifier(c.req.param("id"), "matter");

      const current = await readScanEngineVersion(firm.firmDatabase);
      let enqueued = 0;
      let capped = false;
      if (current !== null) {
        // current === null ⇒ no engine recorded; never fabricate a staleness comparison or a scan.
        const stale = await listStaleMatterVersionsForRescan(
          firm.firmDatabase,
          matterId,
          current,
          MATTER_RESCAN_MAX + 1, // +1 so we can tell whether more remain beyond the cap
        );
        capped = stale.length > MATTER_RESCAN_MAX;
        const toEnqueue = capped ? stale.slice(0, MATTER_RESCAN_MAX) : stale;
        const queue = c.env.FILES_INGEST_BULK ?? c.env.FILES_INGEST;
        const bucket = firm.bucketName;
        if (queue !== undefined && bucket !== null && toEnqueue.length > 0) {
          // The same R2-event shape the ingest consumer reads; it finds no pending version for the key
          // and runs the in-place re-scan branch (cache-first, staleness-gated). Batched on the bulk lane.
          for (let index = 0; index < toEnqueue.length; index += QUEUE_BATCH) {
            const chunk = toEnqueue.slice(index, index + QUEUE_BATCH);
            await queue.sendBatch(
              chunk.map((version) => ({
                body: {
                  bucket,
                  object: { key: version.r2Key, size: version.sizeBytes ?? 0 },
                  action: "MatterRescan",
                },
              })),
            );
          }
          enqueued = toEnqueue.length;
        }
      }

      const now = new Date().toISOString();
      await commitEffectBatch(
        firm.firmDatabase,
        {
          statements: [
            insertAuditLogStatement(firm.firmDatabase, {
              id: newIdentifier("auditLog"),
              event: "matter.files_rescan_requested",
              actorUserId: userId,
              subjectId: matterId,
              metadata: { enqueued, capped },
              now,
            }),
          ],
          outboxMessages: [],
        },
        { now: () => now },
      );

      return c.json({ enqueued, capped }, 200);
    },
  );
}
