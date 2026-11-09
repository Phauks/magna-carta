import type { Context } from "hono";
import { assertIdentifier } from "@magna-carta/identifiers/validate";
import type {
  FirmId,
  PlatformStaffId,
  SupportGrantId,
  UserId,
} from "@magna-carta/identifiers/types";
import type { SupportGrantTier } from "@magna-carta/data-access/support-access-statements";
import type { createAuth } from "../auth.ts";

// A support principal riding the session: a named staff (later: agent) identity acting under a firm's
// time-boxed grant. Present only on support-session requests; absent for ordinary firm-member sessions.
export interface SupportPrincipal {
  readonly grantId: SupportGrantId;
  readonly principalId: PlatformStaffId;
  readonly tier: SupportGrantTier;
}

export interface SessionContext {
  readonly userId: UserId;
  // NULL while this person belongs to no firm — the state the joining surface creates between
  // making an account and resolving what it is. Every route rejects such a session with the
  // reserved 404 unless it declares firmlessSession; see chokepoint/chokepoint.ts.
  readonly firmId: FirmId | null;
  readonly support?: SupportPrincipal;
}

// Waits before re-asking Better Auth for the session after it THREW (never after it answered).
// Two retries, then the failure is real and surfaces with its Error ID. Observed in production
// (2026-08-31): a screen's burst of parallel reads occasionally has ONE request fail with Better
// Auth's "Failed to get session" APIError while its siblings resolve the same cookie in the same
// second — a transient fault in the lookup, not a verdict about the session — and without the
// retry that one request answers 500 and fails the whole screen behind it.
const SESSION_READ_RETRY_DELAYS_MILLISECONDS: readonly number[] = [50, 150];

// One session read: the (possibly cookie-cached) answer plus the response headers Better Auth
// built. The headers matter — when the cookie cache is stale the library re-signs it and the
// refreshed Set-Cookie only reaches the browser if this Worker forwards it, so a caller that
// discarded the headers would have a cache that dies five minutes after sign-in and never renews.
// `fresh` bypasses the cookie cache for an authoritative read against the session store.
function readSessionOnce(auth: ReturnType<typeof createAuth>, headers: Headers, fresh: boolean) {
  return fresh
    ? auth.api.getSession({ headers, returnHeaders: true, query: { disableCookieCache: true } })
    : auth.api.getSession({ headers, returnHeaders: true });
}

// The session read, re-sent through transient faults. Only a THROW is retried: a null answer is
// Better Auth's verdict that there is no valid session, and re-asking would not change it. The read
// is a GET with no side effects, so repeating it is safe.
async function getSessionWithRetry(
  auth: ReturnType<typeof createAuth>,
  headers: Headers,
  fresh: boolean,
): Promise<Awaited<ReturnType<typeof readSessionOnce>>> {
  let attempt = 0;
  for (;;) {
    try {
      return await readSessionOnce(auth, headers, fresh);
    } catch (error) {
      const delay = SESSION_READ_RETRY_DELAYS_MILLISECONDS[attempt];
      if (delay === undefined) throw error;
      attempt += 1;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

// Forward the cookies a session read set — the renewed session_data cache above all — onto the
// response this Worker will build. Set-Cookie only: nothing else Better Auth writes belongs on an
// API reply. Appended (never overwritten), so a request whose resolution read twice keeps both.
function forwardSessionCookies(c: Context, headers: Headers): void {
  for (const cookie of headers.getSetCookie()) {
    c.header("set-cookie", cookie, { append: true });
  }
}

// The first link of the chokepoint chain (chokepoint order step 1):
// session cookie → Better Auth lookup (a signed five-minute cookie cache, then the control
// plane) → { userId, firmId }. The firm comes from the session, never the URL. Null means no valid
// session; the caller answers with the RFC 9457 401 problem.
export async function resolveSession(
  auth: ReturnType<typeof createAuth>,
  c: Context,
): Promise<SessionContext | null> {
  let read = await getSessionWithRetry(auth, c.req.raw.headers, false);
  forwardSessionCookies(c, read.headers);
  // A FIRMLESS answer is re-read against the store before it is believed. Attaching a person's
  // firm (founding one — routes/session/onboarding.ts, firm-provisioner.ts) is a direct control-plane
  // write the library never observes, so a cached cookie can keep saying "no firm" for minutes
  // after the firm exists — which would wall the founder out of the app they just created.
  // Firmless sessions are rare and short-lived, so they simply never ride the cache; sessions
  // WITH a firm (every steady-state request) do.
  if (read.response !== null && isFirmlessValue(read.response.user.firmId)) {
    read = await getSessionWithRetry(auth, c.req.raw.headers, true);
    forwardSessionCookies(c, read.headers);
  }
  const session = read.response;
  if (session === null) return null;
  // The handles are asserted, not cast: a session row carrying a malformed id is corruption and
  // must fail loud, never flow onward as a branded identifier. An ABSENT firm is not corruption —
  // it is the account-before-a-firm state — so it passes through as null and the chokepoint decides
  // what the route makes of it. Absent and empty are the same fact; a firm handle is never "".
  const rawFirmId: unknown = session.user.firmId;
  return {
    userId: assertIdentifier(session.user.id, "user"),
    firmId: isFirmlessValue(rawFirmId) ? null : assertIdentifier(rawFirmId, "firm"),
  };
}

// Absent and empty are the same fact; a firm handle is never "".
function isFirmlessValue(rawFirmId: unknown): boolean {
  return rawFirmId === null || rawFirmId === undefined || rawFirmId === "";
}
