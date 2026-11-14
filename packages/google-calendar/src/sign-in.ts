import { z } from "zod";
import type { HttpClient } from "@magna-carta/integrations/http";
import {
  applicationCredentialCheckFrom,
  CREDENTIAL_CHECK_REFRESH_TOKEN,
  type AccountOutcome,
  type ApplicationCredentialCheck,
  type TokenOutcome,
  type TokenRequestDependencies,
} from "@magna-carta/integrations/oauth-sign-in";
import { integrationProblem } from "@magna-carta/integrations/problem";

// Signing a member in to their own Google account: the authorization-code flow with a proof key.
// Pure: the caller supplies the random bytes, the clock and the transport, so nothing here reads a
// binding and every branch is testable without a network.

// What the calendar grant asks for, and all it asks for. The first lets events be read and written
// in the member's calendars; the second lets the calendars themselves be listed, which is how a
// member picks one. Neither reaches mail, contacts or files, and nothing about who the member is
// is asked for: the account is named by its own primary calendar.
export const GOOGLE_CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
] as const;

export interface GoogleApplication {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
}

const AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const CALENDAR_ORIGIN = "https://www.googleapis.com";

export interface AuthorizationRequest {
  readonly application: GoogleApplication;
  readonly scopes: readonly string[];
  // Opaque to Google and returned unchanged. The caller binds it to the member's session so a
  // callback nobody started is refused.
  readonly state: string;
  readonly codeChallenge: string;
}

// The address the member's browser is sent to.
//
// `access_type=offline` is what makes Google return a refresh token at all; without it the
// connection would die with the first access token. `consent` because Google hands a refresh token
// only with the consent screen, and a member connecting a second time would otherwise come back
// with none. `select_account` because a lawyer commonly holds more than one Google account in one
// browser, and silently connecting whichever is signed in would put a firm's events in the wrong
// calendar.
export function authorizationUrl(request: AuthorizationRequest): string {
  const url = new URL(AUTHORIZATION_ENDPOINT);
  url.search = new URLSearchParams({
    client_id: request.application.clientId,
    response_type: "code",
    redirect_uri: request.application.redirectUri,
    scope: request.scopes.join(" "),
    state: request.state,
    code_challenge: request.codeChallenge,
    code_challenge_method: "S256",
    access_type: "offline",
    prompt: "consent select_account",
  }).toString();
  return url.toString();
}

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().positive(),
  refresh_token: z.string().min(1).optional(),
  scope: z.string().optional(),
});

const tokenErrorSchema = z.object({ error: z.string() });

// The token endpoint's answer that means "the member has to sign in again" rather than "try
// later": the grant was withdrawn, expired from disuse, or an administrator removed the access.
const SIGN_IN_AGAIN_ERRORS: ReadonlySet<string> = new Set(["invalid_grant"]);

async function requestToken(
  dependencies: TokenRequestDependencies,
  application: GoogleApplication,
  grant: Readonly<Record<string, string>>,
  // Google answers a refresh with no refresh token, and the one held goes on standing.
  standingRefreshToken: string | undefined,
): Promise<TokenOutcome> {
  let response;
  try {
    response = await dependencies.http.request({
      method: "POST",
      url: TOKEN_ENDPOINT,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: application.clientId,
        client_secret: application.clientSecret,
        ...grant,
      }).toString(),
    });
  } catch {
    return {
      ok: false,
      problem: integrationProblem("network", 503, "Google could not be reached"),
    };
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    json = undefined;
  }

  if (response.status >= 400) {
    // Only the error CODE is read. The description beside it can repeat what was sent, and what was
    // sent includes the client secret and the member's code.
    const failure = tokenErrorSchema.safeParse(json);
    const code = failure.success ? failure.data.error : undefined;
    if (code !== undefined && SIGN_IN_AGAIN_ERRORS.has(code)) {
      return {
        ok: false,
        problem: integrationProblem("auth", 401, "Google asks the member to sign in again"),
      };
    }
    if (response.status === 429) {
      return {
        ok: false,
        problem: integrationProblem("rate_limit", 429, "Google is limiting requests"),
      };
    }
    if (response.status >= 500) {
      return {
        ok: false,
        problem: integrationProblem("upstream", 502, `Google responded ${response.status}`),
      };
    }
    // What is left is a request Google will refuse every time: a wrong secret, a redirect address
    // that is not registered, a scope the application may not ask for. Retrying cannot help.
    return {
      ok: false,
      problem: integrationProblem("validation", 400, "Google refused the sign-in request"),
    };
  }

  const parsed = tokenResponseSchema.safeParse(json);
  const refreshToken = parsed.success
    ? (parsed.data.refresh_token ?? standingRefreshToken)
    : undefined;
  if (!parsed.success || refreshToken === undefined) {
    return {
      ok: false,
      problem: integrationProblem("validation", 502, "Google's sign-in answer could not be read"),
    };
  }
  return {
    ok: true,
    credential: {
      kind: "oauth",
      accessToken: parsed.data.access_token,
      refreshToken,
      expiresAt: new Date(
        dependencies.now().getTime() + parsed.data.expires_in * 1000,
      ).toISOString(),
    },
    grantedScopes: (parsed.data.scope ?? "").split(" ").filter((scope) => scope.length > 0),
  };
}

// Trades the code Google handed the member's browser for the account's tokens. The verifier is
// the secret half of the challenge the authorization address carried.
export function redeemAuthorizationCode(
  dependencies: TokenRequestDependencies,
  application: GoogleApplication,
  input: { readonly code: string; readonly codeVerifier: string },
): Promise<TokenOutcome> {
  return requestToken(
    dependencies,
    application,
    {
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: application.redirectUri,
      code_verifier: input.codeVerifier,
    },
    undefined,
  );
}

export function refreshAccessToken(
  dependencies: TokenRequestDependencies,
  application: GoogleApplication,
  refreshToken: string,
): Promise<TokenOutcome> {
  return requestToken(
    dependencies,
    application,
    { grant_type: "refresh_token", refresh_token: refreshToken },
    refreshToken,
  );
}

// Google lets a member untick any permission on its consent screen. Both are needed: events cannot
// be sent without the first, and a destination cannot be chosen without the second.
export function grantsCalendar(grantedScopes: readonly string[]): boolean {
  return GOOGLE_CALENDAR_SCOPES.every((scope) => grantedScopes.includes(scope));
}

const primaryCalendarSchema = z.object({ id: z.string().min(1) });

// Which account the member just signed in to. A Google account's primary calendar is identified by
// the account's own address, so the calendar list answers this without asking Google for the
// member's profile, which would be one more permission on the consent screen for a label.
export async function readSignedInAccount(
  http: HttpClient,
  accessToken: string,
): Promise<AccountOutcome> {
  let response;
  try {
    response = await http.request({
      method: "GET",
      url: `${CALENDAR_ORIGIN}/calendar/v3/users/me/calendarList/primary?fields=id`,
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch {
    return {
      ok: false,
      problem: integrationProblem("network", 503, "Google could not be reached"),
    };
  }
  if (response.status === 401) {
    return {
      ok: false,
      problem: integrationProblem("auth", 401, "Google refused the access token"),
    };
  }
  if (response.status >= 400) {
    return {
      ok: false,
      problem: integrationProblem(
        response.status >= 500 ? "upstream" : "validation",
        502,
        `Google responded ${response.status}`,
      ),
    };
  }
  let parsed;
  try {
    parsed = primaryCalendarSchema.safeParse(await response.json());
  } catch {
    parsed = undefined;
  }
  if (parsed === undefined || !parsed.success) {
    return {
      ok: false,
      problem: integrationProblem("validation", 502, "Google's account answer could not be read"),
    };
  }
  return { ok: true, address: parsed.data.id };
}

// Asks Google whether it accepts this deployment's application identifier and secret, without
// any member's account: a refresh request with a refresh token that was never issued. Issues no
// token and changes nothing at Google.
export async function checkApplicationCredentials(
  http: HttpClient,
  application: GoogleApplication,
): Promise<ApplicationCredentialCheck> {
  let response;
  try {
    response = await http.request({
      method: "POST",
      url: TOKEN_ENDPOINT,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: application.clientId,
        client_secret: application.clientSecret,
        grant_type: "refresh_token",
        refresh_token: CREDENTIAL_CHECK_REFRESH_TOKEN,
      }).toString(),
    });
  } catch {
    return "unreachable";
  }
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    json = undefined;
  }
  const failure = tokenErrorSchema.safeParse(json);
  return applicationCredentialCheckFrom(
    response.status,
    failure.success ? failure.data.error : undefined,
  );
}
