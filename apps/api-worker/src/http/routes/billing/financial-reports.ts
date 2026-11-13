import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { identifierField } from "@magna-carta/identifiers/field";
import { assembleAccountsReceivableAging } from "@magna-carta/reporting/financial/accounts-receivable-aging";
import { assembleRealization } from "@magna-carta/reporting/financial/realization";
import { assembleWorkInProgress } from "@magna-carta/reporting/financial/work-in-progress";
import { ReportingValidationError } from "@magna-carta/reporting/reporting-validation";
import type { Context } from "hono";
import type { Bindings } from "../../../bindings.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import { requireChokepointFirmContext } from "../../chokepoint/context-accessors.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { Problem, problemJson, type ProblemResponse } from "../../contracts/problem.ts";
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

const WorkInProgressFigures = z.object({
  timeMinutes: z.number().int(),
  timeMinor: z.number().int(),
  costMinor: z.number().int(),
  onDraftMinor: z.number().int(),
  totalMinor: z.number().int(),
});

const WorkInProgressResponse = z
  .object({
    computedAt: z.string(),
    reproducible: z.literal(false),
    statement: z.string(),
    locationId: z.string().nullable(),
    currency: z.literal("USD"),
    completeness: ReportCompleteness,
    totals: WorkInProgressFigures,
    offices: z.array(
      z.object({
        locationId: z.string().nullable(),
        locationName: z.string().nullable(),
        figures: WorkInProgressFigures,
      }),
    ),
    clients: z.array(
      z.object({
        clientEntityId: z.string().nullable(),
        clientName: z.string().nullable(),
        figures: WorkInProgressFigures,
        matters: z.array(
          z.object({
            matterId: z.string(),
            matterTitle: z.string(),
            matterNumber: z.string().nullable(),
            locationId: z.string().nullable(),
            locationName: z.string().nullable(),
            figures: WorkInProgressFigures,
          }),
        ),
      }),
    ),
    timekeepers: z.array(
      z.object({
        timekeeperUserId: z.string(),
        timekeeperName: z.string().nullable(),
        figures: WorkInProgressFigures,
      }),
    ),
  })
  .openapi("WorkInProgressReport");

const workInProgressRoute = defineOpenAPIRoute(
  { ...agingMeta, operationId: "reports.workInProgress" },
  {
    method: "get",
    path: "/api/v1/reports/work-in-progress",
    description:
      "Unbilled time and costs as they stand now, per office, client, matter and timekeeper, with the work already on a draft bill shown in its own column. Live only: time and cost entries can be edited until they are billed and record no date for when that happened, so this report takes no date and no knowledge instant, says when it was computed, and is not claimed to reproduce. Choosing an office narrows the rows; it does not limit who may run the report.",
    // Deliberately no date and no knowledge instant: accepting one and answering with today's
    // figures would answer a question about the past with a figure about the present.
    request: { query: z.object({ locationId: identifierField("location").optional() }) },
    responses: {
      200: {
        description: "The work in progress now",
        content: { "application/json": { schema: WorkInProgressResponse } },
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
        description: "More matters and timekeepers have unbilled work than one report can list",
        content: { "application/problem+json": { schema: Problem } },
      },
      429: {
        description: "Rate limit exceeded",
        content: { "application/problem+json": { schema: Problem } },
      },
    },
  },
);

const RealizationFigures = z.object({
  standardValueMinor: z.number().int(),
  billedMinor: z.number().int(),
  creditedMinor: z.number().int(),
  appliedMinor: z.number().int(),
});

const RealizationResponse = z
  .object({
    periodStart: z.string(),
    periodEnd: z.string(),
    locationId: z.string().nullable(),
    currency: z.literal("USD"),
    reproducibility: ReportReproducibility,
    reproducibilityStatement: z.string(),
    standardValueIsLive: z.literal(true),
    standardValueStatement: z.string(),
    completeness: ReportCompleteness,
    totals: RealizationFigures,
    offices: z.array(
      z.object({
        locationId: z.string().nullable(),
        locationName: z.string().nullable(),
        figures: RealizationFigures,
      }),
    ),
    clients: z.array(
      z.object({
        clientEntityId: z.string().nullable(),
        clientName: z.string().nullable(),
        figures: RealizationFigures,
        matters: z.array(
          z.object({
            matterId: z.string(),
            matterTitle: z.string(),
            matterNumber: z.string().nullable(),
            locationId: z.string().nullable(),
            locationName: z.string().nullable(),
            figures: RealizationFigures,
          }),
        ),
      }),
    ),
  })
  .openapi("RealizationReport");

const realizationRoute = defineOpenAPIRoute(
  { ...agingMeta, operationId: "reports.realization" },
  {
    method: "get",
    path: "/api/v1/reports/realization",
    description:
      "For a period, per office, client and matter: the standard value of the time worked, what was billed, what was credited or written off, and what was applied against the bills. Billed, credited and applied re-derive from records that never change when a knowledge instant is given; the standard value is live, because time entries can be edited until billed, and the response says so beside the other three. Applied means set against a bill; the platform records no cash arriving. Choosing an office narrows the rows; it does not limit who may run the report.",
    request: {
      query: z.object({
        periodStart: civilDate,
        periodEnd: civilDate,
        knownAsOf: knowledgeInstant.optional(),
        locationId: identifierField("location").optional(),
      }),
    },
    responses: {
      200: {
        description: "The realization for this period",
        content: { "application/json": { schema: RealizationResponse } },
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
          "The period is not two calendar dates or ends before it starts, the knowledge instant is not a UTC instant or is in the future, or more matters had activity than one report can list",
        content: { "application/problem+json": { schema: Problem } },
      },
      429: {
        description: "Rate limit exceeded",
        content: { "application/problem+json": { schema: Problem } },
      },
    },
  },
);

// A refusal's status is what it means, so the mapping lives in one place for every financial report.
export function reportingRefusal(
  c: Context,
  error: ReportingValidationError,
): ProblemResponse<422> {
  if (error.code === "reporting-breakdown-truncated") {
    return problemJson(c, {
      type: "report-period-too-large",
      title: "This report holds more than one document can carry",
      status: 422,
      detail: error.message,
    });
  }
  return problemJson(c, {
    type: "report-period-invalid",
    title: "The dates this report was asked for are not ones that can be answered",
    status: 422,
    detail: error.message,
  });
}

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
        if (caught instanceof ReportingValidationError) return reportingRefusal(c, caught);
        throw caught;
      }
    },
  );

  app.openapi(
    { ...workInProgressRoute, middleware: chokepointMiddleware(chokepoint, workInProgressRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const query = c.req.valid("query");
      const computedAt = new Date().toISOString();
      try {
        const report = await assembleWorkInProgress(
          firm.firmDatabase,
          { locationId: query.locationId ?? null },
          { computedAt },
        );
        return c.json(report as unknown as z.infer<typeof WorkInProgressResponse>, 200);
      } catch (caught) {
        if (caught instanceof ReportingValidationError) return reportingRefusal(c, caught);
        throw caught;
      }
    },
  );

  app.openapi(
    { ...realizationRoute, middleware: chokepointMiddleware(chokepoint, realizationRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const query = c.req.valid("query");
      const computedAt = new Date().toISOString();
      try {
        const report = await assembleRealization(
          firm.firmDatabase,
          {
            periodStart: query.periodStart,
            periodEnd: query.periodEnd,
            knownAsOf: query.knownAsOf ?? null,
            locationId: query.locationId ?? null,
          },
          { computedAt },
        );
        return c.json(report as unknown as z.infer<typeof RealizationResponse>, 200);
      } catch (caught) {
        if (caught instanceof ReportingValidationError) return reportingRefusal(c, caught);
        throw caught;
      }
    },
  );
}
