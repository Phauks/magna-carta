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

// The member row's status by user id — the read /v1/me uses to split a DEACTIVATED member (404,
// absent semantics) from a never-mirrored one (no row → 200 with empty permissions; the
// sweep-lag window is transient and self-heals). Rows: { status }, zero rows means never mirrored.
export function selectMemberStatusStatement(database: SqlDatabase, userId: UserId): SqlStatement {
  return database.prepare(`SELECT status FROM ${MEMBER_TABLE} WHERE user_id = ?1`).bind(userId);
}
