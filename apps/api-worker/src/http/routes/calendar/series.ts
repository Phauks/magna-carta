import { z } from "@hono/zod-openapi";
import { CIVIL_DATE_PATTERN } from "@magna-carta/civil-time/civil-date";
import {
  ChangeEventOccurrenceRequest,
  ChangeFirmEventOccurrenceRequest,
  CreatedResponse,
  SERIES_SIDES,
  SeriesInWindow,
} from "@magna-carta/calendar/contract";
import {
  changeFirmEventOccurrence,
  changeMatterEventOccurrence,
  readSeriesInWindow,
} from "@magna-carta/calendar/series-service";
import { CalendarValidationError } from "@magna-carta/calendar/validation";
import { visibleMatterPredicate } from "@magna-carta/calendar/visibility";
import { identifierField } from "@magna-carta/identifiers/field";
import type { FirmEventId, MatterEventId, MatterId, UserId } from "@magna-carta/identifiers/types";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointIdempotency,
  requireChokepointUserId,
} from "../../chokepoint/context-accessors.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { idempotencyKeyHeader, identifierPathParam } from "../../contracts/common.ts";
import { defineOpenAPIRoute } from "../../contracts/route-meta.ts";
import {
  authErrors,
  calendarReadErrorResponse,
  commitCalendarEffect,
  mutationMeta,
  readMeta,
  serviceOptions,
  type CalendarApp,
} from "./calendar.ts";

// A REPEATING SETTING: the days a series falls on inside a window, and one day of it changed.
//
// Its own module beside calendar.ts rather than inside it, because that module is at the size the
// route-shape ratchet holds it to. The shared pieces — the refusals, the idempotent commit, the
// service options — are calendar.ts's and are imported from it, so the two cannot disagree about
// what a calendar refusal is.

const seriesQuery = z.object({
  // Required and capped, exactly as the firm calendar's window is: a wider window is refused.
  from: z.string().regex(CIVIL_DATE_PATTERN),
  to: z.string().regex(CIVIL_DATE_PATTERN),
  side: z.enum(SERIES_SIDES).optional(),
  matterId: identifierField("matter").optional(),
  memberId: identifierField("user").optional(),
});

const eventIdParam = z.object({ eventId: identifierPathParam("matterEvent", "eventId") });
const firmEventIdParam = z.object({
  firmEventId: identifierPathParam("firmEvent", "firmEventId"),
});

const seriesRoute = defineOpenAPIRoute(readMeta("listSeries", "firm"), {
  method: "get",
  path: "/api/v1/calendar/series",
  description:
    "The repeating settings that fall inside a window, each with the days inside it that it falls " +
    "on. A series is one record carrying its rule; the days are worked out when the window is read " +
    "and never stored. A day somebody changed or called off on its own is left out of its series " +
    "here, because the event standing in for that day is an ordinary event the other calendar reads " +
    "return. Read across the firm a matter's series carries no title, as the firm calendar carries " +
    "none; read for one matter, it does. Narrow by side, by matter, and by member exactly as the " +
    "firm calendar narrows.",
  request: { query: seriesQuery },
  responses: {
    200: {
      description: "The series in the window",
      content: { "application/json": { schema: SeriesInWindow } },
    },
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    422: authErrors[422],
    429: authErrors[429],
  },
});

const OCCURRENCE_DESCRIPTION =
  "Changes or cancels one day of a repeating setting (`this`), or that day and every later one " +
  "(`following`). One day changed is written as its own event that names the series and the day it " +
  "replaces, so it is read, opened and corrected like any other event and the series skips that " +
  "day. A change to every later day ends the series the day before and starts a new one on that " +
  "day carrying the change and the rest of a count; days already in the past are never rewritten. " +
  "A change to the whole series is the ordinary edit of the series itself. Answers the event the " +
  "change produced.";

const changeEventOccurrenceRoute = defineOpenAPIRoute(
  mutationMeta("changeEventOccurrence", "matter"),
  {
    method: "post",
    path: "/api/v1/events/{eventId}/occurrences",
    description: OCCURRENCE_DESCRIPTION,
    request: {
      headers: idempotencyKeyHeader,
      params: eventIdParam,
      body: {
        content: { "application/json": { schema: ChangeEventOccurrenceRequest } },
        required: true,
      },
    },
    responses: {
      200: {
        description: "The day or days were changed",
        content: { "application/json": { schema: CreatedResponse } },
      },
      400: authErrors[400],
      401: authErrors[401],
      403: authErrors[403],
      404: authErrors[404],
      409: authErrors[409],
      422: authErrors[422],
      429: authErrors[429],
    },
  },
);

const changeFirmEventOccurrenceRoute = defineOpenAPIRoute(
  mutationMeta("changeFirmEventOccurrence", "firm"),
  {
    method: "post",
    path: "/api/v1/firm-events/{firmEventId}/occurrences",
    description: OCCURRENCE_DESCRIPTION,
    request: {
      headers: idempotencyKeyHeader,
      params: firmEventIdParam,
      body: {
        content: { "application/json": { schema: ChangeFirmEventOccurrenceRequest } },
        required: true,
      },
    },
    responses: {
      200: {
        description: "The day or days were changed",
        content: { "application/json": { schema: CreatedResponse } },
      },
      400: authErrors[400],
      401: authErrors[401],
      403: authErrors[403],
      404: authErrors[404],
      409: authErrors[409],
      422: authErrors[422],
      429: authErrors[429],
    },
  },
);

export function registerCalendarSeriesRoutes(app: CalendarApp, chokepoint: Chokepoint): void {
  // GET /api/v1/calendar/series
  app.openapi(
    { ...seriesRoute, middleware: chokepointMiddleware(chokepoint, seriesRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const query = c.req.valid("query");
      try {
        const result = await readSeriesInWindow(firm.firmDatabase, {
          fromDate: query.from,
          toDate: query.to,
          side: query.side ?? "all",
          matterId: query.matterId as MatterId | undefined,
          memberUserId: query.memberId as UserId | undefined,
          visibility: visibleMatterPredicate(),
        });
        return c.json(
          {
            data: result.series.map((series) => ({
              ...series,
              occurrences: [...series.occurrences],
            })),
            truncated: result.truncated,
          },
          200,
        );
      } catch (caught) {
        if (caught instanceof CalendarValidationError) return calendarReadErrorResponse(c, caught);
        throw caught;
      }
    },
  );

  // POST /api/v1/events/{eventId}/occurrences
  app.openapi(
    {
      ...changeEventOccurrenceRoute,
      middleware: chokepointMiddleware(chokepoint, changeEventOccurrenceRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { eventId } = c.req.valid("param");
      const request = c.req.valid("json");
      const outcome = await commitCalendarEffect(c, firm.firmDatabase, idempotency, 200, () =>
        changeMatterEventOccurrence(
          firm.firmDatabase,
          eventId as MatterEventId,
          request.occurrenceOn,
          request.scope,
          request.change.kind === "cancel"
            ? { kind: "cancel", statusReason: request.change.statusReason ?? null }
            : { kind: "update", fields: request.change.fields },
          serviceOptions(userId),
        ),
      );
      if (!outcome.ok) return outcome.problem;
      if (outcome.replayed) c.header("Idempotency-Replayed", "true");
      return c.json({ id: outcome.id }, 200);
    },
  );

  // POST /api/v1/firm-events/{firmEventId}/occurrences
  app.openapi(
    {
      ...changeFirmEventOccurrenceRoute,
      middleware: chokepointMiddleware(chokepoint, changeFirmEventOccurrenceRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { firmEventId } = c.req.valid("param");
      const request = c.req.valid("json");
      const outcome = await commitCalendarEffect(c, firm.firmDatabase, idempotency, 200, () =>
        changeFirmEventOccurrence(
          firm.firmDatabase,
          firmEventId as FirmEventId,
          request.occurrenceOn,
          request.scope,
          request.change.kind === "cancel"
            ? { kind: "cancel", statusReason: request.change.statusReason ?? null }
            : { kind: "update", fields: request.change.fields },
          serviceOptions(userId),
        ),
      );
      if (!outcome.ok) return outcome.problem;
      if (outcome.replayed) c.header("Idempotency-Replayed", "true");
      return c.json({ id: outcome.id }, 200);
    },
  );
}
