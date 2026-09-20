import { CIVIL_DATE_PATTERN } from "@magna-carta/civil-time/civil-date";
import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { readFirmSetting } from "@magna-carta/data-access/setting-statements";
import { targetDailyHoursDefinition } from "@magna-carta/timekeeping/settings";
import { readMyDay } from "@magna-carta/timekeeping/my-day";
import { identifierField } from "../../contracts/common.ts";
import type { UserId } from "@magna-carta/identifiers/types";
import type { Bindings } from "../../bindings.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointUserId,
} from "../../chokepoint/context-accessors.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { Problem, problemJson } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";
import { assertPermission } from "@magna-carta/access-control/registry";
import { loadEffectivePermissions } from "../../session-context.ts";

// My Day: the daily headline for a timekeeper — billable and non-billable totals for one work date,
// shortfall against the firm's target, and an un-logged-day flag. Read-only; requires time:track.

const TRACK = "time:track" as const;

const MyDayQuery = z.object({
  timekeeperUserId: identifierField("user"),
  workDate: z.string().regex(CIVIL_DATE_PATTERN),
});

const MyDayResponse = z
  .object({
    billableMinutes: z.number().int(),
    nonBillableMinutes: z.number().int(),
    targetDailyMinutes: z.number().int().nullable(),
    shortfallMinutes: z.number().int().nullable(),
    unloggedDay: z.boolean(),
  })
  .openapi("MyDayResponse");

const readErrorResponses = {
  401: {
    description: "No valid session",
    content: { "application/problem+json": { schema: Problem } },
  },
  403: {
    description: "The session member lacks time:track",
    content: { "application/problem+json": { schema: Problem } },
  },
  404: {
    description: "The firm is unreachable or the member is deactivated",
    content: { "application/problem+json": { schema: Problem } },
  },
  429: {
    description: "Rate limit exceeded",
    content: { "application/problem+json": { schema: Problem } },
  },
} as const;

const myDayMeta: RouteMeta = {
  operationId: "myDay.get",
  surface: "app",
  authenticated: true,
  permission: TRACK,
  resource: "matter",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

const myDayRoute = defineOpenAPIRoute(myDayMeta, {
  method: "get",
  path: "/api/v1/my-day",
  description:
    "Returns billable and non-billable minute totals for one timekeeper on one work date, the shortfall against the firm's daily target, and an un-logged-day flag.",
  request: { query: MyDayQuery },
  responses: {
    200: {
      description: "The My Day view",
      content: { "application/json": { schema: MyDayResponse } },
    },
    401: readErrorResponses[401],
    403: readErrorResponses[403],
    404: readErrorResponses[404],
    429: readErrorResponses[429],
  },
});

type MyDayApp = OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>;

export function registerMyDayRoutes(app: MyDayApp, chokepoint: Chokepoint): void {
  // GET /api/v1/my-day?timekeeperUserId=...&workDate=2026-06-22
  app.openapi(
    { ...myDayRoute, middleware: chokepointMiddleware(chokepoint, myDayRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const sessionUserId = requireChokepointUserId(c);
      const { timekeeperUserId, workDate } = c.req.valid("query");

      // A timekeeper may always read their own My Day. Reading another timekeeper's
      // headline requires time:viewFirm — treating non-owned reads as self is a data leak.
      if (timekeeperUserId !== sessionUserId) {
        const permissions = await loadEffectivePermissions(firm.firmDatabase, sessionUserId);
        if (!permissions.has(assertPermission("time:viewFirm"))) {
          return problemJson(c, {
            type: "permission-denied",
            title: "Forbidden",
            status: 403,
            detail: "Reading another timekeeper's My Day requires the time:viewFirm capability.",
          });
        }
      }

      const targetDailyHours = await readFirmSetting(firm.firmDatabase, targetDailyHoursDefinition);
      const targetDailyMinutes =
        targetDailyHours === null ? null : Math.round(targetDailyHours * 60);
      const view = await readMyDay(firm.firmDatabase, {
        timekeeperUserId: timekeeperUserId as UserId,
        workDate,
        targets: { targetDailyMinutes },
      });
      return c.json(view, 200);
    },
  );
}
