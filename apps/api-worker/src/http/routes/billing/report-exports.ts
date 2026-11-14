import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { composeTabularDocument } from "@magna-carta/document-assembly/compose/tabular";
import { renderableTabularDocumentSchema } from "@magna-carta/export-document/renderable";
import type { Bindings } from "../../../bindings.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { Problem } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";

const DOCX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const ExportRenderRequest = z
  .object({
    format: z.enum(["docx"]),
    document: renderableTabularDocumentSchema,
  })
  .openapi("ExportRenderRequest");

// A printer, not a data source: the caller sends the tabular document it already holds (its bounds
// are the schema's) and the platform composes a plain word-processing package through document
// assembly's guarded writer. Nothing is stored; filing an export would be a separate, audited
// decision.
//
// WORD ONLY. A tabular export's PDF is composed in the browser by the platform's PDF composer
// (apps/web/src/lib/export/render-pdf.ts over @magna-carta/pdf-compose), the one way such a PDF is
// made. This route used to carry a second, the Word document across the office suite's conversion
// edge; it no longer does, and `format` keeps its one value so a later format is a new member
// rather than a new route.
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
    "Read-shaped POST: renders the tabular export document in the request into a Word document and returns its bytes. A tabular export's PDF is composed in the browser by the platform's PDF composer, not here. Pure computation over the caller's own payload; nothing is stored.",
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
      description: "The document is past the render bounds, or asks for a format other than Word",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

export function registerReportExportRoutes(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  chokepoint: Chokepoint,
): void {
  app.openapi(
    {
      ...reportExportRenderRoute,
      middleware: chokepointMiddleware(chokepoint, reportExportRenderRoute),
    },
    (c) => {
      const { document } = c.req.valid("json");
      const composed = composeTabularDocument(document);
      return c.body(composed.slice().buffer, 200, { "content-type": DOCX_MEDIA_TYPE });
    },
  );
}
