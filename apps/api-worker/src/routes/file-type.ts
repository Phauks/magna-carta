import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { buildFileTypeReport, type RawIdentifyResult } from "@magna-carta/file-type";
import { readInspectableSizeCap } from "@magna-carta/file-manager/upload-policy";
import type { Bindings } from "../bindings.ts";
import type { Chokepoint } from "../chokepoint/chokepoint.ts";
import { requireChokepointFirmContext } from "../chokepoint/context-accessors.ts";
import type { AppVariables } from "../chokepoint/ports.ts";
import { chokepointMiddleware } from "../chokepoint/register.ts";
import { Problem, problemJson } from "../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../contracts/route-meta.ts";

export const fileTypeVerifyMeta: RouteMeta = {
  operationId: "fileType.verify",
  surface: "app",
  authenticated: true,
  permission: "tools:fileTypeVerifier",
  resource: "firm",
  audited: false,
  idempotency: "optional",
  rateLimit: "expensive",
};

// The Container's raw identification facts, validated at the trust boundary before we map them.
const rawIdentifySchema = z.object({
  label: z.string(),
  score: z.number(),
  group: z.string(),
  magikaVersion: z.string(),
  modelVersion: z.string(),
}) satisfies z.ZodType<RawIdentifyResult>;

const ReportSchema = z.object({
  detected: z.string().nullable(),
  detectedLabel: z.string(),
  group: z.string(),
  confidence: z.number(),
  claimedExtension: z.string().nullable(),
  extensionMatch: z.enum(["match", "mismatch", "unverifiable", "no-extension"]),
  recommendedExtensions: z.array(z.string()).readonly(),
  note: z.string(),
});

const verifyRoute = defineOpenAPIRoute(fileTypeVerifyMeta, {
  method: "post",
  path: "/api/v1/file-type/verify",
  description:
    "Identify an uploaded file's true content type from its bytes, compare it to the extension the " +
    "filename claims, and recommend an extension when it is missing or wrong. Nothing is stored.",
  request: {
    query: z.object({ filename: z.string().min(1) }),
    body: { content: { "application/octet-stream": { schema: z.any() } }, required: true },
  },
  responses: {
    200: {
      description: "File type report",
      content: { "application/json": { schema: ReportSchema } },
    },
    400: {
      description: "Empty request body",
      content: { "application/problem+json": { schema: Problem } },
    },
    401: {
      description: "No valid session",
      content: { "application/problem+json": { schema: Problem } },
    },
    403: {
      description: "Missing tools:fileTypeVerifier",
      content: { "application/problem+json": { schema: Problem } },
    },
    413: {
      description: "File exceeds the inspectable-size cap",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/problem+json": { schema: Problem } },
    },
    503: {
      description: "Identification engine unavailable",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

export function registerFileTypeRoutes(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  chokepoint: Chokepoint,
): void {
  app.openapi(
    { ...verifyRoute, middleware: chokepointMiddleware(chokepoint, verifyRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { filename } = c.req.valid("query");
      const body = c.req.raw.body;
      if (body === null) {
        return problemJson(c, {
          type: "validation",
          title: "Empty body",
          status: 400,
          detail: "Provide the file bytes as the request body.",
        });
      }
      const sizeBytes = Number(c.req.header("content-length") ?? "0");
      const cap = await readInspectableSizeCap(firm.firmDatabase);
      if (sizeBytes > cap) {
        await body.cancel();
        return problemJson(c, {
          type: "upload-not-allowed",
          title: "File too large to identify inline",
          status: 413,
          detail: `The file exceeds this firm's inspectable-size cap (${cap} bytes).`,
        });
      }
      const scan = c.env.SCAN_SERVICE;
      if (scan === undefined) {
        return problemJson(c, {
          type: "service-unavailable",
          title: "Identification engine unavailable",
          status: 503,
          detail: "The identification engine is not currently reachable. Try again shortly.",
        });
      }
      const response = await scan.fetch(
        new Request(`http://scan/identify`, {
          method: "POST",
          body,
          duplex: "half",
        } as RequestInit & { duplex: "half" }),
      );
      if (response.status !== 200) {
        return problemJson(c, {
          type: "service-unavailable",
          title: "Identification failed",
          status: 503,
          detail: "The identification engine returned an error. Try again shortly.",
        });
      }
      const raw = rawIdentifySchema.parse(await response.json());
      return c.json(buildFileTypeReport(raw, filename), 200);
    },
  );
}
