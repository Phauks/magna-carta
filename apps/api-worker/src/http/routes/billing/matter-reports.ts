import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { identifierField } from "@magna-carta/identifiers/field";
import {
  MatterListOfficeRow,
  MatterListRow,
  MatterStatusCounts,
} from "@magna-carta/reporting/contract";
import { assembleMattersList } from "@magna-carta/reporting/operational/matters-list";
import { ReportingValidationError } from "@magna-carta/reporting/reporting-validation";
import type { Bindings } from "../../../bindings.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import { requireChokepointFirmContext } from "../../chokepoint/context-accessors.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { Problem } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";
import { reportingRefusal } from "./financial-reports.ts";
import { ReportCompleteness } from "./reports.ts";

// THE MATTERS LIST — every matter the firm has opened, as a list, with how many are open, on hold and
// closed per office. A GET on `reports:operational`: it is a report about the firm's work, not its
// money. The office is a filter on the rows and never a gate on who may run the report.

// Deliberately no date and no knowledge instant: a matter is a mutable record, so accepting one would
// answer a question about the past with a list about the present.
const mattersListQuery = z.object({ locationId: identifierField("location").optional() });

const MattersListResponse = z
  .object({
    computedAt: z.string(),
    reproducible: z.literal(false),
    statement: z.string(),
    locationId: z.string().nullable(),
    completeness: ReportCompleteness,
    totals: MatterStatusCounts,
    offices: z.array(MatterListOfficeRow),
    matters: z.array(MatterListRow),
  })
  .openapi("MattersListReport");

const mattersListMeta: RouteMeta = {
  operationId: "reports.mattersList",
  surface: "app",
  authenticated: true,
  permission: "reports:operational",
  resource: "firm",
  // A read audits nothing: it changes nothing a firm could later need to reconstruct.
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

const mattersListRoute = defineOpenAPIRoute(mattersListMeta, {
  method: "get",
  path: "/api/v1/reports/matters-list",
  description:
    "Every matter the firm has opened (open, on hold or closed), with its number, client, type, office, responsible attorney and when it opened and closed, and how many are open, on hold and closed per office. Intakes and consultations are not listed. A live report: it takes no date, says when it was computed, and is not claimed to reproduce. Choosing an office narrows the rows; it does not limit who may run the report.",
  request: { query: mattersListQuery },
  responses: {
    200: {
      description: "The firm's matters now",
      content: { "application/json": { schema: MattersListResponse } },
    },
    401: {
      description: "No valid session",
      content: { "application/problem+json": { schema: Problem } },
    },
    403: {
      description: "The session member lacks reports:operational",
      content: { "application/problem+json": { schema: Problem } },
    },
    404: {
      description: "The firm is unreachable or the member is deactivated",
      content: { "application/problem+json": { schema: Problem } },
    },
    422: {
      description: "The firm has more matters than one report can list",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

type ReportsApp = OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>;

export function registerMatterReportsRoutes(app: ReportsApp, chokepoint: Chokepoint): void {
  app.openapi(
    { ...mattersListRoute, middleware: chokepointMiddleware(chokepoint, mattersListRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const query = c.req.valid("query");
      // Read per request, so a long-lived isolate cannot freeze it.
      const computedAt = new Date().toISOString();
      try {
        const report = await assembleMattersList(
          firm.firmDatabase,
          { locationId: query.locationId ?? null },
          { computedAt },
        );
        return c.json(report as unknown as z.infer<typeof MattersListResponse>, 200);
      } catch (caught) {
        if (caught instanceof ReportingValidationError) return reportingRefusal(c, caught);
        throw caught;
      }
    },
  );
}
