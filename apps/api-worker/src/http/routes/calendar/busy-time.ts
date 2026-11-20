import { z, type OpenAPIHono } from "@hono/zod-openapi";
import {
  CalendarMemberBusyTimeList,
  CalendarSyncAccountEventWindow,
} from "@magna-carta/calendar/sync-contract";
import { readMemberBusyTime } from "@magna-carta/calendar/sync-shown-service";
import { addCalendarDays, type CivilDate } from "@magna-carta/civil-time/civil-date";
import type { UserId } from "@magna-carta/identifiers/types";
import type { Bindings } from "../../../bindings.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointUserId,
} from "../../chokepoint/context-accessors.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { Problem, problemJson } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";

// WHEN A COLLEAGUE IS BUSY, FROM THEIR OWN OUTLOOK OR GOOGLE CALENDAR.
//
// One read. A member may choose, one calendar at a time, to tell colleagues the hours their own
// events take. This answers those hours for one member and a window, to anybody who may read the
// firm's calendar.
//
// HOURS ONLY. The statement behind it selects no title, place, identifier or calendar name, so
// there is nothing here that could be widened by a mistake in this file.
//
// NEVER THE SESSION MEMBER'S OWN. They read their own events, titles and all, from their own
// route; answering their hours here as well would paint every one of them twice.
//
// It never asks the provider: it answers from what that member's own sync pass last stored.

type BusyTimeApp = OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>;

const problemContent = { "application/problem+json": { schema: Problem } } as const;

const meta: RouteMeta = {
  operationId: "calendar.memberBusyTime",
  surface: "app",
  authenticated: true,
  permission: "calendar:read",
  resource: "firm",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

const route = defineOpenAPIRoute(meta, {
  method: "get",
  path: "/api/v1/calendar/members/{memberUserId}/busy-time",
  description:
    "When one member is busy inside a window, from the calendars of their own Outlook or Google " +
    "account they chose to share as busy. Hours only: no title, place or calendar name. Empty " +
    "when they shared none, and always empty for the session member's own.",
  request: {
    params: z.object({ memberUserId: z.string().min(1).max(128) }),
    query: CalendarSyncAccountEventWindow,
  },
  responses: {
    200: {
      description: "The member's busy time in the window",
      content: { "application/json": { schema: CalendarMemberBusyTimeList } },
    },
    401: { description: "No valid session", content: problemContent },
    403: { description: "The session member lacks the permission named", content: problemContent },
    404: {
      description: "The firm is unreachable or the member is deactivated",
      content: problemContent,
    },
    422: {
      description: "The window is not two days in order, or is longer than a year",
      content: problemContent,
    },
    429: { description: "Rate limit exceeded", content: problemContent },
  },
});

// The longest window one read covers. A year view is the widest the calendar draws.
const MAXIMUM_WINDOW_DAYS = 400;

export function registerCalendarBusyTimeRoutes(app: BusyTimeApp, chokepoint: Chokepoint): void {
  // GET /api/v1/calendar/members/{memberUserId}/busy-time
  app.openapi({ ...route, middleware: chokepointMiddleware(chokepoint, route) }, async (c) => {
    const { from, to } = c.req.valid("query");
    if (to < from || addCalendarDays(from as CivilDate, MAXIMUM_WINDOW_DAYS) < to) {
      return problemJson(c, {
        type: "validation",
        title: "The window cannot be read",
        status: 422,
        detail: "The window must be two days in order, no more than a year apart.",
      });
    }
    const { memberUserId } = c.req.valid("param");
    if (memberUserId === requireChokepointUserId(c)) {
      return c.json({ busy: [], truncated: false }, 200);
    }
    const read = await readMemberBusyTime(
      requireChokepointFirmContext(c).firmDatabase,
      memberUserId as UserId,
      {
        from,
        to,
        // A day either side, so a stretch on the window's first or last day is inside it wherever
        // on earth the reader is. Their screen places each one exactly.
        fromInstant: `${addCalendarDays(from as CivilDate, -1)}T00:00:00.000Z`,
        toInstant: `${addCalendarDays(to as CivilDate, 2)}T00:00:00.000Z`,
      },
    );
    return c.json(read, 200);
  });
}
