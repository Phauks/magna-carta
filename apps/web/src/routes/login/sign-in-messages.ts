/*
 * The sign-in surface's user-facing messages, and the pure mapping from an auth response status to
 * the one a visitor sees. Pure so the wording — which is a security decision, not a copy decision —
 * is unit-tested rather than only eyeballed in the page.
 *
 * The rejection copy is DELIBERATELY UNSPECIFIC. "No such email", "wrong password", "that account
 * exists but is not verified" are three different sentences, and telling them apart turns the
 * sign-in form into an account-enumeration oracle: anyone could confirm which addresses belong to
 * the firm. One sentence covers every credential rejection, and the code step gets its own sentence
 * only because the visitor has ALREADY proven the password by the time they see it.
 *
 * A rejection is not the same thing as an outage: a transport failure or a 5xx says nothing about
 * the credentials, so it gets its own message and never implies the visitor typed something wrong.
 * A 429 is likewise not a rejection — the code endpoints are rate-limited server-side, and showing
 * the code-rejected sentence there would tell the visitor a valid code was wrong.
 *
 * The rotation interval is interpolated from the policy constants rather than typed into the
 * sentence, so the copy cannot outlive the configuration it describes.
 */
import { VERIFICATION_CODE_PERIOD_SECONDS } from "../../lib/auth/two-factor-policy.ts";

/** Every credential rejection, whatever the underlying reason. */
export const CREDENTIALS_REJECTED =
  "That email and password combination doesn't match our records. Check both and try again.";

/** A rejected authenticator code. */
export const VERIFICATION_CODE_REJECTED = `That code didn't verify. Codes rotate every ${VERIFICATION_CODE_PERIOD_SECONDS} seconds — enter the current one.`;

/** Server-side rate limiting — not a verdict on what was entered. */
export const TOO_MANY_ATTEMPTS = "Too many attempts. Wait a minute, then try again.";

/** The service could not be reached, or failed. Says nothing about the credentials. */
export const SIGN_IN_UNAVAILABLE =
  "Sign-in could not be completed. Try again, and if it keeps happening, contact your firm's administrator.";

/**
 * The message for a failed step, given the HTTP status the auth call reported. `undefined` means
 * the request never got a response (offline, or no Worker behind a frontend-only dev server).
 * `rejection` is the step's own rejection sentence, used only for the statuses that really are a
 * verdict on what the visitor entered.
 */
export function signInErrorMessage(status: number | undefined, rejection: string): string {
  if (status === undefined) return SIGN_IN_UNAVAILABLE;
  if (status === 429) return TOO_MANY_ATTEMPTS;
  if (status >= 500) return SIGN_IN_UNAVAILABLE;
  return rejection;
}
