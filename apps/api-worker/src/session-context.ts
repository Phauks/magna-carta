import type { Context } from "hono";
import { effectivePermissions } from "@magna-carta/access-control/resolver";
import type { Permission } from "@magna-carta/access-control/registry";
import { selectMemberPermissionsStatements } from "@magna-carta/data-access/member-statements";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { assertIdentifier } from "@magna-carta/identifiers/validate";
import type {
  FirmId,
  PlatformStaffId,
  SupportGrantId,
  UserId,
} from "@magna-carta/identifiers/types";
import type { SupportGrantTier } from "@magna-carta/data-access/support-access-statements";
import type { createAuth } from "./auth.ts";

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

// The session read, re-sent through transient faults. Only a THROW is retried: a null answer is
// Better Auth's verdict that there is no valid session, and re-asking would not change it. The read
// is a GET with no side effects, so repeating it is safe.
async function getSessionWithRetry(
  auth: ReturnType<typeof createAuth>,
  headers: Headers,
): Promise<Awaited<ReturnType<ReturnType<typeof createAuth>["api"]["getSession"]>>> {
  let attempt = 0;
  for (;;) {
    try {
      return await auth.api.getSession({ headers });
    } catch (error) {
      const delay = SESSION_READ_RETRY_DELAYS_MILLISECONDS[attempt];
      if (delay === undefined) throw error;
      attempt += 1;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

// The first link of the chokepoint chain (chokepoint order step 1):
// session cookie → Better Auth control-plane lookup → { userId, firmId }. The firm comes from the
// session, never the URL. This slice it is a plain function handlers call — the full
// ordered middleware (RBAC per route metadata, rate limits) is slice 0·5. Null means no valid
// session; the caller answers with the RFC 9457 401 problem.
export async function resolveSession(
  auth: ReturnType<typeof createAuth>,
  c: Context,
): Promise<SessionContext | null> {
  const session = await getSessionWithRetry(auth, c.req.raw.headers);
  if (session === null) return null;
  // The handles are asserted, not cast: a session row carrying a malformed id is corruption and
  // must fail loud, never flow onward as a branded identifier. An ABSENT firm is not corruption —
  // it is the account-before-a-firm state — so it passes through as null and the chokepoint decides
  // what the route makes of it. Absent and empty are the same fact; a firm handle is never "".
  const rawFirmId: unknown = session.user.firmId;
  const firmless = rawFirmId === null || rawFirmId === undefined || rawFirmId === "";
  return {
    userId: assertIdentifier(session.user.id, "user"),
    firmId: firmless ? null : assertIdentifier(rawFirmId, "firm"),
  };
}

// The session member's effective permissions, read from THEIR firm's database (the firm came from
// the session) and folded through the access-control resolver. Two parallel reads, not
// batched — revisit at the 0·5 chokepoint.
export async function loadEffectivePermissions(
  firmDatabase: SqlDatabase,
  userId: UserId,
): Promise<ReadonlySet<Permission>> {
  const statements = selectMemberPermissionsStatements(firmDatabase, userId);
  const [rolePermissions, directGrants] = await Promise.all([
    statements.rolePermissions.all<{ permission: string }>(),
    statements.directGrants.all<{ permission: string; expires_at: string | null }>(),
  ]);
  return effectivePermissions(
    rolePermissions.results,
    directGrants.results,
    new Date().toISOString(),
  );
}
