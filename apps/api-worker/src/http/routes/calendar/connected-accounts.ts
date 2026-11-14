import { z, type OpenAPIHono } from "@hono/zod-openapi";
import {
  CALENDAR_PROVIDERS,
  ConnectedAccount,
  ConnectedAccountDisconnectAck,
  ConnectedAccountList,
} from "@magna-carta/calendar/sync-contract";
import { CALENDAR_SYNC_CATEGORY } from "@magna-carta/calendar/sync-port";
import { deleteSyncIssuesStatement } from "@magna-carta/calendar/sync-issue-statements";
import {
  deleteExternalEventsStatement,
  deleteShownCalendarsStatement,
} from "@magna-carta/calendar/sync-shown-statements";
import { deleteSyncLinksStatement } from "@magna-carta/calendar/sync-link-statements";
import { deleteSyncRulesStatement } from "@magna-carta/calendar/sync-rule-statements";
import { domainAuditStatement } from "@magna-carta/data-access/audit-statements";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import {
  deleteConnectionStatement,
  selectConnectionStatement,
} from "@magna-carta/data-access/integration-connection-statements";
import { deleteIntegrationCredentialStatement } from "@magna-carta/data-access/integration-credential-statements";
import type { IntegrationConnectionId } from "@magna-carta/identifiers/types";
import { fetchHttpClient, type HttpClient } from "@magna-carta/integrations/http";
import type { Bindings } from "../../../bindings.ts";
import {
  calendarProviderOfAdapter,
  resolveCalendarApplication,
} from "../../../calendar-sync/calendar-providers.ts";
import {
  integrationCredentialStoreForFirm,
  type CredentialStoreForFirm,
} from "../../../plugins/credential-store.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointUserId,
} from "../../chokepoint/context-accessors.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { Problem, problemJson } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";
import { registerConnectedAccountSignInRoutes } from "./connected-account-sign-in.ts";

// A MEMBER'S OWN ACCOUNTS AT A CALENDAR PROVIDER. Each member connects their own; nobody connects
// one for somebody else and the firm holds none. Every statement below is scoped to the session's
// own user id, which is what makes the gate below safe to give every seat that can see a calendar.
//
// WHAT CONNECTING DOES, AND ALL IT DOES: it stores the account's sealed token and records that the
// account is connected. Nothing is copied to or from the account by any route here.
//
// WHY THE GATE IS calendar:read. The chokepoint refuses an authenticated mutation naming no
// permission. A member connects an account in order to have the events they can already see reach
// their own calendar, so the capability to see the calendar is the one that fits: a firm that takes
// calendar:read from a seat has, in the same act, decided that seat's events do not leave either.
//
// THE DEPLOYMENT MAY HAVE NO APPLICATION AT A PROVIDER. That is the shipped state until somebody
// registers one, and it is answered by name: the list says the provider is not available, the
// sign-in route answers 501, and the return route sends the browser back saying so. Never a 500.
//
// Signing in and coming back are in connected-account-sign-in.ts; this module lists a member's
// accounts and disconnects one.

const PERMISSION = "calendar:read" as const;

type ConnectedAccountsApp = OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>;

// The seams a test puts a fake provider behind. Production passes nothing.
export interface ConnectedAccountsRouteDeps {
  readonly http?: HttpClient;
  readonly credentialStoreForFirm?: CredentialStoreForFirm;
  readonly now?: () => Date;
}

const errorResponses = {
  401: {
    description: "No valid session",
    content: { "application/problem+json": { schema: Problem } },
  },
  403: {
    description: "The session member lacks calendar:read",
    content: { "application/problem+json": { schema: Problem } },
  },
  404: {
    description:
      "The firm is unreachable, the member is deactivated, or the member has no such account",
    content: { "application/problem+json": { schema: Problem } },
  },
  429: {
    description: "Rate limit exceeded",
    content: { "application/problem+json": { schema: Problem } },
  },
} as const;

const listMeta: RouteMeta = {
  operationId: "connectedAccounts.list",
  surface: "app",
  authenticated: true,
  // A read of the member's own rows: there is no capability to name for seeing which of your own
  // accounts you connected.
  permission: null,
  resource: "firm",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

const disconnectMeta: RouteMeta = {
  operationId: "connectedAccounts.disconnect",
  surface: "app",
  authenticated: true,
  permission: PERMISSION,
  resource: "firm",
  audited: true,
  // Deleting a row that is already gone is answered 404 and lands nothing twice, so a retried
  // disconnect needs no key to be safe.
  idempotency: "optional",
  rateLimit: "default",
  reversal: {
    kind: "none",
    reason:
      "The stored sign-in is deleted. Connecting again means signing in to the account again, which only its owner can do.",
  },
};

const listRoute = defineOpenAPIRoute(listMeta, {
  method: "get",
  path: "/api/v1/me/connected-accounts",
  description:
    "The session member's own connected accounts, and which providers this deployment can connect.",
  responses: {
    200: {
      description: "The member's connected accounts",
      content: { "application/json": { schema: ConnectedAccountList } },
    },
    401: errorResponses[401],
    404: errorResponses[404],
    429: errorResponses[429],
  },
});

const disconnectRoute = defineOpenAPIRoute(disconnectMeta, {
  method: "delete",
  path: "/api/v1/me/connected-accounts/{id}",
  description:
    "Disconnects one of the session member's own accounts and deletes its stored sign-in. " +
    "Nothing in the account itself is changed.",
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: {
      description: "Disconnected",
      content: { "application/json": { schema: ConnectedAccountDisconnectAck } },
    },
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
    429: errorResponses[429],
  },
});

interface ConnectionRow {
  readonly id: string;
  readonly adapter_id: string;
  readonly status: z.infer<typeof ConnectedAccount>["status"];
  readonly account_label: string | null;
  readonly created_at: string;
}

export function registerConnectedAccountsRoutes(
  app: ConnectedAccountsApp,
  chokepoint: Chokepoint,
  deps: ConnectedAccountsRouteDeps = {},
): void {
  const now = deps.now ?? (() => new Date());
  registerConnectedAccountSignInRoutes(app, chokepoint, {
    http: deps.http ?? fetchHttpClient(),
    credentialStoreForFirm: deps.credentialStoreForFirm ?? integrationCredentialStoreForFirm,
    now,
  });

  // GET /api/v1/me/connected-accounts
  app.openapi(
    { ...listRoute, middleware: chokepointMiddleware(chokepoint, listRoute) },
    async (c) => {
      const userId = requireChokepointUserId(c);
      const firm = requireChokepointFirmContext(c);
      const { results } = await selectConnectionStatement(
        firm.firmDatabase,
        CALENDAR_SYNC_CATEGORY,
        userId,
      ).all<ConnectionRow>();
      return c.json(
        {
          providers: CALENDAR_PROVIDERS.map((provider) => ({
            provider,
            available: resolveCalendarApplication(c.env, c.req.url, provider) !== undefined,
          })),
          accounts: results.flatMap((row) => {
            const provider = calendarProviderOfAdapter(row.adapter_id);
            return provider === undefined
              ? []
              : [
                  {
                    id: row.id,
                    provider,
                    accountLabel: row.account_label,
                    status: row.status,
                    connectedAt: row.created_at,
                  },
                ];
          }),
        },
        200,
      );
    },
  );

  // DELETE /api/v1/me/connected-accounts/{id}
  app.openapi(
    { ...disconnectRoute, middleware: chokepointMiddleware(chokepoint, disconnectRoute) },
    async (c) => {
      const userId = requireChokepointUserId(c);
      const firm = requireChokepointFirmContext(c);
      const { id } = c.req.valid("param");
      // Found through the member's own principal and never by the id alone, so one member's id in
      // another member's request finds nothing.
      const existing = await selectConnectionStatement(
        firm.firmDatabase,
        CALENDAR_SYNC_CATEGORY,
        userId,
      ).first<{ id: string; adapter_id: string; credential_ref: string }>();
      if (existing === null || existing.id !== id) {
        return problemJson(c, {
          type: "not-found",
          title: "Not found",
          status: 404,
          detail: "You have no such connected account.",
        });
      }
      const instant = now().toISOString();
      await commitEffectBatch(
        firm.firmDatabase,
        {
          statements: [
            // The member's rules first: they point at the connection row and mean nothing without it.
            deleteSyncRulesStatement(firm.firmDatabase, existing.id as IntegrationConnectionId),
            // And the record of which copies are in their calendar. The copies themselves stay
            // there: the sign-in that could have removed them is what this batch deletes.
            deleteSyncLinksStatement(firm.firmDatabase, existing.id as IntegrationConnectionId),
            deleteSyncIssuesStatement(firm.firmDatabase, existing.id as IntegrationConnectionId),
            // What was read from their own calendars for them, and which calendars those were.
            deleteExternalEventsStatement(
              firm.firmDatabase,
              existing.id as IntegrationConnectionId,
            ),
            deleteShownCalendarsStatement(
              firm.firmDatabase,
              existing.id as IntegrationConnectionId,
            ),
            deleteConnectionStatement(firm.firmDatabase, existing.id as IntegrationConnectionId),
            // The sealed token goes with the row, in the same batch: a working token to somebody's
            // calendar that outlives the only row pointing at it is material nothing will ever clear.
            deleteIntegrationCredentialStatement(firm.firmDatabase, existing.credential_ref),
            domainAuditStatement(firm.firmDatabase, {
              event: "calendar_sync.account_disconnected",
              subjectId: existing.id,
              actorUserId: userId,
              clock: { now: () => instant },
              metadata: { provider: calendarProviderOfAdapter(existing.adapter_id) ?? "unknown" },
            }),
          ],
          outboxMessages: [],
        },
        { now: () => instant },
      );
      return c.json({ id: existing.id, status: "disconnected" as const }, 200);
    },
  );
}
