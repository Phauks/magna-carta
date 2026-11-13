import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { identifierField } from "@magna-carta/identifiers/field";
import { assembleAccountsReceivableAging } from "@magna-carta/reporting/financial/accounts-receivable-aging";
import { ReportingValidationError } from "@magna-carta/reporting/reporting-validation";
import type { Bindings } from "../../../bindings.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import { requireChokepointFirmContext } from "../../chokepoint/context-accessors.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { Problem, problemJson } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";
import {
  civilDate,
  knowledgeInstant,
  ReportCompleteness,
  ReportReproducibility,
} from "./reports.ts";

// THE FINANCIAL REPORTS — what the firm is owed, what it has not billed, and what it realized.
//
// Every route here is a GET on `reports:financial`, which is seeded to Owner and Admin: an aggregate
// over every client's money is a different exposure from a per-matter read. The office is a filter on
// the rows and never a gate on who may run the report.

const FINANCIAL = "reports:financial" as const;

const agingQuery = z.object({
  asOfDate: civilDate,
  // Omitted, the report covers everything known now: stamped, and not claimed to reproduce.
  knownAsOf: knowledgeInstant.optional(),
  locationId: identifierField("location").optional(),
});

const AgingFigures = z.array(z.number().int()).length(5);

const AgingMatterRow = z.object({
  matterId: z.string(),
  matterTitle: z.string(),
  matterNumber: z.string().nullable(),
  locationId: z.string().nullable(),
  locationName: z.string().nullable(),
  unpaidMinor: AgingFigures,
  totalMinor: z.number().int(),
});

const AccountsReceivableAgingResponse = z
  .object({
    asOfDate: z.string(),
    locationId: z.string().nullable(),
    currency: z.literal("USD"),
    reproducibility: ReportReproducibility,
    reproducibilityStatement: z.string(),
    completeness: ReportCompleteness,
    totals: z.object({
      unpaidMinor: AgingFigures,
      totalMinor: z.number().int(),
      invoiceCount: AgingFigures.nullable(),
    }),
    offices: z.array(
      z.object({
        locationId: z.string().nullable(),
        locationName: z.string().nullable(),
        unpaidMinor: AgingFigures,
        totalMinor: z.number().int(),
      }),
    ),
    clients: z.array(
      z.object({
        clientEntityId: z.string(),
        clientName: z.string().nullable(),
        unpaidMinor: AgingFigures,
        totalMinor: z.number().int(),
        matters: z.array(AgingMatterRow),
      }),
    ),
  })
  .openapi("AccountsReceivableAgingReport");

const agingMeta: RouteMeta = {
  operationId: "reports.accountsReceivableAging",
  surface: "app",
  authenticated: true,
  permission: FINANCIAL,
  resource: "firm",
  // A read audits nothing: it changes nothing a firm could later need to reconstruct.
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

const agingRoute = defineOpenAPIRoute(agingMeta, {
  method: "get",
  path: "/api/v1/reports/accounts-receivable-aging",
  description:
    "What the firm was owed at a date, by how long it had been owed (current, 1 to 30, 31 to 60, 61 to 90 and over 90 days past due), per office, client and matter. Give a knowledge instant and every figure re-derives from records that can never change; omit it and the answer covers everything known now, which is stamped and not claimed to reproduce. A bill counts from its issue date; a payment, credit or write-off from its own effective date. Choosing an office narrows the rows; it does not limit who may run the report.",
  request: { query: agingQuery },
  responses: {
    200: {
      description: "The aging at that date",
      content: { "application/json": { schema: AccountsReceivableAgingResponse } },
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
        "The date is not a calendar date, the knowledge instant is not a UTC instant or is in the future, or more matters have something unpaid than one report can list",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

type ReportsApp = OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>;

export function registerFinancialReportsRoutes(app: ReportsApp, chokepoint: Chokepoint): void {
  app.openapi(
    { ...agingRoute, middleware: chokepointMiddleware(chokepoint, agingRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const query = c.req.valid("query");
      // Read per request, so a long-lived isolate cannot freeze it.
      const computedAt = new Date().toISOString();
      try {
        const report = await assembleAccountsReceivableAging(
          firm.firmDatabase,
          {
            asOfDate: query.asOfDate,
            knownAsOf: query.knownAsOf ?? null,
            locationId: query.locationId ?? null,
          },
          { computedAt },
        );
        // The report's arrays are `readonly` and the contract's are not; the response schema is what
        // the contract asserts, and the conformance suite checks it against the emitted document.
        return c.json(report as unknown as z.infer<typeof AccountsReceivableAgingResponse>, 200);
      } catch (caught) {
        if (caught instanceof ReportingValidationError) {
          return problemJson(c, {
            type:
              caught.code === "reporting-breakdown-truncated"
                ? "report-period-too-large"
                : "report-period-invalid",
            title:
              caught.code === "reporting-breakdown-truncated"
                ? "This report holds more than one document can carry"
                : "The date this report was asked for is not one that can be answered",
            status: 422,
            detail: caught.message,
          });
        }
        throw caught;
      }
    },
  );
}
