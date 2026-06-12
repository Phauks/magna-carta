import type { Context } from "hono";
import { effectivePermissions } from "@magna-carta/access-control/resolver";
import type { Permission } from "@magna-carta/access-control/registry";
import { selectMemberPermissionsStatements } from "@magna-carta/data-access/member-statements";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { assertIdentifier } from "@magna-carta/identifiers/validate";
import type { FirmId, UserId } from "@magna-carta/identifiers/types";
import type { createAuth } from "./auth.ts";

export interface SessionContext {
  readonly userId: UserId;
  readonly firmId: FirmId;
}

// The first link of the ADR-0067 chokepoint chain (API contract spec, chokepoint order step 1):
// session cookie → Better Auth control-plane lookup → { userId, firmId }. The firm comes from the
// session, never the URL (ADR-0052). This slice it is a plain function handlers call — the full
// ordered middleware (RBAC per route metadata, rate limits) is slice 0·5. Null means no valid
// session; the caller answers with the RFC 9457 401 problem.
export async function resolveSession(
  auth: ReturnType<typeof createAuth>,
  c: Context,
): Promise<SessionContext | null> {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (session === null) return null;
  // The handles are asserted, not cast: a session row carrying a malformed id is corruption and
  // must fail loud, never flow onward as a branded identifier.
  return {
    userId: assertIdentifier(session.user.id, "user"),
    firmId: assertIdentifier(session.user.firmId, "firm"),
  };
}

// The session member's effective permissions, read from THEIR firm's database (the firm came from
// the session — ADR-0052) and folded through the access-control resolver. Two parallel reads, not
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
