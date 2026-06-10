import { isPermission, type KnownPermission, type Permission } from "../src/registry.ts";

declare const permission: Permission;
declare const untrusted: string;
declare const known: KnownPermission;

// @ts-expect-error - KnownPermission (compile-checked literal) is intentionally NOT assignable to
// Permission (runtime-validated brand) — crossing over requires isPermission/assertPermission
export const knownAsBranded: Permission = known;

// @ts-expect-error - a raw string must not be assignable to Permission without validation
export const rawString: Permission = "firm:manageMembers";

// @ts-expect-error - an arbitrary runtime string must not be assignable to Permission either
export const rawVariable: Permission = untrusted;

// POSITIVE control: the guard narrows a raw string to the brand.
export const narrowed: Permission | undefined = isPermission(untrusted) ? untrusted : undefined;

// POSITIVE control: a Permission flows into a plain string (so keys can be stored and logged).
export const asString: string = permission;
