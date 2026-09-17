import type { MemberRoleId, RoleId, UserId } from "@magna-carta/identifiers/types";
import type { SqlDatabase, SqlStatement } from "./idempotency-statements.ts";

// Table names tracked against @magna-carta/database's per-firm schema by the schema-name-sync
// fitness test. These tables exist only in the per-firm database — the caller supplies that handle.
export const MEMBER_TABLE = "member";
export const MEMBER_ROLE_TABLE = "member_role";
export const ROLE_PERMISSION_TABLE = "role_permission";
export const DIRECT_GRANT_TABLE = "direct_grant";

// Mirrors a control-plane user into the firm's member table. The outbox consumer driving this is
// at-least-once: ON CONFLICT DO NOTHING makes a redelivery a no-op — and never overwrites a
// display_name edited after the first delivery.
export interface MemberMirrorInput {
  readonly userId: UserId;
  readonly displayName: string;
  readonly now: string; // ISO-8601 instant
}

export function insertMemberStatement(
  database: SqlDatabase,
  input: MemberMirrorInput,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${MEMBER_TABLE} (user_id, display_name, status, created_at) VALUES (?1, ?2, 'active', ?3) ON CONFLICT DO NOTHING`,
    )
    .bind(input.userId, input.displayName, input.now);
}

// Role assignment. A replay arrives with a freshly minted mrl_ handle, so the PK alone would never
// dedupe it — ON CONFLICT DO NOTHING leans on member_role's UNIQUE(member_user_id, role_id), which
// a real-SQLite test pins.
export interface RoleAssignmentInput {
  readonly id: MemberRoleId;
  readonly memberUserId: UserId;
  readonly roleId: RoleId;
}

export function insertRoleAssignmentStatement(
  database: SqlDatabase,
  input: RoleAssignmentInput,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${MEMBER_ROLE_TABLE} (id, member_user_id, role_id) VALUES (?1, ?2, ?3) ON CONFLICT DO NOTHING`,
    )
    .bind(input.id, input.memberUserId, input.roleId);
}

// The two authorization reads the /v1/me handler (and the future permission chokepoint) feed to
// @magna-carta/access-control's effectivePermissions resolver. Rows pass through structurally:
// { permission } and { permission, expires_at }. Expiry is deliberately NOT filtered in SQL — the
// resolver owns the boundary rule (a grant expiring exactly at `now` is already expired).
// Duplicates are possible on the role-permissions join when held roles share a permission; the
// resolver's Set dedupes — DISTINCT deliberately omitted.
//
// BOTH reads gate on member.status = 'active': the read path treats a deactivated member as
// having no permissions at all — held roles and unexpired direct grants alike confer nothing.
// A never-mirrored user (no member row yet — the outbox sweep-lag window) likewise reads empty,
// which it already did before the gate: there is nothing to join to.
export interface MemberPermissionsStatements {
  readonly rolePermissions: SqlStatement; // rows: { permission }
  readonly directGrants: SqlStatement; // rows: { permission, expires_at }
}

export function selectMemberPermissionsStatements(
  database: SqlDatabase,
  userId: UserId,
): MemberPermissionsStatements {
  return {
    rolePermissions: database
      .prepare(
        `SELECT ${ROLE_PERMISSION_TABLE}.permission FROM ${ROLE_PERMISSION_TABLE} JOIN ${MEMBER_ROLE_TABLE} ON ${MEMBER_ROLE_TABLE}.role_id = ${ROLE_PERMISSION_TABLE}.role_id JOIN ${MEMBER_TABLE} ON ${MEMBER_TABLE}.user_id = ${MEMBER_ROLE_TABLE}.member_user_id AND ${MEMBER_TABLE}.status = 'active' WHERE ${MEMBER_ROLE_TABLE}.member_user_id = ?1`,
      )
      .bind(userId),
    directGrants: database
      .prepare(
        `SELECT ${DIRECT_GRANT_TABLE}.permission, ${DIRECT_GRANT_TABLE}.expires_at FROM ${DIRECT_GRANT_TABLE} JOIN ${MEMBER_TABLE} ON ${MEMBER_TABLE}.user_id = ${DIRECT_GRANT_TABLE}.member_user_id AND ${MEMBER_TABLE}.status = 'active' WHERE ${DIRECT_GRANT_TABLE}.member_user_id = ?1`,
      )
      .bind(userId),
  };
}

// The firm's whole member roster, in one statement — the read every screen that has to put a NAME to
// a colleague makes. Ordered by display name so the answer is a roster rather than an arbitrary set,
// with the user id as the tiebreak so two members sharing a name still order deterministically.
//
// Deactivated members are RETURNED, not filtered. A departed timekeeper is still the responsible
// attorney on last year's matters and still the author of the time entries under them; dropping the
// row would make those cells read as an unfilled gap, which is a different and untrue statement. The
// caller gets `status` and decides — a picker offers the active, a listing names whoever it finds.
//
// Roles arrive as ONE column rather than one row per role, so a member with three roles is still one
// row and the caller never has to fold. The separator is the ASCII unit separator (U+001F) rather
// than a comma: a role name is firm-authored text and a comma inside one would otherwise split a
// single role into two. An empty group_concat is NULL, which is a member holding no role at all.
export const ROLE_TABLE = "role";
export const MEMBER_PROFESSIONAL_PROFILE_TABLE = "member_professional_profile";

/** The separator `roleNames` packs a member's role names with. */
export const ROLE_NAME_SEPARATOR = "\u001F";

/** One row of the roster read, exactly as the statement returns it. */
export interface FirmMemberRow {
  readonly userId: string;
  readonly displayName: string;
  readonly status: string;
  /** The member's role names packed with ROLE_NAME_SEPARATOR, or null where they hold no role. */
  readonly roleNames: string | null;
  /** 1 when a professional profile has been written for this member, 0 otherwise. */
  readonly hasProfessionalProfile: number;
}

export function selectFirmMembersStatement(database: SqlDatabase): SqlStatement {
  return database.prepare(
    `SELECT ${MEMBER_TABLE}.user_id AS userId, ` +
      `${MEMBER_TABLE}.display_name AS displayName, ` +
      `${MEMBER_TABLE}.status AS status, ` +
      `(SELECT group_concat(${ROLE_TABLE}.name, char(31)) FROM ${MEMBER_ROLE_TABLE} ` +
      `JOIN ${ROLE_TABLE} ON ${ROLE_TABLE}.id = ${MEMBER_ROLE_TABLE}.role_id ` +
      `WHERE ${MEMBER_ROLE_TABLE}.member_user_id = ${MEMBER_TABLE}.user_id) AS roleNames, ` +
      `EXISTS (SELECT 1 FROM ${MEMBER_PROFESSIONAL_PROFILE_TABLE} ` +
      `WHERE ${MEMBER_PROFESSIONAL_PROFILE_TABLE}.member_user_id = ${MEMBER_TABLE}.user_id) AS hasProfessionalProfile ` +
      `FROM ${MEMBER_TABLE} ORDER BY ${MEMBER_TABLE}.display_name, ${MEMBER_TABLE}.user_id`,
  );
}

// The firm-usage read: how many members can sign in today. Deactivated members keep their row for
// the record; they are not seats, so they do not count here.
/**
 * A member's display name, or null where the firm has no such member. Read by the editing host on
 * every CheckFileInfo: the editor labels a member's changes and cursor with this name, and without
 * it shows them as an unknown user with an identifier appended.
 */
export async function readMemberDisplayName(
  database: SqlDatabase,
  userId: UserId,
): Promise<string | null> {
  const row = await database
    .prepare(`SELECT display_name AS displayName FROM ${MEMBER_TABLE} WHERE user_id = ?1`)
    .bind(userId)
    .first<{ displayName: string }>();
  return row?.displayName ?? null;
}

export async function readActiveMemberCount(database: SqlDatabase): Promise<number> {
  const { results } = await database
    .prepare(`SELECT COUNT(*) AS c FROM ${MEMBER_TABLE} WHERE status = 'active'`)
    .all<{ c: number }>();
  return results[0]?.c ?? 0;
}

// The member row's status by user id — the read /v1/me uses to split a DEACTIVATED member (404,
// absent semantics) from a never-mirrored one (no row → 200 with empty permissions; the
// sweep-lag window is transient and self-heals). Rows: { status }, zero rows means never mirrored.
export function selectMemberStatusStatement(database: SqlDatabase, userId: UserId): SqlStatement {
  return database.prepare(`SELECT status FROM ${MEMBER_TABLE} WHERE user_id = ?1`).bind(userId);
}

// THE FIRM'S ROLES, each with what it carries and how many people hold it — the read behind the
// surface a person consults before granting one. Permissions arrive packed into one column on the
// roster read's reasoning: one row per role keeps the caller from folding, and the ASCII unit
// separator cannot appear inside a registry key (they are `namespace:action`), so unpacking is
// total. A role carrying no permission at all packs to NULL, which is a real state — a role the
// firm has emptied — and reads as no permissions, never as a permission called "".
//
// The member count is of ACTIVE members only. The question the number answers is "who would this
// change reach", and a departed member is not reached by anything.

/** One row of the roles read, exactly as the statement returns it. */
export interface FirmRoleRow {
  readonly id: string;
  readonly name: string;
  /** The role's permission keys packed with ROLE_NAME_SEPARATOR, or null where it carries none. */
  readonly permissions: string | null;
  /** How many ACTIVE members hold this role. */
  readonly memberCount: number;
}

export function selectFirmRolesStatement(database: SqlDatabase): SqlStatement {
  return database.prepare(
    `SELECT ${ROLE_TABLE}.id AS id, ` +
      `${ROLE_TABLE}.name AS name, ` +
      `(SELECT group_concat(${ROLE_PERMISSION_TABLE}.permission, char(31)) FROM ${ROLE_PERMISSION_TABLE} ` +
      `WHERE ${ROLE_PERMISSION_TABLE}.role_id = ${ROLE_TABLE}.id) AS permissions, ` +
      `(SELECT COUNT(*) FROM ${MEMBER_ROLE_TABLE} ` +
      `JOIN ${MEMBER_TABLE} ON ${MEMBER_TABLE}.user_id = ${MEMBER_ROLE_TABLE}.member_user_id ` +
      `WHERE ${MEMBER_ROLE_TABLE}.role_id = ${ROLE_TABLE}.id AND ${MEMBER_TABLE}.status = 'active') AS memberCount ` +
      `FROM ${ROLE_TABLE} ORDER BY ${ROLE_TABLE}.name`,
  );
}

// The roles one member holds, as handles — what a role change diffs against. Rows: { roleId }.
export function selectMemberRoleIdsStatement(database: SqlDatabase, userId: UserId): SqlStatement {
  return database
    .prepare(`SELECT role_id AS roleId FROM ${MEMBER_ROLE_TABLE} WHERE member_user_id = ?1`)
    .bind(userId);
}

// Takes one role off a member. The insert side is insertRoleAssignmentStatement above; a role change
// is expressed as the removals and the additions its diff names, never as a delete-all-then-insert,
// so a role the member keeps is never momentarily absent from a concurrent authorization read.
// fitness:unguarded-write — matches a set rather than one row, so zero is an empty set rather than a refusal
export function deleteRoleAssignmentStatement(
  database: SqlDatabase,
  memberUserId: UserId,
  roleId: RoleId,
): SqlStatement {
  return database
    .prepare(`DELETE FROM ${MEMBER_ROLE_TABLE} WHERE member_user_id = ?1 AND role_id = ?2`)
    .bind(memberUserId, roleId);
}

// Deactivating and reactivating a member. The row STAYS either way — a departed member is still the
// responsible attorney on the matters they carried and the author of what they filed — so this is a
// status flip and never a delete. Deactivation needs no further write to stop their access: both
// authorization reads above join `member.status = 'active'`, so a deactivated member resolves to an
// empty capability set on their next request.
export function setMemberStatusStatement(
  database: SqlDatabase,
  userId: UserId,
  status: "active" | "deactivated",
): SqlStatement {
  return database
    .prepare(`UPDATE ${MEMBER_TABLE} SET status = ?2 WHERE user_id = ?1`)
    .bind(userId, status);
}

// WHO CAN STILL ADMINISTER THE FIRM — the read behind the one invariant that keeps a firm from
// locking itself out: it must always keep an active member who can administer its members. Both
// paths to a permission count, because both really confer it: a role the member holds, and an
// unexpired direct grant.
//
// Expiry is compared here rather than left to the resolver, which is the deliberate departure from
// the note on selectMemberPermissionsStatements. The resolver's boundary rule is reproduced exactly
// — a grant expiring at `now` is already expired, so the comparison is strictly greater — because
// this read answers a yes/no question inside a write path rather than composing a capability set,
// and shipping every grant row to the caller to ask "is anyone left" would read the whole table to
// answer a question SQL can count.
export async function readActiveMemberIdsWithPermission(
  database: SqlDatabase,
  permission: string,
  now: string,
): Promise<readonly string[]> {
  const { results } = await database
    .prepare(
      `SELECT ${MEMBER_TABLE}.user_id AS userId FROM ${MEMBER_TABLE} ` +
        `WHERE ${MEMBER_TABLE}.status = 'active' AND (` +
        `EXISTS (SELECT 1 FROM ${MEMBER_ROLE_TABLE} ` +
        `JOIN ${ROLE_PERMISSION_TABLE} ON ${ROLE_PERMISSION_TABLE}.role_id = ${MEMBER_ROLE_TABLE}.role_id ` +
        `WHERE ${MEMBER_ROLE_TABLE}.member_user_id = ${MEMBER_TABLE}.user_id AND ${ROLE_PERMISSION_TABLE}.permission = ?1) ` +
        `OR EXISTS (SELECT 1 FROM ${DIRECT_GRANT_TABLE} ` +
        `WHERE ${DIRECT_GRANT_TABLE}.member_user_id = ${MEMBER_TABLE}.user_id AND ${DIRECT_GRANT_TABLE}.permission = ?1 ` +
        `AND (${DIRECT_GRANT_TABLE}.expires_at IS NULL OR ${DIRECT_GRANT_TABLE}.expires_at > ?2)))`,
    )
    .bind(permission, now)
    .all<{ userId: string }>();
  return results.map((row) => row.userId);
}

// Which of the named roles carry a permission — the other half of the same invariant, asked of the
// role set a member is about to be left holding rather than of the one they hold now. An empty
// `roleIds` answers false without touching the database: no roles carry nothing.
export async function rolesCarryPermission(
  database: SqlDatabase,
  roleIds: readonly string[],
  permission: string,
): Promise<boolean> {
  if (roleIds.length === 0) return false;
  const placeholders = roleIds.map((_, index) => `?${index + 2}`).join(", ");
  const { results } = await database
    .prepare(
      `SELECT 1 AS carried FROM ${ROLE_PERMISSION_TABLE} ` +
        `WHERE ${ROLE_PERMISSION_TABLE}.permission = ?1 AND ${ROLE_PERMISSION_TABLE}.role_id IN (${placeholders}) LIMIT 1`,
    )
    .bind(permission, ...roleIds)
    .all<{ carried: number }>();
  return results.length > 0;
}

// A role by name — what the invite route resolves a caller-named role against before it lets the
// invitation through. Rows: { id }, zero rows meaning the firm has no such role.
export function selectRoleIdByNameStatement(database: SqlDatabase, name: string): SqlStatement {
  return database.prepare(`SELECT id FROM ${ROLE_TABLE} WHERE name = ?1`).bind(name);
}
