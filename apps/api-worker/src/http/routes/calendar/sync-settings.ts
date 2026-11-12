import type { OpenAPIHono } from "@hono/zod-openapi";
import {
  CalendarSyncFirmLimits,
  CalendarSyncFirmLimitsSet,
  CalendarSyncRulesReplace,
  CalendarSyncSettings,
} from "@magna-carta/calendar/sync-contract";
import {
  readSyncRules,
  readSyncSubjects,
  replaceSyncRules,
  setSyncFirmLimits,
  SyncRuleRefusal,
} from "@magna-carta/calendar/sync-rule-service";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import type { IntegrationConnectionId } from "@magna-carta/identifiers/types";
import { fetchHttpClient } from "@magna-carta/integrations/http";
import type { Context } from "hono";
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
import {
  memberAccount,
  memberAccountCalendars,
  memberSyncSettings,
  type MemberAccountRow,
} from "./member-account.ts";

// CALENDAR SYNC SETTINGS: what the firm lets leave, and what each member chose to send.
//
// Two pairs of routes over two tables. The firm pair sets the outer limit for every event type and
// for deadlines; the member pair reads and replaces one member's own rules inside that limit. The
// service in @magna-carta/calendar holds the rule that a member's rule never exceeds the firm's
// limit; these routes address, authorize and translate, and decide nothing.
//
// NOTHING HERE SENDS AN EVENT ANYWHERE. Saving a rule records a choice.
//
// THE MEMBER'S OWN PROVIDER IS ASKED ON EVERY READ AND EVERY SAVE, for the list of calendars a rule
// may point at. A save is checked against that list as it stands at that moment and takes each
// calendar's name from it, so a rule can never be stored pointing somewhere the account does not
// have. When the provider cannot be asked, the read still answers (with no calendar list, so the
// page shows the saved rules and offers no change) and the save is refused.

const MEMBER_PERMISSION = "calendar:read" as const;
const FIRM_PERMISSION = "calendar:manageSyncPolicy" as const;

type SyncSettingsApp = OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>;
type SyncSettingsContext = Context<{ Bindings: Bindings; Variables: AppVariables }>;

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
    description: "A subject or calendar named cannot be used; `errors` says which subject and why",
    content: problemContent,
  },
  429: { description: "Rate limit exceeded", content: problemContent },
  503: {
    description:
      "The member's provider could not be asked for their calendars, so nothing was saved",
    content: problemContent,
  },
} as const;

const readMineMeta: RouteMeta = {
  operationId: "calendarSync.readMine",
  surface: "app",
  authenticated: true,
  permission: MEMBER_PERMISSION,
  resource: "firm",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

const replaceMineMeta: RouteMeta = {
  operationId: "calendarSync.replaceMyRules",
  surface: "app",
  authenticated: true,
  permission: MEMBER_PERMISSION,
  resource: "firm",
  audited: true,
  // A replace of the whole set: saving the same set twice lands the same rows.
  idempotency: "optional",
  rateLimit: "default",
};

const readFirmMeta: RouteMeta = {
  operationId: "calendarSync.readFirmLimits",
  surface: "app",
  authenticated: true,
  permission: FIRM_PERMISSION,
  resource: "firm",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

const setFirmMeta: RouteMeta = {
  operationId: "calendarSync.setFirmLimits",
  surface: "app",
  authenticated: true,
  permission: FIRM_PERMISSION,
  resource: "firm",
  audited: true,
  // An upsert per subject: setting the same limits twice lands the same rows.
  idempotency: "optional",
  rateLimit: "default",
};

const readMineRoute = defineOpenAPIRoute(readMineMeta, {
  method: "get",
  path: "/api/v1/me/calendar-sync",
  description:
    "The session member's calendar sync settings: their connected account, that account's " +
    "calendars, every event type with the firm's limit on it, and the member's own rules. " +
    "Nothing syncs for a subject that has no rule.",
  responses: {
    200: {
      description: "The member's calendar sync settings",
      content: { "application/json": { schema: CalendarSyncSettings } },
    },
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
    429: errorResponses[429],
  },
});

const replaceMineRoute = defineOpenAPIRoute(replaceMineMeta, {
  method: "put",
  path: "/api/v1/me/calendar-sync/rules",
  description:
    "Replaces the session member's whole set of calendar sync rules. A subject absent from the " +
    "set is not synced. Refused when a rule names a subject the firm does not let leave, or a " +
    "calendar the member's account does not have or cannot write to.",
  request: {
    body: { content: { "application/json": { schema: CalendarSyncRulesReplace } }, required: true },
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

const readFirmRoute = defineOpenAPIRoute(readFirmMeta, {
  method: "get",
  path: "/api/v1/calendar-sync/firm-limits",
  description:
    "The firm's limit on calendar sync: for every event type and for deadlines, whether it may be " +
    "copied to a member's own calendar and with how much detail. A subject the firm has never " +
    "set may leave in full detail.",
  responses: {
    200: {
      description: "The firm's limits",
      content: { "application/json": { schema: CalendarSyncFirmLimits } },
    },
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
    429: errorResponses[429],
  },
});

const setFirmRoute = defineOpenAPIRoute(setFirmMeta, {
  method: "put",
  path: "/api/v1/calendar-sync/firm-limits",
  description:
    "Sets the firm's limit on the subjects named and leaves the rest as they were. Stopping a " +
    "subject from leaving removes every member's rule for it in the same write.",
  request: {
    body: {
      content: { "application/json": { schema: CalendarSyncFirmLimitsSet } },
      required: true,
    },
  },
  responses: {
    200: {
      description: "The firm's limits after the write",
      content: { "application/json": { schema: CalendarSyncFirmLimits } },
    },
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
    422: errorResponses[422],
    429: errorResponses[429],
  },
});

type ConnectionRow = MemberAccountRow;

function refusalProblem(c: SyncSettingsContext, refusal: SyncRuleRefusal) {
  return problemJson(c, {
    type: "calendar-sync-setting-refused",
    title: "A calendar sync setting could not be saved",
    status: 422,
    detail: `${refusal.message}. Nothing was saved.`,
    errors: [{ path: refusal.subject, code: refusal.code, detail: refusal.message }],
  });
}

export function registerCalendarSyncSettingsRoutes(
  app: SyncSettingsApp,
  chokepoint: Chokepoint,
  deps: ConnectedAccountsRouteDeps = {},
): void {
  const http = deps.http ?? fetchHttpClient();
  const credentialStoreForFirm = deps.credentialStoreForFirm ?? integrationCredentialStoreForFirm;
  const now = deps.now ?? (() => new Date());

  const ports = { http, credentialStoreForFirm, now };
  const memberConnection = memberAccount;
  const memberCalendars = (c: SyncSettingsContext, connection: ConnectionRow) =>
    memberAccountCalendars(c, connection, ports);

  const settingsBody = memberSyncSettings;

  // GET /api/v1/me/calendar-sync
  app.openapi(
    { ...readMineRoute, middleware: chokepointMiddleware(chokepoint, readMineRoute) },
    async (c) => {
      const connection = await memberConnection(c);
      const calendars = connection === null ? null : await memberCalendars(c, connection);
      return c.json(await settingsBody(c, connection, calendars), 200);
    },
  );

  // PUT /api/v1/me/calendar-sync/rules
  app.openapi(
    { ...replaceMineRoute, middleware: chokepointMiddleware(chokepoint, replaceMineRoute) },
    async (c) => {
      const userId = requireChokepointUserId(c);
      const firm = requireChokepointFirmContext(c);
      const { rules } = c.req.valid("json");
      const connection = await memberConnection(c);
      if (connection === null) {
        return problemJson(c, {
          type: "conflict",
          title: "No connected account",
          status: 409,
          detail:
            "You have not connected a calendar account, so there is nowhere to send events. Nothing was saved.",
        });
      }
      const calendars = await memberCalendars(c, connection);
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
      const instant = now().toISOString();
      const clock = { now: () => instant };
      let effect;
      try {
        ({ effect } = await replaceSyncRules(
          firm.firmDatabase,
          connection.id as IntegrationConnectionId,
          rules,
          calendars.calendars,
          { clock, actorUserId: userId },
        ));
      } catch (caught) {
        if (caught instanceof SyncRuleRefusal) return refusalProblem(c, caught);
        throw caught;
      }
      await commitEffectBatch(firm.firmDatabase, effect, clock);
      return c.json(await settingsBody(c, connection, calendars), 200);
    },
  );

  // GET /api/v1/calendar-sync/firm-limits
  app.openapi(
    { ...readFirmRoute, middleware: chokepointMiddleware(chokepoint, readFirmRoute) },
    async (c) =>
      c.json(
        { subjects: await readSyncSubjects(requireChokepointFirmContext(c).firmDatabase) },
        200,
      ),
  );

  // PUT /api/v1/calendar-sync/firm-limits
  app.openapi(
    { ...setFirmRoute, middleware: chokepointMiddleware(chokepoint, setFirmRoute) },
    async (c) => {
      const userId = requireChokepointUserId(c);
      const firm = requireChokepointFirmContext(c);
      const { limits } = c.req.valid("json");
      const instant = now().toISOString();
      const clock = { now: () => instant };
      let effect;
      try {
        ({ effect } = await setSyncFirmLimits(firm.firmDatabase, limits, {
          clock,
          actorUserId: userId,
        }));
      } catch (caught) {
        if (caught instanceof SyncRuleRefusal) return refusalProblem(c, caught);
        throw caught;
      }
      await commitEffectBatch(firm.firmDatabase, effect, clock);
      return c.json({ subjects: await readSyncSubjects(firm.firmDatabase) }, 200);
    },
  );
}
