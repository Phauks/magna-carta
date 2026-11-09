import type { Permission } from "@magna-carta/access-control/registry";
import { effectivePermissions } from "@magna-carta/access-control/resolver";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { selectMemberPermissionsStatements } from "@magna-carta/data-access/member-statements";
import type { UserId } from "@magna-carta/identifiers/types";

// A member's effective permissions, read from their firm's database. At the source root because both
// sides ask the question: the chokepoint and the routes on the HTTP side, and the assembly consumer
// and the support tiers off it — none of which should reach the session resolver to get an answer
// that has nothing to do with a request.
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
