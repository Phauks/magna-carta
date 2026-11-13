import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { identifierField } from "@magna-carta/identifiers/field";
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
import { civilDate, ReportCompleteness } from "./reports.ts";

// THE ACTIVITY REPORTS — how much time people recorded, and how much the firm did.
//
// Productivity is on its own key, `reports:productivity`: a report about people is a different grant
// from a report about money, and it carries minutes only. Every route here is a GET; the office is a
// filter on the rows and never a gate on who may run the report.

const PRODUCTIVITY = "reports:productivity" as const;

const ProductivityFigures = z.object({
  entryCount: z.number().int(),
  billableMinutes: z.number().int(),
  nonBillableMinutes: z.number().int(),
  totalMinutes: z.number().int(),
  billableShareBasisPoints: z.number().int().nullable(),
});

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
    timekeepers: z.array(
      z.object({
        timekeeperUserId: z.string(),
        timekeeperName: z.string().nullable(),
        matterCount: z.number().int(),
        figures: ProductivityFigures,
      }),
    ),
    offices: z.array(
      z.object({
        locationId: z.string().nullable(),
        locationName: z.string().nullable(),
        figures: ProductivityFigures,
      }),
    ),
    clients: z.array(
      z.object({
        clientEntityId: z.string().nullable(),
        clientName: z.string().nullable(),
        figures: ProductivityFigures,
      }),
    ),
    nonBillableCategories: z.array(
      z.object({
        categoryId: z.string().nullable(),
        categoryName: z.string().nullable(),
        minutes: z.number().int(),
      }),
    ),
    taskCodes: z.array(
      z.object({
        code: z.string().nullable(),
        label: z.string().nullable(),
        figures: ProductivityFigures,
      }),
    ),
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
}
