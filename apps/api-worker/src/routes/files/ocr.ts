import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { readInspectableSizeCap } from "@magna-carta/file-manager/upload-policy";
import type { Bindings } from "../../bindings.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import { requireChokepointFirmContext } from "../../chokepoint/context-accessors.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { Problem, problemJson } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";

export const ocrRecognizeMeta: RouteMeta = {
  operationId: "ocr.recognize",
  surface: "app",
  authenticated: true,
  permission: "tools:ocr",
  resource: "firm",
  audited: false,
  idempotency: "optional",
  rateLimit: "expensive",
};

// Writing a searchable text layer is the same capability as recognition — it reads a scan and produces
// text, storing nothing — so it shares the `tools:ocr` permission and the recognize route's posture.
export const ocrSearchableMeta: RouteMeta = {
  operationId: "ocr.searchable",
  surface: "app",
  authenticated: true,
  permission: "tools:ocr",
  resource: "firm",
  audited: false,
  idempotency: "optional",
  rateLimit: "expensive",
};

const QuadSchema = z.object({
  points: z.array(z.array(z.number()).length(2)).length(4),
});

const TextLineSchema = z.object({
  text: z.string(),
  confidence: z.number(),
  quad: QuadSchema,
  orientationDegrees: z.number().nullable().optional(),
  wordQuads: z.array(QuadSchema),
});

const PageSchema = z.object({
  pageIndex: z.number().int(),
  lines: z.array(TextLineSchema),
  // Regions detection found but recognition could not read. Surfaced so a caller can tell a
  // page with no text from a page whose text was unreadable.
  undecodedRegions: z.number().int(),
  skipped: z.string().nullable().optional(),
  orientationDegrees: z.number().nullable().optional(),
});

const ResultSchema = z.object({
  pages: z.array(PageSchema),
  provenance: z.object({
    engineVersion: z.string(),
    modelVersion: z.string(),
    platform: z.string(),
  }),
});

// The engine's error body: a stable code distinguishing a permanently bad document from a
// transient engine fault. Validated at the trust boundary before it drives the response mapping.
const EngineErrorSchema = z.object({ code: z.string() });

const recognizeRoute = defineOpenAPIRoute(ocrRecognizeMeta, {
  method: "post",
  path: "/api/v1/ocr",
  description:
    "Recognize text in a scanned image or PDF. Returns per-page lines with word boxes, confidence, " +
    "and the engine and model that produced them. Pages that already carry a text layer are " +
    "reported as skipped rather than re-recognized. Nothing is stored.",
  request: {
    body: {
      content: { "application/octet-stream": { schema: z.any() } },
      required: true,
    },
  },
  responses: {
    200: {
      description: "Per-page recognition facts",
      content: { "application/json": { schema: ResultSchema } },
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
      description: "Missing tools:ocr",
      content: { "application/problem+json": { schema: Problem } },
    },
    413: {
      description: "File exceeds the inspectable-size cap",
      content: { "application/problem+json": { schema: Problem } },
    },
    422: {
      description: "The document is unreadable or was rejected outright — retrying will not help",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/problem+json": { schema: Problem } },
    },
    503: {
      description: "Recognition engine unavailable",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

const searchableRoute = defineOpenAPIRoute(ocrSearchableMeta, {
  method: "post",
  path: "/api/v1/ocr/searchable",
  description:
    "Recognize a scanned PDF and return it with an invisible text layer over every scanned page, so " +
    "the document becomes selectable and searchable with nothing new visible. Additive: a page that " +
    "already carries a text layer is left unchanged. PDF only. Nothing is stored.",
  request: {
    body: {
      content: { "application/octet-stream": { schema: z.any() } },
      required: true,
    },
  },
  responses: {
    200: {
      description: "The input PDF with an invisible, searchable text layer",
      content: { "application/pdf": { schema: z.string().openapi({ format: "binary" }) } },
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
      description: "Missing tools:ocr",
      content: { "application/problem+json": { schema: Problem } },
    },
    413: {
      description: "File exceeds the inspectable-size cap",
      content: { "application/problem+json": { schema: Problem } },
    },
    422: {
      description:
        "The document is not a PDF, is unreadable, or was rejected outright — retrying will not help",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/problem+json": { schema: Problem } },
    },
    503: {
      description: "Recognition engine unavailable",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

export function registerOcrRoutes(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  chokepoint: Chokepoint,
): void {
  app.openapi(
    {
      ...recognizeRoute,
      middleware: chokepointMiddleware(chokepoint, recognizeRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const body = c.req.raw.body;
      if (body === null) {
        return problemJson(c, {
          type: "validation",
          title: "Empty body",
          status: 400,
          detail: "Provide the document bytes as the request body.",
        });
      }
      const sizeBytes = Number(c.req.header("content-length") ?? "0");
      const cap = await readInspectableSizeCap(firm.firmDatabase);
      if (sizeBytes > cap) {
        await body.cancel();
        return problemJson(c, {
          type: "upload-not-allowed",
          title: "File too large to recognize inline",
          status: 413,
          detail: `The file exceeds this firm's inspectable-size cap (${cap} bytes).`,
        });
      }
      const ocr = c.env.OCR_SERVICE;
      if (ocr === undefined) {
        return problemJson(c, {
          type: "service-unavailable",
          title: "Recognition engine unavailable",
          status: 503,
          detail: "The recognition engine is not currently reachable. Try again shortly.",
        });
      }
      const response = await ocr.fetch(
        new Request("http://ocr/ocr", {
          method: "POST",
          body,
          duplex: "half",
        } as RequestInit & { duplex: "half" }),
      );
      if (response.status === 422) {
        // A permanently bad document (unreadable or rejected outright): a 503 here would invite an
        // endless client retry against bytes that will never parse. Map it to a 422 instead so the
        // caller stops retrying and surfaces the failure to the person who supplied the document.
        const engineError = EngineErrorSchema.safeParse(await response.json());
        return problemJson(c, {
          type: "validation",
          title: "Document unreadable",
          status: 422,
          detail:
            engineError.success && engineError.data.code === "document-rejected"
              ? "The recognition engine rejected this document outright."
              : "The recognition engine could not read this document.",
        });
      }
      if (response.status !== 200) {
        // Every other non-200 (including the engine's own 503 inference-failed) is a transient
        // fault. A fault is never dressed up as a page with no words.
        return problemJson(c, {
          type: "service-unavailable",
          title: "Recognition failed",
          status: 503,
          detail: "The recognition engine returned an error. Try again shortly.",
        });
      }
      return c.json(ResultSchema.parse(await response.json()), 200);
    },
  );

  app.openapi(
    {
      ...searchableRoute,
      middleware: chokepointMiddleware(chokepoint, searchableRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const body = c.req.raw.body;
      if (body === null) {
        return problemJson(c, {
          type: "validation",
          title: "Empty body",
          status: 400,
          detail: "Provide the PDF bytes as the request body.",
        });
      }
      const sizeBytes = Number(c.req.header("content-length") ?? "0");
      const cap = await readInspectableSizeCap(firm.firmDatabase);
      if (sizeBytes > cap) {
        await body.cancel();
        return problemJson(c, {
          type: "upload-not-allowed",
          title: "File too large to recognize inline",
          status: 413,
          detail: `The file exceeds this firm's inspectable-size cap (${cap} bytes).`,
        });
      }
      const ocr = c.env.OCR_SERVICE;
      if (ocr === undefined) {
        return problemJson(c, {
          type: "service-unavailable",
          title: "Recognition engine unavailable",
          status: 503,
          detail: "The recognition engine is not currently reachable. Try again shortly.",
        });
      }
      const response = await ocr.fetch(
        new Request("http://ocr/ocr/searchable", {
          method: "POST",
          body,
          duplex: "half",
        } as RequestInit & { duplex: "half" }),
      );
      if (response.status === 422) {
        // A permanently bad input (not a PDF, unreadable, or rejected outright): map to 422 so the
        // caller stops retrying bytes that will never parse, rather than a 503 that invites a loop.
        const engineError = EngineErrorSchema.safeParse(await response.json());
        return problemJson(c, {
          type: "validation",
          title: "Document unreadable",
          status: 422,
          detail:
            engineError.success && engineError.data.code === "not-a-pdf"
              ? "A searchable layer can only be written onto a PDF."
              : "The recognition engine could not read this document.",
        });
      }
      if (response.status !== 200) {
        return problemJson(c, {
          type: "service-unavailable",
          title: "Recognition failed",
          status: 503,
          detail: "The recognition engine returned an error. Try again shortly.",
        });
      }
      // Stream the searchable PDF straight back; the engine already produced the final bytes.
      return new Response(response.body, {
        status: 200,
        headers: {
          "content-type": "application/pdf",
          "content-disposition": 'inline; filename="searchable.pdf"',
        },
      });
    },
  );
}
