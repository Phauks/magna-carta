// The shared credential attempt budget, and the middleware that publishes it.
//
// THE PROBLEM THIS SOLVES. The sign-in surface renders a remaining-attempts line and a lockout
// countdown, and it had no source for either: the auth surface answered a throttled request with a
// bare 429 carrying no budget, so a count shown beside it would have been a number the server did
// not agree with. This module is that source.
//
// ONE LADDER ACROSS EVERY CREDENTIAL. The password, the two-factor code and the recovery code spend
// the SAME budget, because they are three ways of asking the same question and an attacker who gets
// a fresh five tries by switching to the recovery-code field has not been limited at all. That also
// makes the visitor-facing promise honest: the count on any one screen is the count that is left
// overall, which is the fact no single screen could otherwise state.
//
// WHERE IT SITS. The credential endpoints are Better Auth's, mounted at its own base path and
// deliberately outside the /api/v1 chokepoint (they are the authentication surface, not a route
// that has been authenticated). So the budget is enforced by a middleware over that base path
// rather than by the chokepoint's rate-limit bucket, which is per-route and per-firm and knows
// nothing about a signed-out visitor. The chokepoint's own 429 gained the same budget fields, so a
// client reads one shape wherever it is throttled.
//
// WHAT IS AND IS NOT KEYED. The budget is keyed on the client address the edge set, never on the
// email in the body. Keying on the address being tried would make the budget itself an oracle — a
// probe could learn which addresses have a ladder in progress — and would let anyone lock a
// colleague out by failing five sign-ins against their address. The cost of the address key is that
// an office behind one egress shares a ladder, which is why the limit is a per-minute-ish window
// and not a long lockout.
import type { Context, MiddlewareHandler } from "hono";

// How many credential failures the shared ladder allows before the lockout. Fifteen rather than a
// tighter number because of what the ladder actually costs the honest visitor: it is keyed on the
// client address, spans the password, the two-factor code and the recovery code together, and the
// lockout REPLACES the credential answer — so a person who mistypes a few times, then tries a
// recovery code, then types the right password is told the same thing either way and cannot tell
// they were ever locked out rather than wrong. An office behind one egress shares the ladder, which
// spends it faster still. Fifteen keeps the ceiling low enough to be worthless to a guesser at one
// address (the window ages failures out at 900 seconds, so it is not fifteen per day) while leaving
// room for the ordinary bad afternoon.
export const ATTEMPT_LIMIT = 15;

/** How long the lockout lasts once the budget is spent. */
export const LOCKOUT_SECONDS = 300;

// The window a failure ages out of on its own, for a visitor who is simply mistyping rather than
// guessing. Without it, five failures spread over a working day would lock someone out.
const ATTEMPT_WINDOW_SECONDS = 900;

// The headers the budget rides on. Headers rather than a rewritten body: the failure responses on
// this path are Better Auth's own, and rewriting them would couple this middleware to that
// library's error shape — a shape that would then have to be re-verified on every upgrade. A header
// is additive, survives any body, and is what the browser client reads (apps/web/src/lib/auth).
export const ATTEMPT_LIMIT_HEADER = "x-mc-attempt-limit";
export const ATTEMPTS_REMAINING_HEADER = "x-mc-attempts-remaining";
export const LOCKOUT_SECONDS_HEADER = "x-mc-lockout-seconds";

/** What the ladder currently says about one client. */
export interface AttemptBudget {
  readonly limit: number;
  readonly remaining: number;
  /** Seconds until the lockout lifts, or null while the budget still has room. */
  readonly lockoutSecondsRemaining: number | null;
}

export interface AttemptLadder {
  /** What the ladder says right now, spending nothing. */
  read(key: string): AttemptBudget;
  /** Record one failure and return the budget after it. */
  spend(key: string): AttemptBudget;
  /** A credential that worked clears the ladder — the visitor is who they said they were. */
  clear(key: string): void;
}

interface LadderEntry {
  failures: number[];
  lockedUntilMilliseconds: number | null;
}

export interface AttemptLadderOptions {
  now?: () => number;
}

// Per-isolate, like the chokepoint's rate limiter and with the same honest limitation: the state is
// not shared across isolates, so a determined attacker distributed across many connections gets
// more than five tries in total. That is acceptable for what this is — a brute-force backstop and
// an honest number for the screen — and it moves behind the same interface when a Durable Object
// limiter lands. What it must never do is UNDER-report: a fresh isolate says "five remaining",
// which is true of that isolate, rather than inventing a smaller number.
export function createAttemptLadder(options: AttemptLadderOptions = {}): AttemptLadder {
  const now = options.now ?? Date.now;
  const entryByKey = new Map<string, LadderEntry>();

  function budgetFor(entry: LadderEntry, nowMilliseconds: number): AttemptBudget {
    if (entry.lockedUntilMilliseconds !== null && entry.lockedUntilMilliseconds > nowMilliseconds) {
      return {
        limit: ATTEMPT_LIMIT,
        remaining: 0,
        lockoutSecondsRemaining: Math.ceil(
          (entry.lockedUntilMilliseconds - nowMilliseconds) / 1000,
        ),
      };
    }
    return {
      limit: ATTEMPT_LIMIT,
      remaining: Math.max(0, ATTEMPT_LIMIT - entry.failures.length),
      lockoutSecondsRemaining: null,
    };
  }

  // Read-and-prune in one step: a lapsed lockout and aged-out failures are dropped whenever the key
  // is touched, so an entry never outlives the window that made it.
  function entryFor(key: string, nowMilliseconds: number): LadderEntry {
    const entry = entryByKey.get(key) ?? { failures: [], lockedUntilMilliseconds: null };
    if (
      entry.lockedUntilMilliseconds !== null &&
      entry.lockedUntilMilliseconds <= nowMilliseconds
    ) {
      entry.lockedUntilMilliseconds = null;
      entry.failures = [];
    }
    const windowStart = nowMilliseconds - ATTEMPT_WINDOW_SECONDS * 1000;
    entry.failures = entry.failures.filter((at) => at > windowStart);
    return entry;
  }

  return {
    read(key) {
      const nowMilliseconds = now();
      const entry = entryFor(key, nowMilliseconds);
      if (entry.failures.length === 0 && entry.lockedUntilMilliseconds === null) {
        entryByKey.delete(key);
      } else {
        entryByKey.set(key, entry);
      }
      return budgetFor(entry, nowMilliseconds);
    },
    spend(key) {
      const nowMilliseconds = now();
      const entry = entryFor(key, nowMilliseconds);
      if (entry.lockedUntilMilliseconds === null) {
        entry.failures.push(nowMilliseconds);
        if (entry.failures.length >= ATTEMPT_LIMIT) {
          entry.lockedUntilMilliseconds = nowMilliseconds + LOCKOUT_SECONDS * 1000;
        }
      }
      entryByKey.set(key, entry);
      return budgetFor(entry, nowMilliseconds);
    },
    clear(key) {
      entryByKey.delete(key);
    },
  };
}

// The client address the Cloudflare edge sets, which a client cannot spoof past it. Off-edge (tests,
// local dev) every caller collapses into one shared bucket — the fail-closed degradation, matching
// the chokepoint's own key derivation, never a per-request bucket a client could rotate.
export function attemptLadderKey(c: Context): string {
  const address = c.req.header("cf-connecting-ip");
  return `ip:${address !== undefined && address !== "" ? address : "unknown"}`;
}

// The credential-presenting endpoints on the auth surface, matched on the path suffix Better Auth
// serves them at. Everything else under the base path — session reads, sign-out, requesting a reset
// link, the two-factor enrolment calls a signed-in member makes — is NOT a credential attempt and
// must not spend the budget: charging a session read would lock out a tab left open on the app.
//
// `/change-password` PRESENTS a credential and is deliberately absent, which is worth saying so the
// omission is not read as an oversight. The ladder is keyed on the client address, so a member
// mistyping their standing password a dozen times would lock their whole office out of SIGNING IN —
// and it would buy nothing, because reaching that endpoint at all requires the session an attacker
// would have to hold already. The guessing this budget exists to stop happens at the front door.
const CREDENTIAL_ATTEMPT_SUFFIXES: readonly string[] = [
  "/sign-in/email",
  "/two-factor/verify-totp",
  "/two-factor/verify-backup-code",
  "/two-factor/verify-otp",
  "/reset-password",
];

export function isCredentialAttemptPath(path: string): boolean {
  return CREDENTIAL_ATTEMPT_SUFFIXES.some((suffix) => path.endsWith(suffix));
}

/** Stamp the budget onto a response, so every answer on this path carries the same three facts. */
export function stampAttemptBudget(headers: Headers, budget: AttemptBudget): void {
  headers.set(ATTEMPT_LIMIT_HEADER, String(budget.limit));
  headers.set(ATTEMPTS_REMAINING_HEADER, String(budget.remaining));
  if (budget.lockoutSecondsRemaining !== null) {
    headers.set(LOCKOUT_SECONDS_HEADER, String(budget.lockoutSecondsRemaining));
    headers.set("retry-after", String(budget.lockoutSecondsRemaining));
  }
}

/**
 * The middleware over the auth surface. On a credential endpoint it refuses outright while the
 * lockout stands, otherwise runs the request and spends one attempt on a failure — and stamps the
 * budget on the way out either way.
 *
 * The success test is the response status and nothing else. Better Auth answers a wrong password
 * with a 401 and a second-factor challenge with a 200, so a challenge correctly costs nothing: the
 * password was right, and the code that follows is the next rung of the same ladder rather than a
 * failure of this one.
 */
export function attemptBudgetMiddleware(ladder: AttemptLadder): MiddlewareHandler {
  return async (c, next) => {
    if (!isCredentialAttemptPath(c.req.path)) {
      await next();
      return;
    }
    const key = attemptLadderKey(c);
    const standing = ladder.read(key);
    if (standing.lockoutSecondsRemaining !== null) {
      // The lockout REPLACES the credential answer: once the budget is spent, whether this
      // particular attempt was right stopped mattering, and answering it would hand back one free
      // oracle bit per locked-out request.
      const response = Response.json(
        {
          error: "TOO_MANY_ATTEMPTS",
          message: "Too many attempts. Try again once the lockout has passed.",
          attemptsRemaining: 0,
          lockoutSecondsRemaining: standing.lockoutSecondsRemaining,
        },
        { status: 429 },
      );
      stampAttemptBudget(response.headers, standing);
      c.res = response;
      return;
    }

    await next();

    const succeeded = c.res.status < 400;
    const budget = succeeded ? (ladder.clear(key), ladder.read(key)) : ladder.spend(key);
    // c.res is replaced rather than mutated: a Response's headers are immutable once it has been
    // constructed by a downstream handler, and Hono's own guard against that is to hand back a
    // frozen object. Cloning with the same body and an extended header set is the supported way to
    // add a header to somebody else's response.
    const headers = new Headers(c.res.headers);
    stampAttemptBudget(headers, budget);
    c.res = new Response(c.res.body, {
      status: c.res.status,
      statusText: c.res.statusText,
      headers,
    });
  };
}
