import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { identifierField } from "@magna-carta/identifiers/field";
import { MatterBillingGuideRow, MatterBillingKindCounts } from "@magna-carta/reporting/contract";
import { assembleMatterBillingGuide } from "@magna-carta/reporting/financial/matter-billing-guide";
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

// THE MATTER BILLING GUIDE — how every open and held matter is billed today: the fee agreement that
// governs the day, any amendment recorded to start later, and the rates recorded against the matter
// or its client. A GET on `reports:financial`: it states what the firm charges. The office is a
// filter on the rows and never a gate on who may run the report.

// Deliberately no date and no knowledge instant: matters, agreements and rate cards all change, so
// the report answers for the day it is produced.
const matterBillingGuideQuery = z.object({ locationId: identifierField("location").optional() });

const MatterBillingGuideResponse = z
  .object({
    computedAt: z.string(),
    asOfDate: z.string(),
    reproducible: z.literal(false),
    statement: z.string(),
    locationId: z.string().nullable(),
    completeness: ReportCompleteness,
    totals: MatterBillingKindCounts,
    matters: z.array(MatterBillingGuideRow),
  })
  .openapi("MatterBillingGuideReport");

const matterBillingGuideMeta: RouteMeta = {
  operationId: "reports.matterBillingGuide",
  surface: "app",
  authenticated: true,
  permission: "reports:financial",
  resource: "firm",
  // A read audits nothing: it changes nothing a firm could later need to reconstruct.
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

const matterBillingGuideRoute = defineOpenAPIRoute(matterBillingGuideMeta, {
  method: "get",
  path: "/api/v1/reports/matter-billing-guide",
  description:
    "How every open and held matter is billed today: the fee agreement in force on the day (hourly, flat fee, contingency or retainer, with its terms), any amendment already recorded to start later, and the hourly rates recorded against the matter itself or its client on the firm's rate cards in use. A matter with no agreement is listed with none, which means it bills hourly at the rates each timekeeper's own card gives. Counts matters by kind of agreement. A live report: it takes no date, answers for the UTC day it is produced, says when it was computed, and is not claimed to reproduce. Choosing an office narrows the rows; it does not limit who may run the report.",
  request: { query: matterBillingGuideQuery },
  responses: {
    200: {
      description: "How each open and held matter is billed today",
      content: { "application/json": { schema: MatterBillingGuideResponse } },
    },
    401: {
      description: "No valid session",
      content: { "application/problem+json": { schema: Problem } },
    },
    403: {
      description: "The session member lacks reports:financial",
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

export function registerBillingGuideReportRoutes(app: ReportsApp, chokepoint: Chokepoint): void {
  app.openapi(
    {
      ...matterBillingGuideRoute,
      middleware: chokepointMiddleware(chokepoint, matterBillingGuideRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const query = c.req.valid("query");
      // Read per request, so a long-lived isolate cannot freeze it.
      const computedAt = new Date().toISOString();
      try {
        const report = await assembleMatterBillingGuide(
          firm.firmDatabase,
          { locationId: query.locationId ?? null },
          { computedAt },
        );
        return c.json(report as unknown as z.infer<typeof MatterBillingGuideResponse>, 200);
      } catch (caught) {
        if (caught instanceof ReportingValidationError) return reportingRefusal(c, caught);
        throw caught;
      }
    },
  );
}
