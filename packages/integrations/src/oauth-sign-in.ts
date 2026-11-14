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
