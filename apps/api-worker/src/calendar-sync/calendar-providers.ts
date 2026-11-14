import type { CalendarProvider } from "@magna-carta/calendar/sync-contract";
import type { CalendarSyncPort } from "@magna-carta/calendar/sync-port";
import {
  createGoogleCalendarAdapter,
  GOOGLE_CALENDAR_ADAPTER_ID,
} from "@magna-carta/google-calendar/calendar-sync";
import * as google from "@magna-carta/google-calendar/sign-in";
import type { HttpClient } from "@magna-carta/integrations/http";
import type {
  AccountOutcome,
  TokenOutcome,
  TokenRequestDependencies,
} from "@magna-carta/integrations/oauth-sign-in";
import type { Adapter } from "@magna-carta/integrations/port";
import {
  createMicrosoftCalendarAdapter,
  MICROSOFT_CALENDAR_ADAPTER_ID,
} from "@magna-carta/microsoft-graph/calendar-sync";
import * as microsoft from "@magna-carta/microsoft-graph/sign-in";
import type { Bindings } from "../bindings.ts";
import { resolveGoogleApplication } from "./google-application.ts";
import { resolveMicrosoftApplication } from "./microsoft-application.ts";

// THE ONE PLACE THAT KNOWS THERE IS MORE THAN ONE CALENDAR PROVIDER.
//
// Everything that signs a member in, opens their calendar or runs their pass asks here for the
// provider's application and is handed one shape, whichever provider it is. A third provider is a
// package of its own and an entry below; no route, pass or screen changes to take it.

// A provider as this deployment is registered with it: how a member is sent to sign in, how the
// code they come back with becomes tokens, and the adapter that speaks to their calendar.
export interface CalendarProviderApplication {
  readonly provider: CalendarProvider;
  readonly adapterId: string;
  authorizationUrl(input: { readonly state: string; readonly codeChallenge: string }): string;
  redeem(
    dependencies: TokenRequestDependencies,
    input: { readonly code: string; readonly codeVerifier: string },
  ): Promise<TokenOutcome>;
  refresh(dependencies: TokenRequestDependencies, refreshToken: string): Promise<TokenOutcome>;
  // Whether what the provider says it granted includes the calendar. A provider lets a member or
  // an administrator grant less than was asked.
  grantsCalendar(grantedScopes: readonly string[]): boolean;
  readAccount(http: HttpClient, accessToken: string): Promise<AccountOutcome>;
  adapter(dependencies: {
    readonly http: HttpClient;
    readonly now: () => Date;
  }): Adapter<CalendarSyncPort>;
}

type ProviderEnvironment = Pick<
  Bindings,
  | "MICROSOFT_CLIENT_ID"
  | "MICROSOFT_CLIENT_SECRET"
  | "MICROSOFT_TENANT"
  | "GOOGLE_CALENDAR_CLIENT_ID"
  | "GOOGLE_CALENDAR_CLIENT_SECRET"
  | "APP_BASE_URL"
>;

const ADAPTER_IDS: Readonly<Record<CalendarProvider, string>> = {
  microsoft: MICROSOFT_CALENDAR_ADAPTER_ID,
  google: GOOGLE_CALENDAR_ADAPTER_ID,
};

// Which provider a connection's adapter belongs to, or undefined for an adapter that is not a
// calendar provider's.
export function calendarProviderOfAdapter(adapterId: string): CalendarProvider | undefined {
  if (adapterId === MICROSOFT_CALENDAR_ADAPTER_ID) return "microsoft";
  if (adapterId === GOOGLE_CALENDAR_ADAPTER_ID) return "google";
  return undefined;
}

// A refresh never sends the redirect address, so work with no request to read an origin from
// still needs only the application's own identifiers. The placeholder is never sent anywhere.
export const NO_REQUEST_ORIGIN = "https://no-request.invalid";

// Microsoft names a granted permission either bare or as a full address under the Graph origin,
// and in whatever letter case it likes.
function microsoftGrantsCalendar(grantedScopes: readonly string[]): boolean {
  return grantedScopes.some((scope) => {
    const name = scope.slice(scope.lastIndexOf("/") + 1).toLowerCase();
    return name === "calendars.readwrite";
  });
}

// The provider's application in this deployment, or undefined when the deployment is not
// registered with that provider. Undefined is the shipped state until somebody registers one.
export function resolveCalendarApplication(
  env: ProviderEnvironment,
  requestUrl: string,
  provider: CalendarProvider,
): CalendarProviderApplication | undefined {
  if (provider === "microsoft") {
    const application = resolveMicrosoftApplication(env, requestUrl);
    if (application === undefined) return undefined;
    return {
      provider,
      adapterId: ADAPTER_IDS.microsoft,
      authorizationUrl: ({ state, codeChallenge }) =>
        microsoft.authorizationUrl({
          application,
          scopes: microsoft.MICROSOFT_CALENDAR_SCOPES,
          state,
          codeChallenge,
        }),
      redeem: (dependencies, input) =>
        microsoft.redeemAuthorizationCode(dependencies, application, input),
      refresh: (dependencies, refreshToken) =>
        microsoft.refreshAccessToken(dependencies, application, refreshToken),
      grantsCalendar: microsoftGrantsCalendar,
      readAccount: microsoft.readSignedInAccount,
      adapter: ({ http }) => createMicrosoftCalendarAdapter({ http }),
    };
  }
  const application = resolveGoogleApplication(env, requestUrl);
  if (application === undefined) return undefined;
  return {
    provider,
    adapterId: ADAPTER_IDS.google,
    authorizationUrl: ({ state, codeChallenge }) =>
      google.authorizationUrl({
        application,
        scopes: google.GOOGLE_CALENDAR_SCOPES,
        state,
        codeChallenge,
      }),
    redeem: (dependencies, input) =>
      google.redeemAuthorizationCode(dependencies, application, input),
    refresh: (dependencies, refreshToken) =>
      google.refreshAccessToken(dependencies, application, refreshToken),
    grantsCalendar: google.grantsCalendar,
    readAccount: google.readSignedInAccount,
    adapter: ({ http, now }) =>
      createGoogleCalendarAdapter({ http, now, newChannelId: () => crypto.randomUUID() }),
  };
}

// The application behind a connection that already exists, found from the adapter its row names.
export function resolveApplicationOfAdapter(
  env: ProviderEnvironment,
  requestUrl: string,
  adapterId: string,
): CalendarProviderApplication | undefined {
  const provider = calendarProviderOfAdapter(adapterId);
  return provider === undefined ? undefined : resolveCalendarApplication(env, requestUrl, provider);
}
