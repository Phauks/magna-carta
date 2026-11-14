/*
 * The reset-password surface's user-facing messages, and the pure mapping from an auth response to
 * the sentence a visitor sees. Pure so the wording — a security decision on this surface, like the
 * sign-in wording beside it (../sign-in-messages.ts) — is unit-tested rather than only eyeballed.
 *
 * ASKING FOR A LINK NEVER SAYS WHETHER THE ADDRESS HAS AN ACCOUNT. The server answers the request
 * identically either way, so this screen has nothing to branch on — the sent screen says "if that
 * address has an account" and that conditional is the design, not hedging.
 *
 * SPENDING THE TOKEN CAN SAY MORE, because whoever holds a token was sent it: an expired or spent
 * link and a too-short password are different remedies, so they get different sentences. A 5xx or a
 * dead transport is neither — it says nothing about the link or the password.
 */
import { MINIMUM_PASSWORD_LENGTH } from "$lib/auth/password-rule.ts";
import { SIGN_IN_UNAVAILABLE, TOO_MANY_ATTEMPTS } from "../sign-in-messages.ts";

// Re-exported, not redeclared: registration states the same rule, so the number has one home
// ($lib/auth/password-rule.ts) and this surface's existing consumers keep the import they had.
export { MINIMUM_PASSWORD_LENGTH };

/** A token that will not spend: unknown, expired, or already used. One sentence for all three. */
export const RESET_TOKEN_REFUSED =
  "That reset link doesn't work. It may have expired or been used. Request a new one below.";

/** A password the server would not accept. */
export const PASSWORD_REFUSED = `That password could not be used. Choose at least ${MINIMUM_PASSWORD_LENGTH} characters.`;

/**
 * The sentence for a failed reset, from the status and machine code the auth client reported.
 * `status === undefined` means no response at all (offline, or a frontend-only dev server).
 */
export function resetPasswordErrorMessage(
  status: number | undefined,
  code: string | undefined,
): string {
  if (status === undefined || status >= 500) return SIGN_IN_UNAVAILABLE;
  if (status === 429) return TOO_MANY_ATTEMPTS;
  if (code === "PASSWORD_TOO_SHORT" || code === "PASSWORD_TOO_LONG") return PASSWORD_REFUSED;
  return RESET_TOKEN_REFUSED;
}

/** The sentence for a link request that failed outright — never a verdict on the address. */
export function requestResetErrorMessage(status: number | undefined): string {
  if (status === 429) return TOO_MANY_ATTEMPTS;
  return SIGN_IN_UNAVAILABLE;
}
