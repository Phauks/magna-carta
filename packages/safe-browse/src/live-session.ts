/*
 * How a live browsing session decides which browser to use, kept apart from the machinery that
 * acquires one.
 *
 * The decision is small and the consequences of getting it wrong are not: reconnecting to a session
 * the remote service has already reaped fails the member's navigation for no reason, and launching a
 * fresh browser when a perfectly good one is held throws away the cookies that are the whole point
 * of holding it. Both mistakes are invisible in a system test — one looks like a flake, the other
 * looks like a site that simply asked for consent twice — so the branching lives here as a function
 * over plain values, where a test can state each case outright.
 */

/** What the session object has recorded about the member's browser, if anything. */
export interface LiveSessionRecord {
  readonly sessionId: string;
  /** Where the browser was left. Absent before the first navigation completes. */
  readonly location?: string;
  readonly openedAt: number;
}

export type LiveSessionPlan =
  /** Nothing is held: acquire a browser and record it. */
  | { readonly kind: "launch"; readonly reason: "none-recorded" | "stale" | "expired" }
  /** A browser is held and should be reused, cookies and all. */
  | { readonly kind: "connect"; readonly sessionId: string };

/*
 * A session is not allowed to live forever even while it is being used. The remote service bills
 * for a held browser by the time it is held, and a member who leaves a tab open over lunch is not
 * reading a page — they are paying for one. This ceiling is deliberately far below the service's
 * own ten-minute keep-alive, which governs idleness rather than total life.
 */
export const LIVE_SESSION_MAXIMUM_AGE_MILLISECONDS = 15 * 60 * 1000;

/**
 * What to do about the member's browser before this navigation.
 *
 * `previousConnectFailed` is the caller reporting that a connect it attempted on this same request
 * did not work. That is NOT an error condition: the service reaps idle sessions on its own
 * schedule, so a recorded id can go stale through nobody's fault, and the right answer is a fresh
 * browser rather than a failed navigation. The member loses the cookies, which is worth telling
 * them; they do not lose the page.
 */
export function planLiveSession(
  record: LiveSessionRecord | null,
  now: number,
  previousConnectFailed = false,
): LiveSessionPlan {
  if (record === null) return { kind: "launch", reason: "none-recorded" };
  if (previousConnectFailed) return { kind: "launch", reason: "stale" };
  if (now - record.openedAt >= LIVE_SESSION_MAXIMUM_AGE_MILLISECONDS) {
    return { kind: "launch", reason: "expired" };
  }
  return { kind: "connect", sessionId: record.sessionId };
}

/**
 * Whether this navigation continues the member's session or starts it over. The screen says so:
 * a member who is walking a consent flow needs to know when the cookies behind them were dropped,
 * because the next page's behaviour changes and nothing else on the screen would explain it.
 */
export function sessionContinued(plan: LiveSessionPlan): boolean {
  return plan.kind === "connect";
}
