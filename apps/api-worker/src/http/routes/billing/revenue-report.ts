import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { identifierField } from "@magna-carta/identifiers/field";
import {
  RevenueFigures,
  RevenueMatterTypeRow,
  RevenueOfficeRow,
  RevenueResponsibleAttorneyRow,
} from "@magna-carta/reporting/contract";
import { assembleRevenue } from "@magna-carta/reporting/financial/revenue";
import { ReportingValidationError } from "@magna-carta/reporting/reporting-validation";
import type { Bindings } from "../../../bindings.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import { requireChokepointFirmContext } from "../../chokepoint/context-accessors.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { Problem } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";
import { reportingRefusal } from "./financial-reports.ts";
import {
  civilDate,
  knowledgeInstant,
  ReportCompleteness,
  ReportReproducibility,
} from "./reports.ts";

// REVENUE — what was billed and what was collected in a period, by office, by matter type and by
// responsible attorney. A GET on `reports:financial`, over the same period and optional knowledge
// instant as the Invoices and Payments Applied reports, whose figures it re-groups. The office is a
// filter on the rows and never a gate on who may run the report.

const revenueQuery = z.object({
  periodStart: civilDate,
  periodEnd: civilDate,
  // Omitted, the report covers everything known now: stamped, and not claimed to reproduce.
  knownAsOf: knowledgeInstant.optional(),
  locationId: identifierField("location").optional(),
});

const RevenueResponse = z
  .object({
    periodStart: z.string(),
    periodEnd: z.string(),
    locationId: z.string().nullable(),
    currency: z.literal("USD"),
    reproducibility: ReportReproducibility,
    reproducibilityStatement: z.string(),
    attributionStatement: z.string(),
    completeness: ReportCompleteness,
    totals: RevenueFigures,
    offices: z.array(RevenueOfficeRow),
    matterTypes: z.array(RevenueMatterTypeRow),
    responsibleAttorneys: z.array(RevenueResponsibleAttorneyRow),
  })
  .openapi("RevenueReport");

const revenueMeta: RouteMeta = {
  operationId: "reports.revenue",
  surface: "app",
  authenticated: true,
  permission: "reports:financial",
  resource: "firm",
  // A read audits nothing: it changes nothing a firm could later need to reconstruct.
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

const revenueRoute = defineOpenAPIRoute(revenueMeta, {
  method: "get",
  path: "/api/v1/reports/revenue",
  description:
    "What was billed and what was collected in a period, by office, by matter type and by responsible attorney. Billed is every bill issued in the period, as the Invoices report counts it. Collected is payments, transfers from trust and client credits applied to bills in the period, less any reversal of them; credit notes and write-offs are shown beside it as credited and never counted as collected. Each matter's money is counted under the type and responsible attorney the matter has now. Give a knowledge instant and every figure re-derives from records that can never change; omit it and the answer covers everything known now, which is stamped and not claimed to reproduce. Choosing an office narrows the rows; it does not limit who may run the report.",
  request: { query: revenueQuery },
  responses: {
    200: {
      description: "What was billed and collected in this period",
      content: { "application/json": { schema: RevenueResponse } },
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
      description:
        "The period is not two calendar dates or ends before it starts, the knowledge instant is not a UTC instant or is in the future, or more was billed or applied than one report can list",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

type ReportsApp = OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>;

export function registerRevenueReportRoutes(app: ReportsApp, chokepoint: Chokepoint): void {
  app.openapi(
    { ...revenueRoute, middleware: chokepointMiddleware(chokepoint, revenueRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const query = c.req.valid("query");
      // Read per request, so a long-lived isolate cannot freeze it.
      const computedAt = new Date().toISOString();
      try {
        const report = await assembleRevenue(
          firm.firmDatabase,
          {
            periodStart: query.periodStart,
            periodEnd: query.periodEnd,
            knownAsOf: query.knownAsOf ?? null,
            locationId: query.locationId ?? null,
          },
          { computedAt },
        );
        // The report's arrays are `readonly` and the contract's are not; the response schema is what
        // the contract asserts, and the conformance suite checks it against the emitted document.
        return c.json(report as unknown as z.infer<typeof RevenueResponse>, 200);
      } catch (caught) {
        if (caught instanceof ReportingValidationError) return reportingRefusal(c, caught);
        throw caught;
      }
    },
  );
}
