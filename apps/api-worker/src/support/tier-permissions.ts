import { type Permission, permissionsForNamespace } from "@magna-carta/access-control/registry";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import type { SupportGrantTier } from "@magna-carta/data-access/support-access-statements";
import type { UserId } from "@magna-carta/identifiers/types";
import { loadEffectivePermissions } from "../effective-permissions.ts";

// The whole diagnostics namespace — the fixed allow-list a diagnostic support session carries. It holds
// no view*/decrypt key, so the audited-decrypt gates never open from a diagnostic session.
export const DIAGNOSTIC_PERMISSIONS: ReadonlySet<Permission> = new Set(
  permissionsForNamespace("diagnostics"),
);

// Tier → permission set. Diagnostic is the fixed allow-list; privileged is EXACTLY the requester's own
// effective permissions (resolved against their firm) — no firm-level escalation, the user sharing
// their own view. Authority is keyed to the requester's id; the staff principal is recorded in audit.
export function resolveSupportPermissions(
  tier: SupportGrantTier,
  firmDatabase: SqlDatabase,
  requesterUserId: UserId,
): Promise<ReadonlySet<Permission>> | ReadonlySet<Permission> {
  return tier === "diagnostic"
    ? DIAGNOSTIC_PERMISSIONS
    : loadEffectivePermissions(firmDatabase, requesterUserId);
}
