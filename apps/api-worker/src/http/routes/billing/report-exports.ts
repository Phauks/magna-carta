import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { runConversion, type EngineResolver } from "@magna-carta/conversion/execute";
import { composeTabularDocument } from "@magna-carta/document-assembly/compose/tabular";
import { renderableTabularDocumentSchema } from "@magna-carta/export-document/renderable";
import type { Bindings } from "../../../bindings.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { resolveEnginePort } from "../../../conversions/conversion-engine.ts";
import { Problem, problemJson } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";

const DOCX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PDF_MEDIA_TYPE = "application/pdf";

const ExportRenderRequest = z
  .object({
    format: z.enum(["docx", "pdf"]),
    document: renderableTabularDocumentSchema,
  })
  .openapi("ExportRenderRequest");

// A printer, not a data source: the caller sends the tabular document it already holds (its bounds
// are the schema's), the platform composes a plain word-processing package through document
// assembly's guarded writer, and the PDF arm rides the registry's one docx-to-pdf edge. Nothing is
// stored — filing an export would be a separate, audited decision. Spec:
// docs/specs/2026-08-31-tabular-export-rendering-design.md.
export const reportExportRenderMeta: RouteMeta = {
  operationId: "reports.exportRender",
  surface: "app",
  authenticated: true,
  permission: "reports:export",
  resource: "firm",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

export const reportExportRenderRoute = defineOpenAPIRoute(reportExportRenderMeta, {
  method: "post",
  path: "/api/v1/reports/exports",
  description:
    "Read-shaped POST: renders the tabular export document in the request into a file and returns its bytes — a Word document composed by the platform, or that document carried across the office suite's conversion edge as a PDF. Pure computation over the caller's own payload; nothing is stored.",
  request: {
    body: { content: { "application/json": { schema: ExportRenderRequest } }, required: true },
  },
  responses: {
    200: {
      description: "The rendered file's bytes, content-typed for the requested format",
      content: { "application/octet-stream": { schema: z.any() } },
    },
    401: {
      description: "No valid session",
      content: { "application/problem+json": { schema: Problem } },
    },
    403: {
      description: "Authenticated, but the member lacks reports:export",
      content: { "application/problem+json": { schema: Problem } },
    },
    422: {
      description: "The document is past the render bounds, or the conversion has no path",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/problem+json": { schema: Problem } },
    },
    503: {
      description:
        "The office-suite engine is not available right now — deployed but warming, faulted, or absent from this environment. Retry.",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

export function registerReportExportRoutes(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  chokepoint: Chokepoint,
  // The engine Container cannot run under the local test pool, so the resolver is injectable on the
  // same terms the assembly consumer takes it.
  resolveEngines: (env: Bindings) => EngineResolver = resolveEnginePort,
): void {
  app.openapi(
    {
      ...reportExportRenderRoute,
      middleware: chokepointMiddleware(chokepoint, reportExportRenderRoute),
    },
    async (c) => {
      const { format, document } = c.req.valid("json");
      const composed = composeTabularDocument(document);
      if (format === "docx") {
        return c.body(composed.slice().buffer, 200, { "content-type": DOCX_MEDIA_TYPE });
      }
      const converted = await runConversion("docx", "pdf", composed, resolveEngines(c.env));
      if (!converted.ok) {
        if (converted.reason === "unsupported-edge") {
          return problemJson(c, {
            type: "unsupported-conversion",
            title: "No conversion path",
            status: 422,
            detail: "The requested conversion has no path in the registry.",
          });
        }
        // Deployed-but-warming, faulted, or an environment without the engine: the caller can act
        // on "try again shortly"; an Error ID for an engine that is warming is the failure mode the
        // template-scan precedent exists to prevent.
        return problemJson(c, {
          type: "service-unavailable",
          title: "Document engine unavailable",
          status: 503,
          detail: "The office-suite engine is not available right now. Try again shortly.",
        });
      }
      return c.body(converted.bytes.slice().buffer, 200, { "content-type": PDF_MEDIA_TYPE });
    },
  );
}
