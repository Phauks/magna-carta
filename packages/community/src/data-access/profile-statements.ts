import type { CommunityProfileId, FirmId, UserId } from "@magna-carta/identifiers/types";
import type { SqlDatabase, SqlStatement } from "../sql.ts";
import type { Badge } from "../types.ts";
import { COMMUNITY_PROFILE_TABLE } from "./tables.ts";

// A member's board identity. Created on their first write and never on a read, so a member who only
// ever reads the board leaves no record on it at all.

export interface ProfileRecord {
  readonly id: CommunityProfileId;
  readonly userId: UserId;
  readonly firmId: FirmId;
  readonly displayName: string;
  readonly isPseudonym: boolean;
  readonly badge: Badge;
  readonly firstWriteApprovedAt: string | null;
  readonly writeBarredAt: string | null;
}

export interface StoredProfileRow {
  readonly id: string;
  readonly user_id: string;
  readonly firm_id: string;
  readonly display_name: string;
  readonly is_pseudonym: number;
  readonly badge: string;
  readonly first_write_approved_at: string | null;
  readonly write_barred_at: string | null;
}

export function selectProfileByUserStatement(database: SqlDatabase, userId: UserId): SqlStatement {
  return database
    .prepare(
      `SELECT id, user_id, firm_id, display_name, is_pseudonym, badge, first_write_approved_at, write_barred_at
       FROM ${COMMUNITY_PROFILE_TABLE} WHERE user_id = ?1`,
    )
    .bind(userId);
}

export function insertProfileStatement(
  database: SqlDatabase,
  input: {
    readonly id: CommunityProfileId;
    readonly userId: UserId;
    readonly firmId: FirmId;
    readonly displayName: string;
    readonly isPseudonym: boolean;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${COMMUNITY_PROFILE_TABLE}
         (id, user_id, firm_id, display_name, is_pseudonym, badge, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, 'none', ?6, ?6)`,
    )
    .bind(
      input.id,
      input.userId,
      input.firmId,
      input.displayName,
      input.isPseudonym ? 1 : 0,
      input.now,
    );
}

// The display name and the pseudonym flag are the two things a member controls. The badge is not:
// it is the board's only credibility signal, so an account cannot award itself one.
export function updateProfileDisplayNameStatement(
  database: SqlDatabase,
  input: {
    readonly userId: UserId;
    readonly displayName: string;
    readonly isPseudonym: boolean;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${COMMUNITY_PROFILE_TABLE}
         SET display_name = ?2, is_pseudonym = ?3, updated_at = ?4
       WHERE user_id = ?1`,
    )
    .bind(input.userId, input.displayName, input.isPseudonym ? 1 : 0, input.now);
}

// Approving an account's first write is what lets it write freely afterwards. Guarded on the column
// still being null so a second approval of the same account changes nothing and reports zero rows.
export function approveFirstWriteStatement(
  database: SqlDatabase,
  profileId: CommunityProfileId,
  now: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${COMMUNITY_PROFILE_TABLE}
         SET first_write_approved_at = ?2, updated_at = ?2
       WHERE id = ?1 AND first_write_approved_at IS NULL`,
    )
    .bind(profileId, now);
}

export function setWriteBarStatement(
  database: SqlDatabase,
  profileId: CommunityProfileId,
  barred: boolean,
  now: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${COMMUNITY_PROFILE_TABLE}
         SET write_barred_at = ?2, updated_at = ?3
       WHERE id = ?1`,
    )
    .bind(profileId, barred ? now : null, now);
}

export function setBadgeStatement(
  database: SqlDatabase,
  profileId: CommunityProfileId,
  badge: Badge,
  now: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${COMMUNITY_PROFILE_TABLE} SET badge = ?2, updated_at = ?3 WHERE id = ?1`,
    )
    .bind(profileId, badge, now);
}

export function toProfileRecord(row: StoredProfileRow): ProfileRecord {
  return {
    id: row.id as CommunityProfileId,
    userId: row.user_id as UserId,
    firmId: row.firm_id as FirmId,
    displayName: row.display_name,
    isPseudonym: row.is_pseudonym !== 0,
    badge: row.badge as Badge,
    firstWriteApprovedAt: row.first_write_approved_at,
    writeBarredAt: row.write_barred_at,
  };
}
