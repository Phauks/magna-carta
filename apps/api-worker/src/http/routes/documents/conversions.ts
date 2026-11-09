import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import { markDownloadItemReadyByObjectKeyStatement } from "@magna-carta/data-access/download-register-statements";
import { findPath } from "@magna-carta/conversion/pathfinding";
import { getFormat } from "@magna-carta/conversion/registry";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import { firmScopedObjectDimensions } from "@magna-carta/object-dimensions/dimensions";
import type { Bindings } from "../../../bindings.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointFirmId,
  requireChokepointUserId,
} from "../../chokepoint/context-accessors.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { registerDownload } from "../../../downloads/download-register.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { Problem, problemJson } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";
import { resolveConversionProgress } from "../../../conversions/conversion-progress.ts";
import { resolveFirmBucket } from "../../../files/firm-bucket.ts";
import { presignerForEnv } from "../../../files/presigner-wiring.ts";
import { isWebSocketUpgrade, subscribeRequest } from "../../../progress/job-progress-sockets.ts";

// The four-route conversion surface: presign an upload slot, submit a job, poll its state, and
// subscribe to its state over a WebSocket. All four are firm-scoped and traverse the same chokepoint
// under the tools:fileConverter permission. The source and result objects live in the firm R2 bucket
// under conversions/<firmId>/<jobId>/{source,result}; the ConversionJob DO (keyed firmId:jobId) is the
// serialization point for each job's lifecycle.
//
// The poll and the subscription resolve the job through the same function
// (conversions/conversion-progress.ts) and return the same object, so polling stays a complete
// fallback for a client that cannot hold a socket open rather than a second implementation that can
// drift from the pushed one.

const PRESIGN_TTL_SECONDS = 300;

const conversionMeta: RouteMeta = {
  operationId: "conversions.upload",
  surface: "app",
  authenticated: true,
  permission: "tools:fileConverter",
  // tools:fileConverter is a firm-scoped permission (not matter-rooted), so resource is "firm".
  resource: "firm",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

const ConversionUploadResponse = z
  .object({
    jobId: z.string(),
    uploadUrl: z.string(),
    // The headers the upload must carry. They are covered by the URL's signature, so an upload that
    // sends anything less is rejected by storage rather than landing an object nothing can classify.
    uploadHeaders: z.record(z.string(), z.string()),
    sourceKey: z.string(),
  })
  .openapi("ConversionUploadResponse");

const conversionUploadRoute = defineOpenAPIRoute(conversionMeta, {
  method: "post",
  path: "/api/v1/conversions/upload",
  description:
    "Mints a new conversion job slot and returns a short-lived presigned PUT URL the client " +
    "uploads the source file to directly (bytes never transit the Worker). After uploading, " +
    "submit the job with POST /api/v1/conversions.",
  responses: {
    200: {
      description: "A jobId, the presigned upload URL, and the source R2 key",
      content: { "application/json": { schema: ConversionUploadResponse } },
    },
    401: {
      description: "No valid session",
      content: { "application/problem+json": { schema: Problem } },
    },
    403: {
      description: "The session member lacks tools:fileConverter",
      content: { "application/problem+json": { schema: Problem } },
    },
    404: {
      description: "The firm is unreachable or the member is deactivated",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

const conversionSubmitMeta: RouteMeta = {
  operationId: "conversions.submit",
  surface: "app",
  authenticated: true,
  permission: "tools:fileConverter",
  resource: "firm",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

const ConversionSubmitRequest = z
  .object({
    jobId: z.string().min(1),
    sourceKey: z.string().min(1),
    from: z.string().min(1),
    to: z.string().min(1),
  })
  .openapi("ConversionSubmitRequest");

const ConversionSubmitResponse = z
  .object({ jobId: z.string(), status: z.literal("queued") })
  .openapi("ConversionSubmitResponse");

const conversionSubmitRoute = defineOpenAPIRoute(conversionSubmitMeta, {
  method: "post",
  path: "/api/v1/conversions",
  description:
    "Submits a file conversion job. The client must have already uploaded the source file using " +
    "the URL from POST /api/v1/conversions/upload. Returns 422 if no conversion path exists " +
    "between the specified formats. Returns 202 with status queued when the job is accepted.",
  request: {
    body: { content: { "application/json": { schema: ConversionSubmitRequest } }, required: true },
  },
  responses: {
    202: {
      description: "The job was accepted and is now queued for conversion",
      content: { "application/json": { schema: ConversionSubmitResponse } },
    },
    401: {
      description: "No valid session",
      content: { "application/problem+json": { schema: Problem } },
    },
    403: {
      description: "The session member lacks tools:fileConverter",
      content: { "application/problem+json": { schema: Problem } },
    },
    404: {
      description: "The firm is unreachable or the member is deactivated",
      content: { "application/problem+json": { schema: Problem } },
    },
    422: {
      description: "The requested format conversion is not supported (no conversion path found)",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

const conversionStatusMeta: RouteMeta = {
  operationId: "conversions.status",
  surface: "app",
  authenticated: true,
  permission: "tools:fileConverter",
  resource: "firm",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

const ConversionStatusResponse = z
  .object({
    status: z.string(),
    url: z.string().optional(),
    mediaType: z.string().optional(),
    reason: z.string().optional(),
  })
  .openapi("ConversionStatus");

const conversionStatusRoute = defineOpenAPIRoute(conversionStatusMeta, {
  method: "get",
  path: "/api/v1/conversions/{jobId}",
  description:
    "Returns the current state of a conversion job. A done job whose R2 result still exists " +
    "carries a freshly minted, short-lived signed GET URL and the converted file media type. " +
    "A done job whose result was reaped reports expired. Running or failed jobs carry no URL.",
  request: { params: z.object({ jobId: z.string().min(1) }) },
  responses: {
    200: {
      description: "The job's current state; a done job includes a presigned URL and media type",
      content: { "application/json": { schema: ConversionStatusResponse } },
    },
    401: {
      description: "No valid session",
      content: { "application/problem+json": { schema: Problem } },
    },
    403: {
      description: "The session member lacks tools:fileConverter",
      content: { "application/problem+json": { schema: Problem } },
    },
    404: {
      description: "The firm is unreachable or the member is deactivated",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

const conversionEventsMeta: RouteMeta = {
  operationId: "conversions.events",
  surface: "app",
  authenticated: true,
  permission: "tools:fileConverter",
  resource: "firm",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

const conversionEventsRoute = defineOpenAPIRoute(conversionEventsMeta, {
  method: "get",
  path: "/api/v1/conversions/{jobId}/events",
  description:
    "Subscribes to a conversion job over a WebSocket. The server sends the job's current state on " +
    "connect and again on every transition (queued, running, done, failed, expired); each frame is " +
    '{ "type": "state", "protocolVersion": 1, "state": { … } } where state is the same object the ' +
    "poll endpoint returns, so a done job carries a freshly minted, short-lived signed URL and the " +
    'converted file media type. The client may send { "type": "resync" } to be re-sent the current ' +
    'state and { "type": "ping" } for a keepalive. A settled job is pushed once and the socket then ' +
    "closes. Requires an Upgrade: websocket request; the poll endpoint is the equivalent answer for " +
    "a client that cannot upgrade.",
  request: { params: z.object({ jobId: z.string().min(1) }) },
  responses: {
    101: { description: "The subscription is open; job state follows as WebSocket frames" },
    401: {
      description: "No valid session",
      content: { "application/problem+json": { schema: Problem } },
    },
    403: {
      description: "The session member lacks tools:fileConverter",
      content: { "application/problem+json": { schema: Problem } },
    },
    404: {
      description: "The firm is unreachable or the member is deactivated",
      content: { "application/problem+json": { schema: Problem } },
    },
    426: {
      description: "The request did not ask to upgrade to a WebSocket",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

type ConversionsApp = OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>;

export function registerConversionRoutes(app: ConversionsApp, chokepoint: Chokepoint): void {
  // Route A — mint a job slot and return a presigned PUT URL for the source file.
  app.openapi(
    {
      ...conversionUploadRoute,
      middleware: chokepointMiddleware(chokepoint, conversionUploadRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const firmId = requireChokepointFirmId(c);
      const { bucketName } = resolveFirmBucket(c.env, firm.bucketName);
      const jobId = newIdentifier("conversionJob");
      const sourceKey = `conversions/${firmId}/${jobId}/source`;
      const presigned = await presignerForEnv(c.env).presignPut(
        bucketName,
        sourceKey,
        "application/octet-stream",
        PRESIGN_TTL_SECONDS,
        firmScopedObjectDimensions("conversion-artifact"),
      );
      return c.json(
        { jobId, uploadUrl: presigned.url, uploadHeaders: presigned.headers, sourceKey },
        200,
      );
    },
  );

  // Route B — validate the format pair and submit the queued job to the DO + queue.
  app.openapi(
    {
      ...conversionSubmitRoute,
      middleware: chokepointMiddleware(chokepoint, conversionSubmitRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const firmId = requireChokepointFirmId(c);
      const { jobId, from, to } = c.req.valid("json");

      // Reject unknown formats or pairs with no conversion path — the client asked for something
      // the registry cannot satisfy.
      if (getFormat(from) === undefined || getFormat(to) === undefined || !findPath(from, to).ok) {
        return problemJson(c, {
          type: "unsupported-conversion",
          title: "Conversion not supported",
          status: 422,
          detail: `No conversion path from "${from}" to "${to}".`,
        });
      }

      // Pin both keys server-side from the session firm id and the client-supplied job id: the
      // body's sourceKey field is ignored to prevent a caller from supplying a key outside their
      // firm's prefix. The result key is constructed the same way for symmetry.
      const sourceKey = `conversions/${firmId}/${jobId}/source`;
      const resultKey = `conversions/${firmId}/${jobId}/result`;
      // The bucket the upload was presigned against travels with the job, so the consumer reads and
      // writes through the same seam this route resolved rather than re-deriving one of its own.
      const { bucketName } = resolveFirmBucket(c.env, firm.bucketName);
      const coordinator = c.env.CONVERSION_JOB.get(
        c.env.CONVERSION_JOB.idFromName(`${firmId}:${jobId}`),
      );
      await coordinator.start({ firmId, bucketName, jobId, sourceKey, resultKey, from, to });
      // The register learns about the work when it is SUBMITTED, not when it finishes: the result
      // key is already pinned above, and a member who asked for a conversion should see it on their
      // shelf while it runs rather than only once it lands. The poll below advances it to ready.
      const now = new Date();
      await commitEffectBatch(
        firm.firmDatabase,
        {
          statements: [
            registerDownload(firm.firmDatabase, {
              memberId: requireChokepointUserId(c),
              now,
              registration: {
                producer: "conversion",
                title: `Converted file (${from.toUpperCase()} to ${to.toUpperCase()})`,
                objectKey: resultKey,
                byteSize: null,
                building: true,
              },
            }).statement,
          ],
          outboxMessages: [],
        },
        { now: () => now.toISOString() },
      );
      return c.json({ jobId, status: "queued" as const }, 202);
    },
  );

  // Route C — poll the DO for the job state; on done, guard R2 before minting a signed URL.
  app.openapi(
    {
      ...conversionStatusRoute,
      middleware: chokepointMiddleware(chokepoint, conversionStatusRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const firmId = requireChokepointFirmId(c);
      const firmBucket = resolveFirmBucket(c.env, firm.bucketName);
      const { jobId } = c.req.valid("param");

      const coordinator = c.env.CONVERSION_JOB.get(
        c.env.CONVERSION_JOB.idFromName(`${firmId}:${jobId}`),
      );
      const progress = await resolveConversionProgress(
        c.env,
        firmBucket,
        await coordinator.status(),
      );
      // The first poll that sees the job done is what moves its register row off `building`. Keyed
      // on the result object rather than on a row id, so nothing has to travel through the Durable
      // Object's state; the update matches only a row still building, so later polls are no-ops.
      if (progress.status === "done") {
        const now = new Date().toISOString();
        await commitEffectBatch(
          firm.firmDatabase,
          {
            statements: [
              markDownloadItemReadyByObjectKeyStatement(
                firm.firmDatabase,
                requireChokepointUserId(c),
                `conversions/${firmId}/${jobId}/result`,
                null,
              ),
            ],
            outboxMessages: [],
          },
          { now: () => now },
        );
      }
      return c.json(progress, 200);
    },
  );

  // Route D — subscribe to the job over a WebSocket. The upgrade traverses the chokepoint like any
  // other route (session resolved, capability checked, coordinator addressed by the SESSION firm id)
  // and only then is the request handed to the object, which owns the 101. The request forwarded
  // inward is built here from server-derived values, so nothing the caller sent can influence which
  // bucket a pushed signed URL is minted against.
  app.openapi(
    {
      ...conversionEventsRoute,
      middleware: chokepointMiddleware(chokepoint, conversionEventsRoute),
    },
    async (c) => {
      if (!isWebSocketUpgrade(c.req.raw)) {
        return problemJson(c, {
          type: "websocket-upgrade-required",
          status: 426,
          title: "WebSocket upgrade required",
          detail:
            "This endpoint serves WebSocket subscriptions. Send Upgrade: websocket, or poll " +
            "/api/v1/conversions/{jobId} instead.",
        });
      }
      const firm = requireChokepointFirmContext(c);
      const firmId = requireChokepointFirmId(c);
      const { bucketName } = resolveFirmBucket(c.env, firm.bucketName);
      const { jobId } = c.req.valid("param");

      const coordinator = c.env.CONVERSION_JOB.get(
        c.env.CONVERSION_JOB.idFromName(`${firmId}:${jobId}`),
      );
      return coordinator.fetch(subscribeRequest(bucketName));
    },
  );
}
