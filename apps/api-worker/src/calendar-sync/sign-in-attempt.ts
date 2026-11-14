import { mintSignedToken, verifySignedToken } from "../signed-token.ts";

// One sign-in a member has started and not yet finished, carried in a cookie on their own browser
// between leaving for the provider and coming back.
//
// It holds the two things the return trip has to prove. The STATE is the value the provider hands
// back unchanged: a return whose state is not the one in this browser's cookie was not started
// here, which is what stops somebody else's authorization code being planted on a member's session.
// The VERIFIER is the secret half of the proof key; the provider releases tokens only to whoever
// presents it, so a code lifted from the address bar is worthless without this cookie.
//
// The cookie is signed and not encrypted. It is HttpOnly, so no script reads it, and the only party
// who could read it is the member whose sign-in it is.

export const SIGN_IN_ATTEMPT_COOKIE = "__Host-calendar-sign-in";

// Long enough to pick an account, type a password and answer a second factor; short enough that an
// abandoned attempt is not a standing way in.
export const SIGN_IN_ATTEMPT_LIFETIME_SECONDS = 600;

const TOKEN_TYPE = "calendar-sign-in";

export interface SignInAttempt {
  readonly state: string;
  readonly codeVerifier: string;
  // The member and firm that started it. A return under a different session is refused: the cookie
  // belongs to a browser, and the browser may have changed hands.
  readonly userId: string;
  readonly firmId: string;
  // The provider it was started at. A return to another provider's address is refused: the code
  // it carries was issued by somebody else.
  readonly provider: string;
}

export function mintSignInAttempt(
  secret: string,
  attempt: SignInAttempt,
  now: Date,
): Promise<string> {
  return mintSignedToken(secret, TOKEN_TYPE, {
    ...attempt,
    expiresAt: now.getTime() + SIGN_IN_ATTEMPT_LIFETIME_SECONDS * 1000,
  });
}

// The attempt a cookie carries, or null. Every failure is the same null: a forged cookie, an
// expired one and a missing one all mean "this browser has no sign-in in progress".
export async function readSignInAttempt(
  secret: string,
  token: string | undefined,
  now: Date,
): Promise<SignInAttempt | null> {
  if (token === undefined || token === "") return null;
  const payload = await verifySignedToken(secret, token, TOKEN_TYPE);
  if (payload === null) return null;
  const { state, codeVerifier, userId, firmId, provider, expiresAt } = payload;
  if (
    typeof state !== "string" ||
    typeof codeVerifier !== "string" ||
    typeof userId !== "string" ||
    typeof firmId !== "string" ||
    typeof provider !== "string" ||
    typeof expiresAt !== "number" ||
    expiresAt <= now.getTime()
  ) {
    return null;
  }
  return { state, codeVerifier, userId, firmId, provider };
}
