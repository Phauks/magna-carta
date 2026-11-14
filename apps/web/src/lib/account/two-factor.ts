/*
 * Two-factor on the member's own account — whether it is on, turning it on, turning it off, and a
 * fresh set of recovery codes — and what a person is told at each step.
 *
 * Pure but for the calls, in the shape the rest of the account surface takes
 * ($lib/account/change-password.ts): the panels make the calls through here, and this module decides
 * what an answer means. The server is Better Auth's two-factor plugin, mounted in
 * apps/api-worker/src/auth.ts, which also mints the recovery codes in their paper-friendly shape.
 *
 * TURNING IT ON IS TWO REQUESTS, AND ONLY THE SECOND ONE TURNS IT ON. `enable` proves the password,
 * stores a fresh secret and hands back the authenticator URI and the recovery codes — but the
 * account still signs in without a code. It is `verifyTotp`, answered with a code the authenticator
 * produced from that secret, that flips the account over. That order is the safety of the whole
 * act: a member whose phone never received the secret (a mis-scan, the wrong app, a closed panel)
 * is never locked out by it, because the account only starts asking once a code has proved the
 * secret arrived.
 *
 * WHICH IS WHY `enable` IS NEVER CALLED ON AN ACCOUNT THAT IS ALREADY ON. In the pinned plugin a
 * second `enable` replaces the secret and marks the new one verified immediately — no code asked
 * for — so the authenticator the member already has would stop working the moment it returned. The
 * Security page offers Add only while two-factor is off, and a fresh set of recovery codes,
 * which has its own endpoint, while it is on.
 */
import { authClient } from "$lib/auth/client.ts";
import { VERIFICATION_CODE_PERIOD_SECONDS } from "$lib/auth/two-factor-policy.ts";

/** Whether the account asks for a second factor at sign-in, or that the answer is not known. */
export type TwoFactorStanding = "on" | "off" | "unknown";

/** A refusal a person can act on. Every step's failure takes this shape. */
export interface Refused {
  readonly kind: "refused";
  readonly message: string;
}

/** What the first step hands back: everything the member needs to set the authenticator up. */
export interface EnrolmentIssued {
  readonly kind: "issued";
  /** The otpauth:// URI the QR code encodes. */
  readonly uri: string;
  /** The same secret as text, for somebody typing it in rather than scanning. */
  readonly secret: string;
  readonly recoveryCodes: readonly string[];
}

export interface RecoveryCodesIssued {
  readonly kind: "issued";
  readonly recoveryCodes: readonly string[];
}

/** Said when the reason is one we have no sentence for, or when none arrived at all. */
export const TWO_FACTOR_REFUSED_UNKNOWN =
  "That didn't go through, and nothing changed. Try again, and if it keeps happening, contact your firm's administrator.";

/**
 * The refusals these acts can honestly produce, in the reader's words.
 *
 * A wrong password is named plainly for the reason the password change gives
 * ($lib/account/change-password.ts): the caller already holds the session, so the distinction is no
 * oracle, and withholding it would leave somebody retyping a code that was never the problem.
 *
 * The code refusal is the sign-in screen's own sentence in substance, because it is the same
 * authenticator and the same remedy — a code that rotated out while it was being typed.
 */
const REFUSALS: Readonly<Record<string, string>> = {
  INVALID_PASSWORD: "That is not your password. Check it and try again.",
  INVALID_CODE: `That code didn't work. Codes change every ${VERIFICATION_CODE_PERIOD_SECONDS} seconds, so enter the one your app shows now.`,
  // The secret the panel issued is gone — replaced from another tab, or turned off from another
  // device in between. Starting again issues a new one, so the sentence says to.
  TOTP_NOT_ENABLED: "This setup has expired. Close this window and start again.",
  TWO_FACTOR_NOT_ENABLED: "Two-Factor is not on for this account any more. Close this window.",
};

/**
 * What to tell a person about a refusal. The CODE is read, never Better Auth's sentence beside it,
 * which is written for a developer and changes between releases.
 */
export function twoFactorRefusal(code: string | undefined): string {
  if (code === undefined) return TWO_FACTOR_REFUSED_UNKNOWN;
  return REFUSALS[code] ?? TWO_FACTOR_REFUSED_UNKNOWN;
}

/**
 * The secret out of an otpauth:// URI, for the member who types it rather than scanning it.
 *
 * Parsed rather than asked for separately because the URI is the one thing the server returns, and
 * a second call for the same secret would be a second place it could disagree. Null when the URI
 * carries none, which the panel treats as "show the code only" rather than inventing text.
 */
export function secretFromAuthenticatorUri(uri: string): string | null {
  const query = uri.indexOf("?");
  if (query === -1) return null;
  const secret = new URLSearchParams(uri.slice(query + 1)).get("secret");
  return secret === null || secret === "" ? null : secret;
}

/**
 * The secret in groups of four, which is how an authenticator app's manual-entry field is read off
 * a screen and typed: a run of fifty letters is where a person loses their place. The apps ignore
 * the spaces, so the grouped form is also the form that can be pasted.
 */
export function groupedSecret(secret: string): string {
  return (secret.match(/.{1,4}/g) ?? []).join(" ");
}

export interface TwoFactorAccount {
  readonly standing: TwoFactorStanding;
  /** The address the account signs in with, which the saved recovery-code file names. */
  readonly address: string | null;
}

/**
 * Whether the signed-in account has two-factor on, and which account it is.
 *
 * Read from the session rather than asked for separately: the plugin puts `twoFactorEnabled` on the
 * user record, and both the turn-on and the turn-off re-issue the session cookie with the new
 * value, so the session's own answer is current the moment either act returns.
 */
export async function readTwoFactorAccount(): Promise<TwoFactorAccount> {
  try {
    const { data, error } = await authClient.getSession();
    if (error || data === null) return { standing: "unknown", address: null };
    return {
      standing: data.user.twoFactorEnabled === true ? "on" : "off",
      address: data.user.email,
    };
  } catch {
    return { standing: "unknown", address: null };
  }
}

/** Step one of turning it on: prove the password and receive the secret and the recovery codes. */
export async function beginEnrolment(password: string): Promise<EnrolmentIssued | Refused> {
  try {
    const { data, error } = await authClient.twoFactor.enable({ password });
    if (error || data === null) {
      return { kind: "refused", message: twoFactorRefusal(error?.code) };
    }
    // The server answers with the one-time-password shape (no authenticator secret, no recovery
    // codes) when it is configured for emailed codes only. Enrolment here is authenticator-app
    // enrolment, so that answer has nothing to show and is refused rather than rendered empty.
    if (data.method !== "totp") return { kind: "refused", message: TWO_FACTOR_REFUSED_UNKNOWN };
    return {
      kind: "issued",
      uri: data.totpURI,
      secret: secretFromAuthenticatorUri(data.totpURI) ?? "",
      recoveryCodes: data.backupCodes,
    };
  } catch {
    return { kind: "refused", message: TWO_FACTOR_REFUSED_UNKNOWN };
  }
}

/** Step two, and the one that turns it on: a code the authenticator made from that secret. */
export async function confirmEnrolment(code: string): Promise<{ kind: "confirmed" } | Refused> {
  try {
    const { error } = await authClient.twoFactor.verifyTotp({ code });
    if (error) return { kind: "refused", message: twoFactorRefusal(error.code) };
    return { kind: "confirmed" };
  } catch {
    return { kind: "refused", message: TWO_FACTOR_REFUSED_UNKNOWN };
  }
}

/** Turns it off. The password is the proof, because the act removes a protection. */
export async function turnOffTwoFactor(password: string): Promise<{ kind: "off" } | Refused> {
  try {
    const { error } = await authClient.twoFactor.disable({ password });
    if (error) return { kind: "refused", message: twoFactorRefusal(error.code) };
    return { kind: "off" };
  } catch {
    return { kind: "refused", message: TWO_FACTOR_REFUSED_UNKNOWN };
  }
}

/**
 * A fresh set of recovery codes. Every earlier code stops working in the same act — the server
 * replaces the stored set rather than adding to it — which is what makes this the remedy for a
 * printed sheet that has gone missing, and not only for one that has run out.
 */
export async function replaceRecoveryCodes(
  password: string,
): Promise<RecoveryCodesIssued | Refused> {
  try {
    const { data, error } = await authClient.twoFactor.generateBackupCodes({ password });
    if (error || data === null) {
      return { kind: "refused", message: twoFactorRefusal(error?.code) };
    }
    return { kind: "issued", recoveryCodes: data.backupCodes };
  } catch {
    return { kind: "refused", message: TWO_FACTOR_REFUSED_UNKNOWN };
  }
}

/**
 * The recovery codes as a file a person can keep: one per line, with a heading saying what they are
 * and for which account, because a text file found in a downloads folder a year later has to
 * explain itself to somebody who has forgotten making it.
 */
export function recoveryCodesDocument(
  accountAddress: string | null,
  codes: readonly string[],
): string {
  const heading =
    accountAddress === null
      ? "Magna Carta recovery codes"
      : `Magna Carta recovery codes for ${accountAddress}`;
  return [
    heading,
    "",
    "Each code signs you in once when you cannot reach your authenticator app.",
    "Keep them somewhere safe and apart from your phone.",
    "",
    ...codes,
    "",
  ].join("\n");
}
