/*
 * Sub-roles, as the two settings screens that show roles need them.
 *
 * A sub-role (Partner, Associate) names a parent role (Attorney). A member who holds a sub-role also
 * holds its parent, because the parent's own assignment is what carries the parent's permissions to
 * them; and a member holds at most one sub-role of a parent. The server refuses a role set that
 * breaks either rule, so these helpers keep a choice inside the rules as it is made, rather than
 * letting somebody tick boxes into a refusal.
 */

/** The parts of a role these helpers read. */
export interface FamilyRole {
  readonly id: string;
  readonly name: string;
  readonly parentRoleId: string | null;
}

/** A role in display order, and whether it sits under a parent. */
export interface OrderedRole<Role extends FamilyRole> {
  readonly role: Role;
  readonly parent: Role | null;
}

/**
 * The roles as a reader expects to see them: top-level roles by name, each followed directly by its
 * sub-roles by name. A sub-role whose parent is missing from the list is shown as top-level, so a
 * partial read never hides a role.
 */
export function orderRolesByFamily<Role extends FamilyRole>(
  roles: readonly Role[],
): OrderedRole<Role>[] {
  const byId = new Map(roles.map((role) => [role.id, role]));
  const byName = (left: Role, right: Role) => left.name.localeCompare(right.name);
  const isTopLevel = (role: Role) => role.parentRoleId === null || !byId.has(role.parentRoleId);
  const ordered: OrderedRole<Role>[] = [];
  for (const role of roles.filter(isTopLevel).toSorted(byName)) {
    ordered.push({ role, parent: null });
    for (const child of roles.filter((other) => other.parentRoleId === role.id).toSorted(byName)) {
      ordered.push({ role: child, parent: role });
    }
  }
  return ordered;
}

/**
 * The chosen role set after one role is ticked or unticked. Ticking a sub-role ticks its parent and
 * unticks the parent's other sub-roles; unticking a parent unticks its sub-roles.
 */
export function toggleRoleInFamily(
  chosen: readonly string[],
  roleId: string,
  held: boolean,
  roles: readonly FamilyRole[],
): string[] {
  const byId = new Map(roles.map((role) => [role.id, role]));
  const role = byId.get(roleId);
  if (!held) {
    return chosen.filter(
      (candidate) => candidate !== roleId && byId.get(candidate)?.parentRoleId !== roleId,
    );
  }
  const parentId = role?.parentRoleId ?? null;
  const kept = chosen.filter(
    (candidate) =>
      candidate !== roleId && (parentId === null || byId.get(candidate)?.parentRoleId !== parentId),
  );
  if (parentId !== null && !kept.includes(parentId)) kept.push(parentId);
  return [...kept, roleId];
}
