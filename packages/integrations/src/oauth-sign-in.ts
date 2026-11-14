import type { OAuthCredential } from "./credentials.ts";
import type { HttpClient } from "./http.ts";
import type { IntegrationProblem } from "./problem.ts";

// What signing a member in to their own account at any provider has in common: the proof key of
// the authorization-code flow, and the shape of what a token request or an account read answers.
// Each provider's package builds its own addresses and reads its own answers into these shapes, so
// a caller that signs a member in holds one shape whichever provider it was.

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

export type TokenOutcome =
  | {
      readonly ok: true;
      readonly credential: OAuthCredential & {
        readonly accessToken: string;
        readonly expiresAt: string;
      };
      // What the provider says was actually granted, which can be less than what was asked.
      readonly grantedScopes: readonly string[];
    }
  | { readonly ok: false; readonly problem: IntegrationProblem };

export interface TokenRequestDependencies {
  readonly http: HttpClient;
  readonly now: () => Date;
}

// Which account the member signed in to, as the provider names it.
export type AccountOutcome =
  | { readonly ok: true; readonly address: string }
  | { readonly ok: false; readonly problem: IntegrationProblem };

// Whether a provider accepts this deployment's own identifier and secret, asked without any
// member's account: "accepted" (the provider knows the application and its secret), "refused" (it
// does not), "unreachable" (no usable answer in time).
export type ApplicationCredentialCheck = "accepted" | "refused" | "unreachable";

const CLIENT_REFUSED_ERRORS: ReadonlySet<string> = new Set([
  "invalid_client",
  "unauthorized_client",
]);

// Reads a token endpoint's answer to a refresh request carrying a refresh token that was never
// issued. A provider checks who is asking before it looks at the grant, so "invalid_grant" means
// the application was recognised and only the made-up token was turned down, and "invalid_client"
// means the identifier or the secret is wrong. Only the error code is read, never its description.
export function applicationCredentialCheckFrom(
  status: number,
  errorCode: string | undefined,
): ApplicationCredentialCheck {
  if (errorCode !== undefined && CLIENT_REFUSED_ERRORS.has(errorCode)) return "refused";
  if (errorCode === "invalid_grant") return "accepted";
  if (status === 401) return "refused";
  return "unreachable";
}

// The refresh token the check sends. It names what it is, so a provider's own log of the request
// reads as a check and not as an attack.
export const CREDENTIAL_CHECK_REFRESH_TOKEN = "magna-carta-credential-check";
