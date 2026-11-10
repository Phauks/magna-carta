import { z, type OpenAPIHono } from "@hono/zod-openapi";
import {
  ConnectedAccount,
  ConnectedAccountDisconnectAck,
  ConnectedAccountList,
  ConnectedAccountSignInStart,
} from "@magna-carta/calendar/sync-contract";
import { CALENDAR_SYNC_CATEGORY } from "@magna-carta/calendar/sync-port";
import { domainAuditStatement } from "@magna-carta/data-access/audit-statements";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import {
  deleteConnectionStatement,
  selectConnectionStatement,
} from "@magna-carta/data-access/integration-connection-statements";
import { deleteIntegrationCredentialStatement } from "@magna-carta/data-access/integration-credential-statements";
import type { IntegrationConnectionId } from "@magna-carta/identifiers/types";
import { fetchHttpClient, type HttpClient } from "@magna-carta/integrations/http";
import { MICROSOFT_CALENDAR_ADAPTER_ID } from "@magna-carta/microsoft-graph/calendar-sync";
import {
  authorizationUrl,
  CODE_VERIFIER_BYTE_LENGTH,
  codeChallengeFor,
  codeVerifierFrom,
  MICROSOFT_CALENDAR_SCOPES,
} from "@magna-carta/microsoft-graph/sign-in";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Bindings } from "../../../bindings.ts";
import { connectMicrosoftAccount } from "../../../calendar-sync/connect-microsoft-account.ts";
import { resolveMicrosoftApplication } from "../../../calendar-sync/microsoft-application.ts";
import {
  mintSignInAttempt,
  readSignInAttempt,
  SIGN_IN_ATTEMPT_COOKIE,
  SIGN_IN_ATTEMPT_LIFETIME_SECONDS,
} from "../../../calendar-sync/sign-in-attempt.ts";
import { constantTimeStringEquals } from "../../../constant-time.ts";
import {
  integrationCredentialStoreForFirm,
  type CredentialStoreForFirm,
} from "../../../plugins/credential-store.ts";
import { protectedReadContext } from "../../../protected-read-context.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointFirmId,
  requireChokepointUserId,
} from "../../chokepoint/context-accessors.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { Problem, problemJson } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";

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
// THE DEPLOYMENT MAY HAVE NO APPLICATION AT THE PROVIDER. That is the shipped state until somebody
// registers one, and it is answered by name: the list says the provider is not available, the
// sign-in route answers 501, and the return route sends the browser back saying so. Never a 500.

const PERMISSION = "calendar:read" as const;

type ConnectedAccountsApp = OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>;

// The seams a test puts a fake provider behind. Production passes nothing.
export interface ConnectedAccountsRouteDeps {
  readonly http?: HttpClient;
  readonly credentialStoreForFirm?: CredentialStoreForFirm;
  readonly now?: () => Date;
}

// The screen a member is returned to, and the one word that tells it what happened. A word and
// never a message: the address is visible, kept in history, and whatever the provider said may
// carry the member's code.
const RETURN_SCREEN_PATH = "/settings/connected-accounts";
type SignInOutcome = "connected" | "declined" | "expired" | "unavailable" | "failed";

function returnScreen(outcome: SignInOutcome): string {
  return `${RETURN_SCREEN_PATH}?outcome=${outcome}`;
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
  501: {
    description: "This deployment is not registered with the provider, so no account can connect",
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

const startMeta: RouteMeta = {
  operationId: "connectedAccounts.startMicrosoftSignIn",
  surface: "app",
  authenticated: true,
  permission: PERMISSION,
  resource: "firm",
  // Starting a sign-in changes nothing the firm holds: it hands the browser an address and a
  // short-lived cookie. The connection is recorded, and audited, by the return route.
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

const finishMeta: RouteMeta = {
  operationId: "connectedAccounts.finishMicrosoftSignIn",
  surface: "app",
  authenticated: true,
  permission: PERMISSION,
  resource: "firm",
  audited: true,
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

const startRoute = defineOpenAPIRoute(startMeta, {
  method: "post",
  path: "/api/v1/me/connected-accounts/microsoft/sign-in",
  description:
    "Starts connecting the session member's own Microsoft 365 account for calendar sync, and " +
    "answers the address of Microsoft's sign-in page. The request asks Microsoft for the member's " +
    "calendars and nothing about their mail. Nothing is stored until the member returns.",
  responses: {
    200: {
      description: "Where to send the browser",
      content: { "application/json": { schema: ConnectedAccountSignInStart } },
    },
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
    429: errorResponses[429],
    501: errorResponses[501],
  },
});

const finishRoute = defineOpenAPIRoute(finishMeta, {
  method: "get",
  path: "/api/v1/integrations/microsoft/callback",
  description:
    "Where Microsoft returns the member's browser after sign-in. Records the connection when the " +
    "return matches a sign-in this browser started, and always redirects to the Connected " +
    "Accounts screen with one word saying what happened. Not called by a client.",
  request: {
    query: z.object({
      code: z.string().optional(),
      state: z.string().optional(),
      error: z.string().optional(),
    }),
  },
  responses: {
    302: { description: "Back to the Connected Accounts screen, naming the outcome" },
    401: errorResponses[401],
    403: errorResponses[403],
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
  const http = deps.http ?? fetchHttpClient();
  const credentialStoreForFirm = deps.credentialStoreForFirm ?? integrationCredentialStoreForFirm;
  const now = deps.now ?? (() => new Date());

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
          providers: [
            {
              provider: "microsoft" as const,
              available: resolveMicrosoftApplication(c.env, c.req.url) !== undefined,
            },
          ],
          accounts: results
            .filter((row) => row.adapter_id === MICROSOFT_CALENDAR_ADAPTER_ID)
            .map((row) => ({
              id: row.id,
              provider: "microsoft" as const,
              accountLabel: row.account_label,
              status: row.status,
              connectedAt: row.created_at,
            })),
        },
        200,
      );
    },
  );

  // POST /api/v1/me/connected-accounts/microsoft/sign-in
  app.openapi(
    { ...startRoute, middleware: chokepointMiddleware(chokepoint, startRoute) },
    async (c) => {
      const userId = requireChokepointUserId(c);
      const firmId = requireChokepointFirmId(c);
      const application = resolveMicrosoftApplication(c.env, c.req.url);
      if (application === undefined) {
        return problemJson(c, {
          type: "not-implemented",
          title: "Outlook cannot be connected in this deployment",
          status: 501,
          detail:
            "This deployment has not been registered with Microsoft, so no Outlook account can be connected. Nothing was changed.",
        });
      }
      const codeVerifier = codeVerifierFrom(
        crypto.getRandomValues(new Uint8Array(CODE_VERIFIER_BYTE_LENGTH)),
      );
      const state = codeVerifierFrom(
        crypto.getRandomValues(new Uint8Array(CODE_VERIFIER_BYTE_LENGTH)),
      );
      const attempt = await mintSignInAttempt(
        c.env.AUTH_SECRET,
        { state, codeVerifier, userId, firmId },
        now(),
      );
      // Lax, because the return from Microsoft is a top-level navigation from another site and a
      // Strict cookie would not be sent with it. HttpOnly, so no script on the page reads the
      // verifier.
      setCookie(c, SIGN_IN_ATTEMPT_COOKIE, attempt, {
        httpOnly: true,
        secure: true,
        sameSite: "Lax",
        path: "/",
        maxAge: SIGN_IN_ATTEMPT_LIFETIME_SECONDS,
      });
      return c.json(
        {
          authorizationUrl: authorizationUrl({
            application,
            scopes: MICROSOFT_CALENDAR_SCOPES,
            state,
            codeChallenge: await codeChallengeFor(codeVerifier),
          }),
        },
        200,
      );
    },
  );

  // GET /api/v1/integrations/microsoft/callback
  app.openapi(
    { ...finishRoute, middleware: chokepointMiddleware(chokepoint, finishRoute) },
    async (c) => {
      const userId = requireChokepointUserId(c);
      const firmId = requireChokepointFirmId(c);
      const firm = requireChokepointFirmContext(c);
      const query = c.req.valid("query");

      // The attempt is spent by being read, whatever happens next: a return is answered once.
      const attempt = await readSignInAttempt(
        c.env.AUTH_SECRET,
        getCookie(c, SIGN_IN_ATTEMPT_COOKIE),
        now(),
      );
      deleteCookie(c, SIGN_IN_ATTEMPT_COOKIE, { path: "/", secure: true });

      const application = resolveMicrosoftApplication(c.env, c.req.url);
      if (application === undefined) return c.redirect(returnScreen("unavailable"), 302);
      if (attempt === null) return c.redirect(returnScreen("expired"), 302);
      // Checked before anything the provider said is believed, the error included: a return that
      // this browser did not start says nothing about this member.
      if (
        query.state === undefined ||
        !(await constantTimeStringEquals(query.state, attempt.state)) ||
        attempt.userId !== userId ||
        attempt.firmId !== firmId
      ) {
        return c.redirect(returnScreen("expired"), 302);
      }
      // The member pressed Cancel at Microsoft, or an administrator there does not allow it.
      if (query.error !== undefined) return c.redirect(returnScreen("declined"), 302);
      if (query.code === undefined) return c.redirect(returnScreen("failed"), 302);

      const outcome = await connectMicrosoftAccount({
        http,
        now,
        application,
        code: query.code,
        codeVerifier: attempt.codeVerifier,
        userId,
        firmDatabase: firm.firmDatabase,
        credentials: credentialStoreForFirm(protectedReadContext(c)),
      });
      return c.redirect(returnScreen(outcome), 302);
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
      ).first<{ id: string; credential_ref: string }>();
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
            deleteConnectionStatement(firm.firmDatabase, existing.id as IntegrationConnectionId),
            // The sealed token goes with the row, in the same batch: a working token to somebody's
            // calendar that outlives the only row pointing at it is material nothing will ever clear.
            deleteIntegrationCredentialStatement(firm.firmDatabase, existing.credential_ref),
            domainAuditStatement(firm.firmDatabase, {
              event: "calendar_sync.account_disconnected",
              subjectId: existing.id,
              actorUserId: userId,
              clock: { now: () => instant },
              metadata: { provider: "microsoft" },
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
