/*
 * The failed-attempt ladder, and the words it says at each rung.
 *
 * ONE ladder, ONE limit, shared by every credential entry on the sign-in surface — the password,
 * the two-factor code, and the recovery code. That is the fact no single screen can show: each
 * screen only ever displays its own remaining count, so if the ladders were separate a visitor
 * could be three failures from a lockout without any screen having said so.
 *
 * The wording NARROWS as the count drops (a neutral statement, then a warning, then a last-attempt
 * sentence) because a constant message trains people to ignore it, and someone about to be locked
 * out of their firm's practice-management system should be told plainly.
 *
 * What this module deliberately does NOT do is decide whether the credential itself was right. It
 * counts attempts and nothing else — see ../../routes/login/sign-in-messages.ts for why every
 * rejection reads the same, and for the messages themselves.
 *
 * THE SERVER DOES NOT PUBLISH A REMAINING COUNT TODAY. Better Auth answers a rate-limited request
 * with a bare 429 and no budget, so nothing can currently supply `remaining` from a real response.
 * The ladder is modelled here, rendered on the developer screen-state page, and left unwired on the
 * live route rather than fed an invented number: a count the server does not agree with is worse
 * than no count. It becomes real when the auth surface returns an attempt budget.
 */

/** How many failures the shared ladder allows before the account is temporarily locked. */
export const ATTEMPT_LIMIT = 5;

/** How urgently the remaining-attempts line should read. */
export type AttemptTone = "neutral" | "warning" | "final";

export interface AttemptWarning {
  tone: AttemptTone;
  message: string;
}

/**
 * The remaining-attempts line for a rung of the ladder, or null when there is nothing to say —
 * either no attempt has failed yet, or the budget is spent and the lockout notice speaks instead.
 *
 * `subject` names what gets locked, in the visitor's terms: an account, or this one sign-in.
 */
export function attemptWarning(remaining: number, subject: string): AttemptWarning | null {
  if (remaining >= ATTEMPT_LIMIT || remaining <= 0) return null;
  if (remaining === 1) {
    return { tone: "final", message: `Last attempt. One more failure locks ${subject}.` };
  }
  if (remaining === 2) {
    return {
      tone: "warning",
      message: `Only 2 attempts left before ${subject} is temporarily locked.`,
    };
  }
  return {
    tone: "neutral",
    message: `${remaining} attempts remain before ${subject} is temporarily locked.`,
  };
}

const SECONDS_PER_MINUTE = 60;

/**
 * A lockout countdown as minutes and seconds. Spelled digitally (4:58) rather than in words,
 * because it is read repeatedly against a clock while it ticks down.
 */
export function lockoutCountdown(secondsRemaining: number): string {
  const clamped = Math.max(0, Math.floor(secondsRemaining));
  const minutes = Math.floor(clamped / SECONDS_PER_MINUTE);
  const seconds = clamped % SECONDS_PER_MINUTE;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** What the lockout notice says, with the remedy that does not require waiting. */
export function lockoutMessage(secondsRemaining: number): string {
  if (secondsRemaining <= 0) return "You can try again now.";
  return `Too many attempts. You can try again in ${lockoutCountdown(secondsRemaining)}.`;
}

/**
 * The second sentence of the lockout notice. It sits in the SAME element as the countdown: a
 * remedy in a separate paragraph reads as unrelated advice, and the person reading a lockout is
 * looking for the way out, not for a tip.
 */
export const LOCKOUT_REMEDY = "Your firm's administrator can unlock your account sooner.";
