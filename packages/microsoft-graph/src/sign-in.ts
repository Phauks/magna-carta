import { z } from "zod";
import type { OAuthCredential } from "@magna-carta/integrations/credentials";
import type { HttpClient } from "@magna-carta/integrations/http";
import { integrationProblem, type IntegrationProblem } from "@magna-carta/integrations/problem";

// Signing a member in to their own Microsoft 365 account: the authorization-code flow with a proof
// key. Pure: the caller supplies the random bytes, the clock and the transport, so nothing here
// reads a binding and every branch is testable without a network.

// `common` accepts a work or school account from any tenant and a personal account; a firm that
// wants its own tenant only passes that tenant's identifier instead.
export const MICROSOFT_DEFAULT_TENANT = "common";

// What the calendar grant asks for, and all it asks for. `offline_access` is what makes Microsoft
// return a refresh token at all; without it the connection would die with the first access token.
export const MICROSOFT_CALENDAR_SCOPES = [
  "Calendars.ReadWrite",
  "User.Read",
  "offline_access",
] as const;

export interface MicrosoftApplication {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
  readonly tenant?: string;
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

// The proof key's secret half. 32 random bytes encode to 43 characters, the shortest verifier the
// proof-key standard allows; fewer bytes would be refused by the provider rather than merely weaker.
export const CODE_VERIFIER_BYTE_LENGTH = 32;

export function codeVerifierFrom(randomBytes: Uint8Array): string {
  if (randomBytes.length < CODE_VERIFIER_BYTE_LENGTH) {
    throw new RangeError(
      `a code verifier needs at least ${CODE_VERIFIER_BYTE_LENGTH} random bytes`,
    );
  }
  return base64Url(randomBytes);
}

export async function codeChallengeFor(codeVerifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(codeVerifier));
  return base64Url(new Uint8Array(digest));
}

function endpoint(application: MicrosoftApplication, leaf: "authorize" | "token"): string {
  const tenant = encodeURIComponent(application.tenant ?? MICROSOFT_DEFAULT_TENANT);
  return `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/${leaf}`;
}

export interface AuthorizationRequest {
  readonly application: MicrosoftApplication;
  readonly scopes: readonly string[];
  // Opaque to Microsoft and returned unchanged. The caller binds it to the member's session so a
  // callback nobody started is refused.
  readonly state: string;
  readonly codeChallenge: string;
}

// The address the member's browser is sent to. `select_account` because a lawyer commonly holds
// more than one Microsoft account in one browser, and silently connecting whichever is signed in
// would put a firm's events in the wrong calendar.
export function authorizationUrl(request: AuthorizationRequest): string {
  const url = new URL(endpoint(request.application, "authorize"));
  url.search = new URLSearchParams({
    client_id: request.application.clientId,
    response_type: "code",
    redirect_uri: request.application.redirectUri,
    response_mode: "query",
    scope: request.scopes.join(" "),
    state: request.state,
    code_challenge: request.codeChallenge,
    code_challenge_method: "S256",
    prompt: "select_account",
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

// The token endpoint's answers that mean "the member has to sign in again" rather than "try later":
// the grant was withdrawn or expired, or Microsoft wants the member in front of a screen.
const SIGN_IN_AGAIN_ERRORS: ReadonlySet<string> = new Set([
  "invalid_grant",
  "interaction_required",
  "consent_required",
  "login_required",
]);

export type TokenOutcome =
  | {
      readonly ok: true;
      readonly credential: OAuthCredential & {
        readonly accessToken: string;
        readonly expiresAt: string;
      };
      // What Microsoft says was actually granted, which can be less than what was asked.
      readonly grantedScopes: readonly string[];
    }
  | { readonly ok: false; readonly problem: IntegrationProblem };

export interface TokenRequestDependencies {
  readonly http: HttpClient;
  readonly now: () => Date;
}

async function requestToken(
  dependencies: TokenRequestDependencies,
  application: MicrosoftApplication,
  grant: Readonly<Record<string, string>>,
  // A refresh that returns no new refresh token leaves the old one standing.
  standingRefreshToken: string | undefined,
): Promise<TokenOutcome> {
  let response;
  try {
    response = await dependencies.http.request({
      method: "POST",
      url: endpoint(application, "token"),
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
      problem: integrationProblem("network", 503, "Microsoft could not be reached"),
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
        problem: integrationProblem("auth", 401, "Microsoft asks the member to sign in again"),
      };
    }
    if (response.status === 429) {
      return {
        ok: false,
        problem: integrationProblem("rate_limit", 429, "Microsoft is limiting requests"),
      };
    }
    if (response.status >= 500) {
      return {
        ok: false,
        problem: integrationProblem("upstream", 502, `Microsoft responded ${response.status}`),
      };
    }
    // What is left is a request Microsoft will refuse every time: a wrong secret, a redirect address
    // that is not registered, a scope the application may not ask for. Retrying cannot help.
    return {
      ok: false,
      problem: integrationProblem("validation", 400, "Microsoft refused the sign-in request"),
    };
  }

  const parsed = tokenResponseSchema.safeParse(json);
  const refreshToken = parsed.success
    ? (parsed.data.refresh_token ?? standingRefreshToken)
    : undefined;
  if (!parsed.success || refreshToken === undefined) {
    return {
      ok: false,
      problem: integrationProblem(
        "validation",
        502,
        "Microsoft's sign-in answer could not be read",
      ),
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

// Trades the code Microsoft handed the member's browser for the account's tokens. The verifier is
// the secret half of the challenge the authorization address carried.
export function redeemAuthorizationCode(
  dependencies: TokenRequestDependencies,
  application: MicrosoftApplication,
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

// Microsoft may hand back a new refresh token with any refresh and may then stop honouring the old
// one, so the caller stores the returned credential before using it and never runs two refreshes
// for one account at once.
export function refreshAccessToken(
  dependencies: TokenRequestDependencies,
  application: MicrosoftApplication,
  refreshToken: string,
): Promise<TokenOutcome> {
  return requestToken(
    dependencies,
    application,
    { grant_type: "refresh_token", refresh_token: refreshToken },
    refreshToken,
  );
}
