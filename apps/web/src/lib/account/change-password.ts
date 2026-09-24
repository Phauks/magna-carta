/*
 * Changing the password you already have — what the act needs, what refuses it, and what a person
 * is told when it does.
 *
 * Pure, in the shape the rest of the account surface takes ($lib/account/active-sessions.ts): the
 * dialog makes the call, and this module decides what the answer means. The whole value here is the
 * refusal wording — Better Auth answers with a machine code and an English sentence of its own, and
 * neither is something to put in front of a person. A wrong current password and a short new one
 * are different mistakes with different remedies, and each has to say which.
 *
 * WHY THIS IS A CHANGE AND NOT A RESET. The reset flow proves control of the mailbox and is the door
 * for somebody who cannot get in. This one proves knowledge of the standing password and is the door
 * for somebody who is already in — no mail, no waiting, no token to be intercepted. Better Auth
 * gates it on `sensitiveSessionMiddleware`, which re-reads the session store rather than trusting
 * the five-minute cookie cache, so a session revoked elsewhere cannot spend this.
 *
 * SIGNING OUT EVERYWHERE ELSE RIDES ALONG, and it is the reason this screen matters on the worst
 * day. A member who believes somebody else has their account needs two things to happen together:
 * the credential replaced, and every session holding the old one ended. Asked separately they race —
 * an intruder signed in during the gap simply changes it back. The server does both inside the one
 * request, ending every session for the account and minting a fresh one for the device that asked,
 * so the person stays signed in here and nowhere else.
 */
import { authClient } from "$lib/auth/client.ts";

/** What a change asks for. The current password is the proof; nothing else stands in for it. */
export interface PasswordChange {
  readonly currentPassword: string;
  readonly newPassword: string;
  /** Whether every other signed-in device is ended in the same act. */
  readonly signOutOtherDevices: boolean;
}

export type PasswordChangeOutcome =
  | { readonly kind: "changed" }
  /** The server said no, for a reason a person can act on. */
  | { readonly kind: "refused"; readonly message: string };

/** The refusal shown when the reason is one we have no sentence for, or none arrived at all. */
export const CHANGE_REFUSED_UNKNOWN =
  "Your password was not changed. Try again, and if it keeps happening, contact your firm's administrator.";

/** Said on success, naming what else the act did. */
export function passwordChangedMessage(signedOutOtherDevices: boolean): string {
  return signedOutOtherDevices
    ? "Your password is changed, and your other devices are signed out."
    : "Your password is changed.";
}

/*
 * The refusals this act can honestly produce, in the reader's words.
 *
 * WRONG-CURRENT-PASSWORD IS NAMED PLAINLY, which is the opposite of the sign-in screen's posture and
 * is right here for a reason that does not transfer: sign-in must not say whether the address or the
 * password was wrong, because a signed-out visitor is not known to be the account holder and every
 * distinction is an oracle. Here the caller already holds the session. Telling them the current
 * password was wrong reveals nothing they could not already establish, and withholding it would
 * leave somebody retyping a new password that was never the problem.
 */
const REFUSALS: Readonly<Record<string, string>> = {
  INVALID_PASSWORD: "That is not your current password. Check it and try again.",
  PASSWORD_TOO_SHORT: "That new password is too short.",
  PASSWORD_TOO_LONG: "That new password is too long.",
  // The account has no password to change — an account made by invitation or by an operator, which
  // is activated by the emailed link rather than by a password anybody chose. The remedy is that
  // link, not this dialog, so the sentence names it.
  CREDENTIAL_ACCOUNT_NOT_FOUND:
    "This account has no password yet. Set one from the sign-in screen's Forgot Password link, and this will change it afterwards.",
};

/**
 * What to tell a person about a refusal.
 *
 * The CODE is what is read, never the message beside it: Better Auth's own sentences are written for
 * a developer reading a log and change without notice between releases, so echoing one would put an
 * unreviewed string from a dependency in front of a member. An unrecognised code falls back to the
 * one sentence that is true of every refusal — nothing changed, and trying again is safe.
 */
export function passwordChangeRefusal(code: string | undefined): string {
  if (code === undefined) return CHANGE_REFUSED_UNKNOWN;
  return REFUSALS[code] ?? CHANGE_REFUSED_UNKNOWN;
}

/**
 * Performs the change.
 *
 * A transport failure reads as a refusal rather than as an outcome of its own, because the two are
 * the same thing to the person in front of it: nothing is known to have happened, and pressing again
 * is safe — the act is idempotent in the only sense that matters, since a second change from the
 * same current password either lands or is refused as already changed.
 */
export async function changePassword(change: PasswordChange): Promise<PasswordChangeOutcome> {
  try {
    const { error } = await authClient.changePassword({
      currentPassword: change.currentPassword,
      newPassword: change.newPassword,
      revokeOtherSessions: change.signOutOtherDevices,
    });
    if (error) return { kind: "refused", message: passwordChangeRefusal(error.code) };
    return { kind: "changed" };
  } catch {
    return { kind: "refused", message: CHANGE_REFUSED_UNKNOWN };
  }
}
