import { z, type OpenAPIHono } from "@hono/zod-openapi";
import {
  createMetadataPort,
  MAX_INPUT_BYTES,
  SCRUB_ALL,
  type ScrubOptions,
} from "@magna-carta/metadata";
import type { Bindings } from "../../../bindings.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { Problem, problemJson, type ProblemResponse } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";

// Base64 grows by four bytes for every three encoded, plus padding. A body longer than this cannot
// decode to a file the tool would accept, so it is refused on the request schema — before the decode
// allocates the binary string and the byte array behind it.
const MAX_CONTENT_BASE64_LENGTH = Math.ceil(MAX_INPUT_BYTES / 3) * 4 + 4;
const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;

// Base64 -> bytes. Returns undefined for input the decoder rejects (a well-formed-looking string can
// still have an impossible length), so a bad upload is answered as an unreadable file rather than
// escaping as an unhandled error.
function decodeBase64(value: string): Uint8Array | undefined {
  let binary: string;
  try {
    binary = atob(value);
  } catch {
    return undefined;
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

const ScrubOptionsSchema = z
  .object({
    identifyingMetadata: z.boolean(),
    trackedChanges: z.boolean(),
    comments: z.boolean(),
    hiddenContent: z.boolean(),
    customProperties: z.boolean(),
    imageMetadata: z.boolean(),
  })
  .openapi("MetadataScrubOptions");

const FindingSchema = z.object({
  category: z.string(),
  label: z.string(),
  risk: z.enum(["high", "medium", "low"]),
  count: z.number(),
  defaultScrub: z.boolean(),
});

const ReportSchema = z
  .object({
    format: z.string(),
    findings: z.array(FindingSchema),
    clean: z.boolean(),
  })
  .openapi("MetadataReport");

const InspectRequest = z.object({
  filename: z.string().min(1).max(512),
  contentBase64: z.string().min(1).max(MAX_CONTENT_BASE64_LENGTH).regex(BASE64_PATTERN),
});
const ScrubRequest = InspectRequest.extend({ options: ScrubOptionsSchema.optional() });

const ScrubResponse = z
  .object({
    mediaType: z.string(),
    filename: z.string(),
    cleanedBase64: z.string(),
    report: ReportSchema,
  })
  .openapi("MetadataScrubResult");

// Map a typed failure to a 400 problem. The reason is a stable code; no file content is echoed.
function failureProblem(
  c: Parameters<typeof problemJson>[0],
  reason: string,
): ProblemResponse<400> {
  const title =
    reason === "too-large"
      ? "The file is too large for this tool"
      : reason === "unsupported-format"
        ? "Unsupported file type"
        : reason === "decompression-bomb"
          ? "The file could not be processed safely"
          : "The file could not be read";
  return problemJson(c, {
    type: "validation",
    status: 400,
    title,
    detail: `The metadata tool could not process this file (${reason}).`,
  });
}

const baseMeta = {
  surface: "app",
  authenticated: true,
  permission: "tools:metadataScrubber",
  resource: "firm",
  audited: false,
  idempotency: "optional",
  rateLimit: "expensive",
} as const satisfies Omit<RouteMeta, "operationId">;

export const metadataInspectMeta: RouteMeta = { ...baseMeta, operationId: "metadata.inspect" };
export const metadataScrubMeta: RouteMeta = { ...baseMeta, operationId: "metadata.scrub" };

const inspectRoute = defineOpenAPIRoute(metadataInspectMeta, {
  method: "post",
  path: "/api/v1/metadata/inspect",
  description:
    "Inspect an uploaded file (base64) and report the metadata and content-bearing artifacts it " +
    "carries, with a risk level per category. Nothing is stored.",
  request: {
    body: { content: { "application/json": { schema: InspectRequest } }, required: true },
  },
  responses: {
    200: {
      description: "Metadata report",
      content: { "application/json": { schema: ReportSchema } },
    },
    400: {
      description: "Unprocessable file",
      content: { "application/problem+json": { schema: Problem } },
    },
    401: {
      description: "No valid session",
      content: { "application/problem+json": { schema: Problem } },
    },
    403: {
      description: "Missing tools:metadataScrubber",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

const scrubRoute = defineOpenAPIRoute(metadataScrubMeta, {
  method: "post",
  path: "/api/v1/metadata/scrub",
  description:
    "Return a cleaned copy (base64) of an uploaded file with the selected metadata and content " +
    "artifacts removed, plus a re-inspection of the result. Defaults to removing everything. Nothing is stored.",
  request: { body: { content: { "application/json": { schema: ScrubRequest } }, required: true } },
  responses: {
    200: {
      description: "Cleaned file + report",
      content: { "application/json": { schema: ScrubResponse } },
    },
    400: {
      description: "Unprocessable file",
      content: { "application/problem+json": { schema: Problem } },
    },
    401: {
      description: "No valid session",
      content: { "application/problem+json": { schema: Problem } },
    },
    403: {
      description: "Missing tools:metadataScrubber",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

export function registerMetadataRoutes(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  chokepoint: Chokepoint,
): void {
  const port = createMetadataPort();

  app.openapi(
    { ...inspectRoute, middleware: chokepointMiddleware(chokepoint, inspectRoute) },
    async (c) => {
      const { filename, contentBase64 } = c.req.valid("json");
      const bytes = decodeBase64(contentBase64);
      if (bytes === undefined) return failureProblem(c, "corrupt");
      const outcome = await port.inspect({ bytes, filename });
      if (!outcome.ok) return failureProblem(c, outcome.reason);
      // MetadataReport uses readonly arrays; the response schema expects mutable arrays.
      return c.json(
        {
          format: outcome.report.format,
          findings: [...outcome.report.findings],
          clean: outcome.report.clean,
        },
        200,
      );
    },
  );

  app.openapi(
    { ...scrubRoute, middleware: chokepointMiddleware(chokepoint, scrubRoute) },
    async (c) => {
      const { filename, contentBase64, options } = c.req.valid("json");
      const effective: ScrubOptions = options ?? SCRUB_ALL;
      const bytes = decodeBase64(contentBase64);
      if (bytes === undefined) return failureProblem(c, "corrupt");
      const outcome = await port.scrub({ bytes, filename }, effective);
      if (!outcome.ok) return failureProblem(c, outcome.reason);
      // MetadataReport uses readonly arrays; the response schema expects mutable arrays.
      return c.json(
        {
          mediaType: outcome.mediaType,
          filename,
          cleanedBase64: encodeBase64(outcome.bytes),
          report: {
            format: outcome.report.format,
            findings: [...outcome.report.findings],
            clean: outcome.report.clean,
          },
        },
        200,
      );
    },
  );
}
