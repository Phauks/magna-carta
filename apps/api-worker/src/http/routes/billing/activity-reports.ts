import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { identifierField } from "@magna-carta/identifiers/field";
import {
  OperationalBillingCounts,
  OperationalCostCount,
  OperationalMatterCount,
  OperationalSections,
  OperationalTrustCount,
  ProductivityClientRow,
  ProductivityFigures,
  ProductivityNonBillableCategoryRow,
  ProductivityOfficeRow,
  ProductivityTaskCodeRow,
  ProductivityTimekeeperRow,
} from "@magna-carta/reporting/contract";
import { assembleOperationalVolumes } from "@magna-carta/reporting/operational/operational-volumes";
import { assembleTimekeeperProductivity } from "@magna-carta/reporting/productivity/timekeeper-productivity";
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

// THE ACTIVITY REPORTS — how much time people recorded, and how much the firm did.
//
// Productivity is on its own key, `reports:productivity`: a report about people is a different grant
// from a report about money, and it carries minutes only. Every route here is a GET; the office is a
// filter on the rows and never a gate on who may run the report.

const PRODUCTIVITY = "reports:productivity" as const;

const TimekeeperProductivityResponse = z
  .object({
    periodStart: z.string(),
    periodEnd: z.string(),
    computedAt: z.string(),
    reproducible: z.literal(false),
    statement: z.string(),
    locationId: z.string().nullable(),
    completeness: ReportCompleteness,
    totals: ProductivityFigures,
    timekeepers: z.array(ProductivityTimekeeperRow),
    offices: z.array(ProductivityOfficeRow),
    clients: z.array(ProductivityClientRow),
    nonBillableCategories: z.array(ProductivityNonBillableCategoryRow),
    taskCodes: z.array(ProductivityTaskCodeRow),
  })
  .openapi("TimekeeperProductivityReport");

const productivityMeta: RouteMeta = {
  operationId: "reports.timekeeperProductivity",
  surface: "app",
  authenticated: true,
  permission: PRODUCTIVITY,
  resource: "firm",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

const productivityRoute = defineOpenAPIRoute(productivityMeta, {
  method: "get",
  path: "/api/v1/reports/timekeeper-productivity",
  description:
    "Time recorded in a period by work date: per timekeeper, office, client, non-billable category and task code, billable against non-billable, with the billable share. Minutes only, never money, and no target: the platform stores no billable-hour target and does not invent one. Live only, because time entries can be edited until billed: it takes no knowledge instant, says when it was computed, and is not claimed to reproduce.",
  request: {
    query: z.object({
      periodStart: civilDate,
      periodEnd: civilDate,
      locationId: identifierField("location").optional(),
    }),
  },
  responses: {
    200: {
      description: "The time recorded in this period",
      content: { "application/json": { schema: TimekeeperProductivityResponse } },
    },
    401: {
      description: "No valid session",
      content: { "application/problem+json": { schema: Problem } },
    },
    403: {
      description: "The session member lacks reports:productivity",
      content: { "application/problem+json": { schema: Problem } },
    },
    404: {
      description: "The firm is unreachable or the member is deactivated",
      content: { "application/problem+json": { schema: Problem } },
    },
    422: {
      description:
        "The period is not two calendar dates or ends before it starts, or more time was recorded than one report can list",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

const OPERATIONAL = "reports:operational" as const;

const OperationalVolumesResponse = z
  .object({
    periodStart: z.string(),
    periodEnd: z.string(),
    locationId: z.string().nullable(),
    reproducibility: ReportReproducibility,
    reproducibilityStatement: z.string(),
    liveSections: z.array(OperationalSections),
    liveSectionsStatement: z.string(),
    completeness: ReportCompleteness,
    matters: z.array(OperationalMatterCount),
    billing: OperationalBillingCounts,
    trust: z.array(OperationalTrustCount),
    costs: z.array(OperationalCostCount),
  })
  .openapi("OperationalVolumesReport");

const operationalRoute = defineOpenAPIRoute(
  { ...productivityMeta, operationId: "reports.operationalVolumes", permission: OPERATIONAL },
  {
    method: "get",
    path: "/api/v1/reports/operational-volumes",
    description:
      "How much the firm did in a period: matters opened and closed by type, bills drafted, finalized and voided, credit notes and write-offs, trust movements by kind, disbursement requests and their outcomes, reconciliations opened and closed, and costs incurred by class. Counts only, never money. The billing and trust counts honor a knowledge instant; the matter and cost counts are over records that can still change and are live, which the response names. Choosing an office narrows every count; it does not limit who may run the report.",
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
        description: "The volumes for this period",
        content: { "application/json": { schema: OperationalVolumesResponse } },
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
        description:
          "The period is not two calendar dates or ends before it starts, or the knowledge instant is not a UTC instant or is in the future",
        content: { "application/problem+json": { schema: Problem } },
      },
      429: {
        description: "Rate limit exceeded",
        content: { "application/problem+json": { schema: Problem } },
      },
    },
  },
);

type ReportsApp = OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>;

export function registerActivityReportsRoutes(app: ReportsApp, chokepoint: Chokepoint): void {
  app.openapi(
    { ...productivityRoute, middleware: chokepointMiddleware(chokepoint, productivityRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const query = c.req.valid("query");
      const computedAt = new Date().toISOString();
      try {
        const report = await assembleTimekeeperProductivity(
          firm.firmDatabase,
          {
            periodStart: query.periodStart,
            periodEnd: query.periodEnd,
            locationId: query.locationId ?? null,
          },
          { computedAt },
        );
        return c.json(report as unknown as z.infer<typeof TimekeeperProductivityResponse>, 200);
      } catch (caught) {
        if (caught instanceof ReportingValidationError) return reportingRefusal(c, caught);
        throw caught;
      }
    },
  );

  app.openapi(
    { ...operationalRoute, middleware: chokepointMiddleware(chokepoint, operationalRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const query = c.req.valid("query");
      const computedAt = new Date().toISOString();
      try {
        const report = await assembleOperationalVolumes(
          firm.firmDatabase,
          {
            periodStart: query.periodStart,
            periodEnd: query.periodEnd,
            knownAsOf: query.knownAsOf ?? null,
            locationId: query.locationId ?? null,
          },
          { computedAt },
        );
        return c.json(report as unknown as z.infer<typeof OperationalVolumesResponse>, 200);
      } catch (caught) {
        if (caught instanceof ReportingValidationError) return reportingRefusal(c, caught);
        throw caught;
      }
    },
  );
}
