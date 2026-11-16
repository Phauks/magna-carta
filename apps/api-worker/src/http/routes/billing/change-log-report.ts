import { z, type OpenAPIHono } from "@hono/zod-openapi";
import {
  ChangeCounts,
  ChangeEntryRow,
  ChangeFamilyRow,
  ChangePersonRow,
} from "@magna-carta/reporting/contract";
import { assembleChangeLog } from "@magna-carta/reporting/operational/change-log";
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

// THE CHANGE LOG — who added, changed and removed the firm's people and organizations, matters and
// trust account rules in a period, from the audit log. On `reports:operational`: it is about the
// firm's records, not its money. No office filter: an audit row names a record, not an office.
//
// No knowledge instant: an audit row's instant is both when the change happened and when it was
// recorded, and the row is never edited, so a past period already re-reads to the same rows. The
// response says whether the period had ended when it was produced.
const changeLogQuery = z.object({ periodStart: civilDate, periodEnd: civilDate });

const ChangeLogResponse = z
  .object({
    periodStart: z.string(),
    periodEnd: z.string(),
    computedAt: z.string(),
    reproducible: z.boolean(),
    statement: z.string(),
    completeness: ReportCompleteness,
    totals: ChangeCounts,
    families: z.array(ChangeFamilyRow),
    people: z.array(ChangePersonRow),
    entries: z.array(ChangeEntryRow),
  })
  .openapi("ChangeLogReport");

const changeLogMeta: RouteMeta = {
  operationId: "reports.changeLog",
  surface: "app",
  authenticated: true,
  permission: "reports:operational",
  resource: "firm",
  // A read audits nothing: it changes nothing a firm could later need to reconstruct.
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

const changeLogRoute = defineOpenAPIRoute(changeLogMeta, {
  method: "get",
  path: "/api/v1/reports/change-log",
  description:
    "Who added, changed or removed the firm's people and organizations, matters and trust account rules in a period (UTC days), counted by kind of record and by person, with every change listed newest first: when, who, what in plain words, and the handle of the record. Never the details of a change. The change history is never edited, so a period that has ended returns the same changes every time; the response says whether it had. Takes no knowledge instant.",
  request: { query: changeLogQuery },
  responses: {
    200: {
      description: "The changes recorded in this period",
      content: { "application/json": { schema: ChangeLogResponse } },
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
        "The period is not a pair of calendar dates in order, or holds more changes than one report can list",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

type ReportsApp = OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>;

export function registerChangeLogReportRoutes(app: ReportsApp, chokepoint: Chokepoint): void {
  app.openapi(
    { ...changeLogRoute, middleware: chokepointMiddleware(chokepoint, changeLogRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const query = c.req.valid("query");
      // Read per request, so a long-lived isolate cannot freeze it.
      const computedAt = new Date().toISOString();
      try {
        const report = await assembleChangeLog(
          firm.firmDatabase,
          { periodStart: query.periodStart, periodEnd: query.periodEnd },
          { computedAt },
        );
        return c.json(report as unknown as z.infer<typeof ChangeLogResponse>, 200);
      } catch (caught) {
        if (caught instanceof ReportingValidationError) return reportingRefusal(c, caught);
        throw caught;
      }
    },
  );
}
