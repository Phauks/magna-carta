import { isPermission, type Permission } from "./registry.ts";

// Raw rows as the data-access layer hands them over — plain strings, validated here.
export interface RolePermissionRow {
  readonly permission: string;
}

export interface DirectGrantRow {
  readonly permission: string;
  readonly expires_at: string | null; // ISO-8601 UTC instant, or null = no expiry
}

// effective = (permissions of held roles) UNION (unexpired direct grants) — ADR-0068.
// Unknown keys are filtered out, not thrown: a registry that shrank must not brick login.
// Expiry compares ISO-8601 UTC instants lexicographically (equal-format strings sort by time);
// a grant expiring exactly at `now` is already expired.
export function effectivePermissions(
  rolePermissions: readonly RolePermissionRow[],
  directGrants: readonly DirectGrantRow[],
  now: string,
): ReadonlySet<Permission> {
  const effective = new Set<Permission>();
  for (const row of rolePermissions) {
    if (isPermission(row.permission)) effective.add(row.permission);
  }
  for (const grant of directGrants) {
    if (grant.expires_at !== null && grant.expires_at <= now) continue;
    if (isPermission(grant.permission)) effective.add(grant.permission);
  }
  return effective;
}
