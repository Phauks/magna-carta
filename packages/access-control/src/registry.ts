// Branded permission string. The brand is compile-time only — erased at runtime, so it costs nothing
// on the wire. A Permission IS assignable to string (it flows into database rows and audit logs);
// a raw string is NOT assignable to Permission without going through isPermission/assertPermission.
declare const PermissionBrand: unique symbol;
export type Permission = string & { readonly [PermissionBrand]: true };

// The platform permission registry (ADR-0068): one namespace per subsystem, `<subsystem>:<action>`.
// Grows one block per subsystem slice; the fitness tests cross-check every referenced key against this.
export const PERMISSIONS = [
  "firm:manageMembers", // invite/deactivate members, assign roles
  "firm:provision", // reserved: platform-level firm creation (guarded by secret this slice)
] as const;

export type KnownPermission = (typeof PERMISSIONS)[number];

const permissionSet: ReadonlySet<string> = new Set(PERMISSIONS);

// Type guard: is `value` a registered permission key? Narrows an untrusted string to the brand.
export function isPermission(value: string): value is Permission {
  return permissionSet.has(value);
}

// Throwing narrower for the common "reject bad input" path. Fails loud with the offending value.
export function assertPermission(value: string): Permission {
  if (!isPermission(value)) throw new Error(`Unknown permission: ${value}`);
  return value;
}

// All registered keys under one subsystem namespace, in registry order.
export function permissionsForNamespace(namespace: string): readonly Permission[] {
  return PERMISSIONS.filter((key) => key.startsWith(`${namespace}:`)) as unknown as Permission[];
}
