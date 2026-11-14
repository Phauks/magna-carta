import { z, type OpenAPIHono } from "@hono/zod-openapi";
import {
  ConnectedAccountSignInStart,
  type CalendarProvider,
} from "@magna-carta/calendar/sync-contract";
import type { HttpClient } from "@magna-carta/integrations/http";
import {
  CODE_VERIFIER_BYTE_LENGTH,
  codeChallengeFor,
  codeVerifierFrom,
} from "@magna-carta/integrations/oauth-sign-in";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Bindings } from "../../../bindings.ts";
import { resolveCalendarApplication } from "../../../calendar-sync/calendar-providers.ts";
import {
  connectCalendarAccount,
  type ConnectCalendarAccountOutcome,
} from "../../../calendar-sync/connect-calendar-account.ts";
import { GOOGLE_CALLBACK_PATH } from "../../../calendar-sync/google-application.ts";
import { MICROSOFT_CALLBACK_PATH } from "../../../calendar-sync/microsoft-application.ts";
import {
  mintSignInAttempt,
  readSignInAttempt,
  SIGN_IN_ATTEMPT_COOKIE,
  SIGN_IN_ATTEMPT_LIFETIME_SECONDS,
} from "../../../calendar-sync/sign-in-attempt.ts";
import { constantTimeStringEquals } from "../../../constant-time.ts";
import type { CredentialStoreForFirm } from "../../../plugins/credential-store.ts";
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

// SIGNING A MEMBER IN TO THEIR OWN ACCOUNT AT A CALENDAR PROVIDER, AND THEIR RETURN FROM IT.
//
// Two routes per provider, and the same two for each: one hands the browser the address of the
// provider's sign-in page, the other is where the provider sends the browser back. Each provider
// has addresses of its own because the return address is registered with the provider character
// for character, and because a published route names one thing.
//
// Whose account, and why the gate is calendar:read, are stated beside the routes that list and
// disconnect an account (connected-accounts.ts).

const PERMISSION = "calendar:read" as const;

type SignInApp = OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>;

export interface ConnectedAccountSignInPorts {
  readonly http: HttpClient;
  readonly credentialStoreForFirm: CredentialStoreForFirm;
  readonly now: () => Date;
}

// The screen a member is returned to, and the words that tell it what happened and at which
// provider. Words and never a message: the address is visible, kept in history, and whatever the
// provider said may carry the member's code.
const RETURN_SCREEN_PATH = "/settings/connected-accounts";
type SignInOutcome = ConnectCalendarAccountOutcome | "expired" | "unavailable";

function returnScreen(provider: CalendarProvider, outcome: SignInOutcome): string {
  return `${RETURN_SCREEN_PATH}?outcome=${outcome}&provider=${provider}`;
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
    description: "The firm is unreachable or the member is deactivated",
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

// What differs between one provider's pair of routes and another's: its names, and nothing else.
interface ProviderRoutes {
  readonly provider: CalendarProvider;
  // The provider's company, as a sentence names who the browser is sent to.
  readonly company: string;
  // The member's account there, as they would call it.
  readonly account: string;
  // The product a member connects, as the screens name it.
  readonly product: string;
  readonly operationName: string;
  readonly startPath: string;
  readonly callbackPath: string;
}

const PROVIDER_ROUTES: readonly ProviderRoutes[] = [
  {
    provider: "microsoft",
    company: "Microsoft",
    account: "Microsoft 365 account",
    product: "Outlook",
    operationName: "Microsoft",
    startPath: "/api/v1/me/connected-accounts/microsoft/sign-in",
    callbackPath: MICROSOFT_CALLBACK_PATH,
  },
  {
    provider: "google",
    company: "Google",
    account: "Google account",
    product: "Google Calendar",
    operationName: "Google",
    startPath: "/api/v1/me/connected-accounts/google/sign-in",
    callbackPath: GOOGLE_CALLBACK_PATH,
  },
];

function registerProvider(
  app: SignInApp,
  chokepoint: Chokepoint,
  ports: ConnectedAccountSignInPorts,
  names: ProviderRoutes,
): void {
  const { provider, company } = names;

  const startMeta: RouteMeta = {
    operationId: `connectedAccounts.start${names.operationName}SignIn`,
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
    operationId: `connectedAccounts.finish${names.operationName}SignIn`,
    surface: "app",
    authenticated: true,
    permission: PERMISSION,
    resource: "firm",
    audited: true,
    idempotency: "optional",
    rateLimit: "default",
  };

  const startRoute = defineOpenAPIRoute(startMeta, {
    method: "post",
    path: names.startPath,
    description:
      `Starts connecting the session member's own ${names.account} for calendar sync, and ` +
      `answers the address of ${company}'s sign-in page. The request asks ${company} for the ` +
      "member's calendars and nothing about their mail. Nothing is stored until the member returns.",
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
    path: names.callbackPath,
    description:
      `Where ${company} returns the member's browser after sign-in. Records the connection when ` +
      "the return matches a sign-in this browser started, and always redirects to the Connected " +
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

  app.openapi(
    { ...startRoute, middleware: chokepointMiddleware(chokepoint, startRoute) },
    async (c) => {
      const userId = requireChokepointUserId(c);
      const firmId = requireChokepointFirmId(c);
      const application = resolveCalendarApplication(c.env, c.req.url, provider);
      if (application === undefined) {
        return problemJson(c, {
          type: "not-implemented",
          title: `${names.product} cannot be connected in this deployment`,
          status: 501,
          detail: `This deployment has not been registered with ${company}, so no ${names.account} can be connected. Nothing was changed.`,
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
        { state, codeVerifier, userId, firmId, provider },
        ports.now(),
      );
      // Lax, because the return from the provider is a top-level navigation from another site and
      // a Strict cookie would not be sent with it. HttpOnly, so no script on the page reads the
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
          authorizationUrl: application.authorizationUrl({
            state,
            codeChallenge: await codeChallengeFor(codeVerifier),
          }),
        },
        200,
      );
    },
  );

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
        ports.now(),
      );
      deleteCookie(c, SIGN_IN_ATTEMPT_COOKIE, { path: "/", secure: true });

      const application = resolveCalendarApplication(c.env, c.req.url, provider);
      if (application === undefined) return c.redirect(returnScreen(provider, "unavailable"), 302);
      if (attempt === null) return c.redirect(returnScreen(provider, "expired"), 302);
      // Checked before anything the provider said is believed, the error included: a return that
      // this browser did not start says nothing about this member. A sign-in started at one
      // provider is not finished at another's address.
      if (
        query.state === undefined ||
        !(await constantTimeStringEquals(query.state, attempt.state)) ||
        attempt.userId !== userId ||
        attempt.firmId !== firmId ||
        attempt.provider !== provider
      ) {
        return c.redirect(returnScreen(provider, "expired"), 302);
      }
      // The member pressed Cancel at the provider, or an administrator there does not allow it.
      if (query.error !== undefined) return c.redirect(returnScreen(provider, "declined"), 302);
      if (query.code === undefined) return c.redirect(returnScreen(provider, "failed"), 302);

      const outcome = await connectCalendarAccount({
        http: ports.http,
        now: ports.now,
        application,
        code: query.code,
        codeVerifier: attempt.codeVerifier,
        userId,
        firmDatabase: firm.firmDatabase,
        credentials: ports.credentialStoreForFirm(protectedReadContext(c)),
      });
      return c.redirect(returnScreen(provider, outcome), 302);
    },
  );
}

export function registerConnectedAccountSignInRoutes(
  app: SignInApp,
  chokepoint: Chokepoint,
  ports: ConnectedAccountSignInPorts,
): void {
  for (const names of PROVIDER_ROUTES) registerProvider(app, chokepoint, ports, names);
}
