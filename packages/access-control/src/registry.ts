// Branded permission string. The brand is compile-time only — erased at runtime, so it costs nothing
// on the wire. A Permission IS assignable to string (it flows into database rows and audit logs);
// a raw string is NOT assignable to Permission without going through isPermission/assertPermission.
declare const permissionBrand: unique symbol;
export type Permission = string & { readonly [permissionBrand]: true };

// The platform permission registry: one namespace per subsystem, `<subsystem>:<action>`.
// Grows one block per subsystem slice; the fitness tests cross-check every referenced key against this.
export const PERMISSIONS = [
  "firm:manageMembers", // invite/deactivate members, assign roles
  "firm:provision", // reserved: platform-level firm creation (guarded by secret this slice)
] as const;

// KnownPermission is for hardcoded compile-checked keys (route metadata, role seeds);
// Permission is for runtime-validated strings (the brand requires going through isPermission/assertPermission).
export type KnownPermission = (typeof PERMISSIONS)[number];

const permissionSet: ReadonlySet<string> = new Set(PERMISSIONS);

// Type guard: is `value` a registered permission key? Narrows an untrusted string to the brand.
export function isPermission(value: string): value is Permission {
  return permissionSet.has(value);
}

// Throwing narrower for the common "reject bad input" path. Fails loud with the offending value.
export function assertPermission(value: string): Permission {
  if (!isPermission(value)) throw new TypeError(`Unknown permission: ${JSON.stringify(value)}`);
  return value;
}

// All registered keys under one subsystem namespace, in registry order.
export function permissionsForNamespace(namespace: string): readonly Permission[] {
  const registeredKeys: readonly string[] = PERMISSIONS; // safe widening so the isPermission guard applies
  return registeredKeys.filter((key) => key.startsWith(`${namespace}:`)).filter(isPermission);
}
