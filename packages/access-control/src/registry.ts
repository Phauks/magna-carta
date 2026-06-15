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
  "firm:reportIncident", // file a diagnostic incident (slice 0·6) — seeded to every default role
  // Matters — the matter shell, its lifecycle, and the per-firm type/numbering configuration.
  "matters:create", // open a consultation or a numbered matter
  "matters:open", // draw a number on a prospective matter (prospective -> open)
  "matters:close", // archive a matter (closed-but-additive)
  "matters:reopen", // return a closed matter to open
  "matters:edit", // edit matter fields (title/description/type/location/attorney/client)
  "matters:renumber", // assign a manual/court/legacy number
  "matters:manageTypes", // create/deactivate matter types
  "matters:manageNumbering", // edit the firm numbering scheme
  // Locations — the firm's offices/letterhead roots.
  "locations:manage", // create/update/close locations, addresses, staff assignment
  // Files — the File Manager's upload, organization, and document-type configuration.
  "files:upload", // initiate uploads and commit versions
  "files:organize", // create/rename/move folders and files
  "files:delete", // soft-delete files
  "files:manageDocumentTypes", // create/deactivate document types
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
