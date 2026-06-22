import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { findPath } from "@magna-carta/conversion/pathfinding";
import { getFormat } from "@magna-carta/conversion/registry";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { Bindings } from "../app.ts";
import type { Chokepoint } from "../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointFirmId,
} from "../chokepoint/context-accessors.ts";
import type { AppVariables } from "../chokepoint/ports.ts";
import { chokepointMiddleware } from "../chokepoint/register.ts";
import { Problem, problemJson } from "../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../contracts/route-meta.ts";
import { presignerForEnv } from "../files/presigner-wiring.ts";
import { requireBucket } from "../files/require-bucket.ts";

// The three-route conversion surface: presign an upload slot, submit a job, and poll its state.
// All three are firm-scoped and traverse the same chokepoint under the tools:fileConverter permission.
// The source and result objects live in the firm R2 bucket under conversions/<firmId>/<jobId>/{source,result};
// the ConversionJob DO (keyed firmId:jobId) is the serialization point for each job's lifecycle.

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
  .object({ jobId: z.string(), uploadUrl: z.string(), sourceKey: z.string() })
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
      const bucket = requireBucket(firm.bucketName);
      const jobId = newIdentifier("conversionJob");
      const sourceKey = `conversions/${firmId}/${jobId}/source`;
      const uploadUrl = await presignerForEnv(c.env).presignPut(
        bucket,
        sourceKey,
        "application/octet-stream",
        PRESIGN_TTL_SECONDS,
      );
      return c.json({ jobId, uploadUrl, sourceKey }, 200);
    },
  );

  // Route B — validate the format pair and submit the queued job to the DO + queue.
  app.openapi(
    {
      ...conversionSubmitRoute,
      middleware: chokepointMiddleware(chokepoint, conversionSubmitRoute),
    },
    async (c) => {
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
      const coordinator = c.env.CONVERSION_JOB.get(
        c.env.CONVERSION_JOB.idFromName(`${firmId}:${jobId}`),
      );
      await coordinator.start({ firmId, jobId, sourceKey, resultKey, from, to });
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
      const bucket = requireBucket(firm.bucketName);
      const { jobId } = c.req.valid("param");

      const coordinator = c.env.CONVERSION_JOB.get(
        c.env.CONVERSION_JOB.idFromName(`${firmId}:${jobId}`),
      );
      const state = await coordinator.status();

      if (state.status === "done" && state.resultKey !== null) {
        // Guard against a reaped result: the DO keeps reporting `done` with a stale resultKey after
        // the R2 lifecycle rule expires the object. HEAD it first; if gone, report `expired` so the
        // client knows the result is no longer available.
        const artifact = await c.env.R2.head(state.resultKey);
        if (artifact !== null) {
          const url = await presignerForEnv(c.env).presignGet(
            bucket,
            state.resultKey,
            PRESIGN_TTL_SECONDS,
          );
          return c.json({ status: "done", url, mediaType: state.mediaType ?? undefined }, 200);
        }
        return c.json({ status: "expired" }, 200);
      }
      return c.json({ status: state.status, reason: state.reason ?? undefined }, 200);
    },
  );
}
