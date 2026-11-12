import type { OpenAPIHono } from "@hono/zod-openapi";
import {
  CalendarSyncAccountEventList,
  CalendarSyncAccountEventWindow,
  CalendarSyncSettings,
  CalendarSyncShownCalendarsReplace,
} from "@magna-carta/calendar/sync-contract";
import { SyncRuleRefusal } from "@magna-carta/calendar/sync-rule-service";
import {
  readExternalEvents,
  readShownCalendars,
  replaceShownCalendars,
} from "@magna-carta/calendar/sync-shown-service";
import { addCalendarDays, type CivilDate } from "@magna-carta/civil-time/civil-date";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import type { IntegrationConnectionId } from "@magna-carta/identifiers/types";
import { fetchHttpClient } from "@magna-carta/integrations/http";
import type { Bindings } from "../../../bindings.ts";
import { integrationCredentialStoreForFirm } from "../../../plugins/credential-store.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointUserId,
} from "../../chokepoint/context-accessors.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { Problem, problemJson } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";
import type { ConnectedAccountsRouteDeps } from "./connected-accounts.ts";
import { memberAccount, memberAccountCalendars, memberSyncSettings } from "./member-account.ts";

// A MEMBER'S OWN EVENTS, SHOWN BACK TO THEM IN THE FIRM'S CALENDAR.
//
// Two routes. One replaces the member's choice of which of their account's calendars are read.
// The other answers what a sync pass last read from those calendars, for a window.
//
// BOTH FIND THE ACCOUNT THROUGH THE SESSION MEMBER and nothing a request names. There is no route
// that reads another member's own events, and no permission that would let one: what is in a
// person's own calendar is theirs, and the firm's calendar only shows it back to them.
//
// THE READ NEVER ASKS THE PROVIDER. It answers from what a pass stored, so the calendar paints at
// the speed of the firm's own database and a provider that is down costs the reader nothing they
// already had.

const PERMISSION = "calendar:read" as const;

type AccountEventsApp = OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>;

const problemContent = { "application/problem+json": { schema: Problem } } as const;

const errorResponses = {
  401: { description: "No valid session", content: problemContent },
  403: { description: "The session member lacks the permission named", content: problemContent },
  404: {
    description: "The firm is unreachable or the member is deactivated",
    content: problemContent,
  },
  409: { description: "The member has no connected account", content: problemContent },
  422: {
    description: "A calendar named is not one the account has; `errors` says which",
    content: problemContent,
  },
  429: { description: "Rate limit exceeded", content: problemContent },
  503: {
    description:
      "The member's provider could not be asked for their calendars, so nothing was saved",
    content: problemContent,
  },
} as const;

const replaceShownMeta: RouteMeta = {
  operationId: "calendarSync.replaceMyShownCalendars",
  surface: "app",
  authenticated: true,
  permission: PERMISSION,
  resource: "firm",
  audited: true,
  // A replace of the whole set: saving the same set twice lands the same rows.
  idempotency: "optional",
  rateLimit: "default",
};

const listEventsMeta: RouteMeta = {
  operationId: "calendarSync.listMyAccountEvents",
  surface: "app",
  authenticated: true,
  permission: PERMISSION,
  resource: "firm",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

const replaceShownRoute = defineOpenAPIRoute(replaceShownMeta, {
  method: "put",
  path: "/api/v1/me/calendar-sync/shown-calendars",
  description:
    "Replaces the session member's choice of which of their own account's calendars are shown " +
    "to them in the firm's calendar. Events from a calendar no longer chosen are removed at " +
    "once. Nothing is shown to anybody else, and nothing is changed at the provider.",
  request: {
    body: {
      content: { "application/json": { schema: CalendarSyncShownCalendarsReplace } },
      required: true,
    },
  },
  responses: {
    200: {
      description: "The member's calendar sync settings after the write",
      content: { "application/json": { schema: CalendarSyncSettings } },
    },
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
    409: errorResponses[409],
    422: errorResponses[422],
    429: errorResponses[429],
    503: errorResponses[503],
  },
});

const listEventsRoute = defineOpenAPIRoute(listEventsMeta, {
  method: "get",
  path: "/api/v1/me/calendar-sync/account-events",
  description:
    "The session member's own events inside a window, as last read from the calendars of their " +
    "account they chose to be shown. Only ever the session member's. Empty when they have no " +
    "account or chose no calendar. Copies of the firm's own events are left out.",
  request: { query: CalendarSyncAccountEventWindow },
  responses: {
    200: {
      description: "The member's own events in the window",
      content: { "application/json": { schema: CalendarSyncAccountEventList } },
    },
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
    422: {
      description: "The window is not two days in order, or is longer than a year",
      content: problemContent,
    },
    429: errorResponses[429],
  },
});

// The longest window one read covers. A year view is the widest the calendar draws.
const MAXIMUM_WINDOW_DAYS = 400;

export function registerCalendarAccountEventRoutes(
  app: AccountEventsApp,
  chokepoint: Chokepoint,
  deps: ConnectedAccountsRouteDeps = {},
): void {
  const ports = {
    http: deps.http ?? fetchHttpClient(),
    credentialStoreForFirm: deps.credentialStoreForFirm ?? integrationCredentialStoreForFirm,
    now: deps.now ?? (() => new Date()),
  };

  // PUT /api/v1/me/calendar-sync/shown-calendars
  app.openapi(
    { ...replaceShownRoute, middleware: chokepointMiddleware(chokepoint, replaceShownRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { calendarRemoteIds } = c.req.valid("json");
      const connection = await memberAccount(c);
      if (connection === null) {
        return problemJson(c, {
          type: "conflict",
          title: "No connected account",
          status: 409,
          detail:
            "You have not connected a calendar account, so there are no calendars to show. Nothing was saved.",
        });
      }
      const calendars = await memberAccountCalendars(c, connection, ports);
      if (calendars.kind !== "listed") {
        return problemJson(c, {
          type: "service-unavailable",
          title: "Your calendars could not be read",
          status: 503,
          detail:
            calendars.kind === "sign-in-again"
              ? "Your calendar account needs you to sign in again before its settings can change. Nothing was saved."
              : "Your calendar account could not be reached, so the calendars you chose could not be checked. Nothing was saved.",
        });
      }
      const instant = ports.now().toISOString();
      const clock = { now: () => instant };
      let effect;
      try {
        ({ effect } = replaceShownCalendars(
          firm.firmDatabase,
          connection.id as IntegrationConnectionId,
          calendarRemoteIds,
          calendars.calendars,
          { clock, actorUserId: requireChokepointUserId(c) },
        ));
      } catch (caught) {
        if (!(caught instanceof SyncRuleRefusal)) throw caught;
        return problemJson(c, {
          type: "calendar-sync-setting-refused",
          title: "A calendar sync setting could not be saved",
          status: 422,
          detail: "One of the calendars chosen is not in your account any more. Nothing was saved.",
          errors: [{ path: "calendarRemoteIds", code: caught.code, detail: caught.message }],
        });
      }
      await commitEffectBatch(firm.firmDatabase, effect, clock);
      return c.json(await memberSyncSettings(c, connection, calendars), 200);
    },
  );

  // GET /api/v1/me/calendar-sync/account-events
  app.openapi(
    { ...listEventsRoute, middleware: chokepointMiddleware(chokepoint, listEventsRoute) },
    async (c) => {
      const { from, to } = c.req.valid("query");
      if (to < from || addCalendarDays(from as CivilDate, MAXIMUM_WINDOW_DAYS) < to) {
        return problemJson(c, {
          type: "validation",
          title: "The window cannot be read",
          status: 422,
          detail: "The window must be two days in order, no more than a year apart.",
        });
      }
      const connection = await memberAccount(c);
      if (connection === null) {
        return c.json({ shownCalendars: [], events: [], truncated: false }, 200);
      }
      const database = requireChokepointFirmContext(c).firmDatabase;
      const connectionId = connection.id as IntegrationConnectionId;
      const shownCalendars = await readShownCalendars(database, connectionId);
      const { events, truncated } = await readExternalEvents(database, connectionId, {
        from,
        to,
        // A day either side, so an event on the window's first or last day is inside it
        // wherever on earth the reader is. Their screen places each one exactly.
        fromInstant: `${addCalendarDays(from as CivilDate, -1)}T00:00:00.000Z`,
        toInstant: `${addCalendarDays(to as CivilDate, 2)}T00:00:00.000Z`,
      });
      return c.json(
        {
          shownCalendars,
          events: events.map((event) => ({
            id: event.remoteEventId,
            calendarRemoteId: event.calendarRemoteId,
            calendarName: event.calendarName,
            title: event.title,
            location: event.location,
            wholeDay: event.wholeDay,
            startsOn: event.startsOn,
            endsOn: event.endsOn,
            startsAt: event.startsAt,
            endsAt: event.endsAt,
          })),
          truncated,
        },
        200,
      );
    },
  );
}
