/*
 * The joining surface's user-facing messages, and the pure mapping from an answer to the sentence a
 * visitor sees. Pure so the wording — which on this surface is a security decision, not a copy
 * decision — is unit-tested rather than only eyeballed in the page.
 *
 * THE REFUSAL IS OURS, NOT THE SERVER'S. The redemption route already answers every unsuccessful
 * combination with one identical problem document, because the invitation row holds a single digest
 * over the code, the surname and the date of birth and so has no way to tell them apart. This module
 * takes that one step further and renders a CONSTANT sentence for the refusal rather than echoing
 * whatever `detail` arrived: the screen then says one thing whatever the server says, so a future
 * change on the other side of the wire cannot turn a neutral answer into a per-field one by editing
 * a string. The correlation id is still surfaced, because that identifies the request, not the fact.
 *
 * A refusal is not the same thing as an outage: a transport failure or a 5xx says nothing about what
 * was typed, so it gets its own sentence and never implies a mistake. A 429 is likewise not a
 * verdict — showing the refusal there would tell somebody a correct code was wrong.
 */
import type { JoiningOutcome, JoiningProblem } from "$lib/auth/joining-api.ts";

/**
 * Every unsuccessful redemption, whatever went wrong: an unknown code, a surname that does not
 * match, a date of birth that does not match, an invitation already used, revoked, expired, or
 * locked. One sentence, because the platform is structurally incapable of telling them apart — and
 * because a form that could say "the code is right but the date of birth is not" is a machine for
 * confirming that a named person was invited to a named firm.
 */
export const REDEMPTION_REFUSED =
  "Those details don't match an invitation. Check the code, last name and date of birth against " +
  "the invitation, or ask the firm that invited you to send a new one.";

/** A confirmation token that will not spend: unknown, already used, or expired. */
export const CONFIRMATION_REFUSED =
  "That confirmation code will not confirm. Register again to have a new one sent, or sign in if " +
  "the workspace already exists.";

/** A registration the server would not accept. Only a malformed form reaches this. */
export const REGISTRATION_REFUSED =
  "Those details could not be accepted. Check the email address and try again.";

/** Server-side rate limiting — not a verdict on what was entered. */
export const TOO_MANY_ATTEMPTS = "Too many attempts. Wait a minute, then try again.";

/** The service could not be reached, or failed. Says nothing about what was typed. */
export const JOINING_UNAVAILABLE =
  "That could not be completed just now. Try again, and if it keeps happening, ask the firm that " +
  "invited you or contact support.";

/**
 * The sentence for a failed step. `refusal` is the step's own constant refusal, used only for the
 * statuses that really are a verdict on what the visitor entered.
 */
export function joiningErrorMessage(outcome: JoiningOutcome<unknown>, refusal: string): string {
  if (outcome.kind !== "problem") return JOINING_UNAVAILABLE;
  if (outcome.problem.status === 429) return TOO_MANY_ATTEMPTS;
  if (outcome.problem.status >= 500) return JOINING_UNAVAILABLE;
  return refusal;
}

/**
 * The lockout countdown a refusal carried, in seconds, or null when it carried none. Kept separate
 * from the sentence because a lockout REPLACES a refusal on screen rather than stacking under it.
 */
export function lockoutFrom(problem: JoiningProblem): number | null {
  return problem.retryAfterSeconds ?? null;
}
