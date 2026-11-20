import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { identifierField } from "@magna-carta/identifiers/field";
import { RevenueFigures, WorkByReferrerSourceRow } from "@magna-carta/reporting/contract";
import { assembleWorkByReferrer } from "@magna-carta/reporting/financial/work-by-referrer";
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

// WORK BY REFERRER — which sources and people send the firm its work, and what that work billed and
// collected. A GET on `reports:financial` over the Revenue report's period and optional knowledge
// instant: the same money, grouped by each bill's client's referral instead of by office, matter type
// and attorney. The office is a filter on the rows and never a gate on who may run the report.

const workByReferrerQuery = z.object({
  periodStart: civilDate,
  periodEnd: civilDate,
  // Omitted, the report covers everything known now: stamped, and not claimed to reproduce.
  knownAsOf: knowledgeInstant.optional(),
  locationId: identifierField("location").optional(),
});

const WorkByReferrerResponse = z
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
    sources: z.array(WorkByReferrerSourceRow),
  })
  .openapi("WorkByReferrerReport");

const workByReferrerMeta: RouteMeta = {
  operationId: "reports.workByReferrer",
  surface: "app",
  authenticated: true,
  permission: "reports:financial",
  resource: "firm",
  // A read audits nothing: it changes nothing a firm could later need to reconstruct.
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

const workByReferrerRoute = defineOpenAPIRoute(workByReferrerMeta, {
  method: "get",
  path: "/api/v1/reports/work-by-referrer",
  description:
    "What was billed and collected in a period, grouped by how each bill's client found the firm: by the source on the firm's list, then by the person or organization who referred them. Clients with a referrer and no source, and clients with nothing recorded, stand in groups of their own, so the totals are the Revenue report's for the same period. Each client's money is counted under the referral the client has now. Give a knowledge instant and every figure re-derives from records that can never change; omit it and the answer covers everything known now, which is stamped and not claimed to reproduce. Choosing an office narrows the rows; it does not limit who may run the report.",
  request: { query: workByReferrerQuery },
  responses: {
    200: {
      description: "What each source and referrer's clients were billed and paid in this period",
      content: { "application/json": { schema: WorkByReferrerResponse } },
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

export function registerWorkByReferrerReportRoutes(app: ReportsApp, chokepoint: Chokepoint): void {
  app.openapi(
    { ...workByReferrerRoute, middleware: chokepointMiddleware(chokepoint, workByReferrerRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const query = c.req.valid("query");
      // Read per request, so a long-lived isolate cannot freeze it.
      const computedAt = new Date().toISOString();
      try {
        const report = await assembleWorkByReferrer(
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
        return c.json(report as unknown as z.infer<typeof WorkByReferrerResponse>, 200);
      } catch (caught) {
        if (caught instanceof ReportingValidationError) return reportingRefusal(c, caught);
        throw caught;
      }
    },
  );
}
