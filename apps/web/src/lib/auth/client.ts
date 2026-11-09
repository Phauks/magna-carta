/*
 * The Better Auth browser client — the ONE home for every call the SPA makes into the auth surface.
 *
 * The Worker mounts Better Auth at its default base path (`/api/auth`, see apps/api-worker/src/auth.ts)
 * and serves this SPA from the same origin, so the client's defaults already point at it: no
 * baseURL, no basePath, and the session cookie rides along as a same-origin credential. That is
 * also why the auth surface is NOT reached through @magna-carta/api-client — the Better Auth routes
 * are not part of the OpenAPI contract that client is generated from.
 *
 * The twoFactor plugin is wired because the server enables it: with it, a sign-in whose account has
 * two-factor enabled resolves to `{ twoFactorRedirect: true }` instead of a session, and the client
 * gains the `twoFactor.verifyTotp` call that completes the challenge. It is deliberately configured
 * with NEITHER `twoFactorPage` nor `onTwoFactorRedirect`: both of those navigate away, and the
 * sign-in surface must stay on one URL — a second URL would tell an observer (or a shoulder) which
 * factor the visitor is being asked for, and which one failed.
 */
import { createAuthClient } from "better-auth/svelte";
import { twoFactorClient } from "better-auth/client/plugins";

/*
 * THE ATTEMPT BUDGET, as the server publishes it. The ladder in ./attempt-ladder.ts describes the
 * rungs; this is where the numbers behind them come from. The Worker stamps three headers on every
 * answer from a credential endpoint (apps/api-worker/src/http/auth-attempt-budget.ts), and headers rather
 * than a body field because the failure bodies on that path are Better Auth's own — a client that
 * parsed them would break on the library's next error-shape change.
 *
 * `null` means the server said nothing, which happens against an older Worker or a frontend-only
 * dev server with no Worker at all. Callers must render nothing in that case rather than assume a
 * full budget: an invented count is exactly what the ladder was left unwired to avoid.
 */
export interface PublishedAttemptBudget {
  limit: number;
  remaining: number;
  lockoutSecondsRemaining: number | null;
}

const ATTEMPT_LIMIT_HEADER = "x-mc-attempt-limit";
const ATTEMPTS_REMAINING_HEADER = "x-mc-attempts-remaining";
const LOCKOUT_SECONDS_HEADER = "x-mc-lockout-seconds";

let lastPublishedBudget: PublishedAttemptBudget | null = null;

/** The budget from the most recent auth call, or null if the server published none. */
export function attemptBudget(): PublishedAttemptBudget | null {
  return lastPublishedBudget;
}

function readWholeNumber(headers: Headers, name: string): number | null {
  const raw = headers.get(name);
  if (raw === null) return null;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

export const authClient = createAuthClient({
  plugins: [twoFactorClient()],
  fetchOptions: {
    // Captured on the RESPONSE hook rather than per call site: every credential step — the
    // password, the code, the recovery code — spends the same budget, so reading it in one place
    // is what keeps the three screens from each maintaining their own idea of the count.
    onResponse(context) {
      const limit = readWholeNumber(context.response.headers, ATTEMPT_LIMIT_HEADER);
      const remaining = readWholeNumber(context.response.headers, ATTEMPTS_REMAINING_HEADER);
      if (limit === null || remaining === null) {
        lastPublishedBudget = null;
        return;
      }
      lastPublishedBudget = {
        limit,
        remaining,
        lockoutSecondsRemaining: readWholeNumber(context.response.headers, LOCKOUT_SECONDS_HEADER),
      };
    },
  },
});
