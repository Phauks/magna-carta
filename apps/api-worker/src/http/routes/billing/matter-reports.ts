import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { identifierField } from "@magna-carta/identifiers/field";
import {
  ClientListRow,
  DailyTimeDayRow,
  DailyTimeTimekeeperRow,
  MatterListOfficeRow,
  MatterListRow,
  MatterProductivityRow,
  MatterStatusCounts,
  ProductivityFigures,
} from "@magna-carta/reporting/contract";
import { assembleClientList } from "@magna-carta/reporting/operational/client-list";
import { assembleDailyTime } from "@magna-carta/reporting/productivity/daily-time";
import { assembleMatterProductivity } from "@magna-carta/reporting/productivity/matter-productivity";
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
import { civilDate, ReportCompleteness } from "./reports.ts";

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

// CLIENT LIST — every client of an opened matter, with the directory's default way to reach them
// and how many of their matters are open, on hold and closed. On `reports:operational` beside the
// Matters List, live for the same reason, and narrowed by office the same way. No sealed identifier
// is ever on a row.
const ClientListResponse = z
  .object({
    computedAt: z.string(),
    reproducible: z.literal(false),
    statement: z.string(),
    locationId: z.string().nullable(),
    completeness: ReportCompleteness,
    clientCount: z.number().int(),
    totals: MatterStatusCounts,
    mattersWithoutClient: z.number().int(),
    clients: z.array(ClientListRow),
  })
  .openapi("ClientListReport");

const clientListMeta: RouteMeta = { ...mattersListMeta, operationId: "reports.clientList" };

const clientListRoute = defineOpenAPIRoute(clientListMeta, {
  method: "get",
  path: "/api/v1/reports/client-list",
  description:
    "Every client of a matter the firm has opened, in name order, with the directory's default email, number and place for each and how many of their matters are open, on hold and closed. A live report: it takes no date, says when it was computed, and is not claimed to reproduce. Choosing an office narrows it to clients with matters there.",
  request: { query: mattersListQuery },
  responses: {
    ...mattersListRoute.responses,
    200: {
      description: "The firm's clients now",
      content: { "application/json": { schema: ClientListResponse } },
    },
  },
});

// DAILY TIME — the time recorded on each day of a period, by timekeeper, billable against
// non-billable. On `reports:productivity` beside Timekeeper Productivity: minutes only, never money.
// Live only for the same reason: a time entry can be edited until it is billed.
const productivityPeriodQuery = z.object({
  periodStart: civilDate,
  periodEnd: civilDate,
  locationId: identifierField("location").optional(),
});

const DailyTimeResponse = z
  .object({
    periodStart: z.string(),
    periodEnd: z.string(),
    computedAt: z.string(),
    reproducible: z.literal(false),
    statement: z.string(),
    locationId: z.string().nullable(),
    completeness: ReportCompleteness,
    totals: ProductivityFigures,
    days: z.array(DailyTimeDayRow),
    timekeepers: z.array(DailyTimeTimekeeperRow),
  })
  .openapi("DailyTimeReport");

const dailyTimeMeta: RouteMeta = {
  ...mattersListMeta,
  operationId: "reports.dailyTime",
  permission: "reports:productivity",
};

const dailyTimeRoute = defineOpenAPIRoute(dailyTimeMeta, {
  method: "get",
  path: "/api/v1/reports/daily-time",
  description:
    "Time recorded on each day of a period, per timekeeper, billable against non-billable, with each timekeeper's total over the period and how many days they recorded time on. Minutes only, never money, and no target. Its totals equal Timekeeper Productivity's for the same period. Live only, because time entries can be edited until billed: it takes no knowledge instant, says when it was computed, and is not claimed to reproduce.",
  request: { query: productivityPeriodQuery },
  responses: {
    200: {
      description: "The time recorded on each day of this period",
      content: { "application/json": { schema: DailyTimeResponse } },
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

// MATTER PRODUCTIVITY — the same minutes per matter, with who recorded them under each. Same
// permission, same live-only footing, same period and office.
const MatterProductivityResponse = z
  .object({
    periodStart: z.string(),
    periodEnd: z.string(),
    computedAt: z.string(),
    reproducible: z.literal(false),
    statement: z.string(),
    locationId: z.string().nullable(),
    completeness: ReportCompleteness,
    totals: ProductivityFigures,
    matters: z.array(MatterProductivityRow),
  })
  .openapi("MatterProductivityReport");

const matterProductivityMeta: RouteMeta = {
  ...dailyTimeMeta,
  operationId: "reports.matterProductivity",
};

const matterProductivityRoute = defineOpenAPIRoute(matterProductivityMeta, {
  method: "get",
  path: "/api/v1/reports/matter-productivity",
  description:
    "Time recorded on each matter in a period, billable against non-billable, with each timekeeper's time on it, the matters with the most time first. Minutes only, never money. Its totals equal Timekeeper Productivity's for the same period. Live only, because time entries can be edited until billed: it takes no knowledge instant, says when it was computed, and is not claimed to reproduce.",
  request: { query: productivityPeriodQuery },
  responses: {
    ...dailyTimeRoute.responses,
    200: {
      description: "The time recorded on each matter in this period",
      content: { "application/json": { schema: MatterProductivityResponse } },
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

  app.openapi(
    { ...dailyTimeRoute, middleware: chokepointMiddleware(chokepoint, dailyTimeRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const query = c.req.valid("query");
      const computedAt = new Date().toISOString();
      try {
        const report = await assembleDailyTime(
          firm.firmDatabase,
          {
            periodStart: query.periodStart,
            periodEnd: query.periodEnd,
            locationId: query.locationId ?? null,
          },
          { computedAt },
        );
        return c.json(report as unknown as z.infer<typeof DailyTimeResponse>, 200);
      } catch (caught) {
        if (caught instanceof ReportingValidationError) return reportingRefusal(c, caught);
        throw caught;
      }
    },
  );

  app.openapi(
    {
      ...matterProductivityRoute,
      middleware: chokepointMiddleware(chokepoint, matterProductivityRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const query = c.req.valid("query");
      const computedAt = new Date().toISOString();
      try {
        const report = await assembleMatterProductivity(
          firm.firmDatabase,
          {
            periodStart: query.periodStart,
            periodEnd: query.periodEnd,
            locationId: query.locationId ?? null,
          },
          { computedAt },
        );
        return c.json(report as unknown as z.infer<typeof MatterProductivityResponse>, 200);
      } catch (caught) {
        if (caught instanceof ReportingValidationError) return reportingRefusal(c, caught);
        throw caught;
      }
    },
  );

  app.openapi(
    { ...clientListRoute, middleware: chokepointMiddleware(chokepoint, clientListRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const query = c.req.valid("query");
      const computedAt = new Date().toISOString();
      try {
        const report = await assembleClientList(
          firm.firmDatabase,
          { locationId: query.locationId ?? null },
          { computedAt },
        );
        return c.json(report as unknown as z.infer<typeof ClientListResponse>, 200);
      } catch (caught) {
        if (caught instanceof ReportingValidationError) return reportingRefusal(c, caught);
        throw caught;
      }
    },
  );
}
