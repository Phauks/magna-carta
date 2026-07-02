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

// The member row's status by user id — the read /v1/me uses to split a DEACTIVATED member (404,
// absent semantics) from a never-mirrored one (no row → 200 with empty permissions; the
// sweep-lag window is transient and self-heals). Rows: { status }, zero rows means never mirrored.
export function selectMemberStatusStatement(database: SqlDatabase, userId: UserId): SqlStatement {
  return database.prepare(`SELECT status FROM ${MEMBER_TABLE} WHERE user_id = ?1`).bind(userId);
}
