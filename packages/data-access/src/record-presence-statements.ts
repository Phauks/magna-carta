import type { UserId } from "@magna-carta/identifiers/types";
import type { SqlDatabase } from "./idempotency-statements.ts";

// WHO ELSE IS HERE — the statements over `record_presence`, the app's one record of which members
// have a record open right now.
//
// A screen touches its member's row every few seconds while the record is in view, and deletes it on
// leaving. Whoever touched within the window is "here". Nothing else is kept: a touch also clears that
// record's rows older than an hour, so a member who closed the tab without a leave does not linger in
// the table, only in the window.
//
// EVERY WRITE IS ADDRESSED BY THE SESSION MEMBER'S OWN USER ID. A member can only ever say that they
// themselves are here. WHICH records a member may announce or ask about is the route's decision: a
// route serves one record kind and checks the member may read that record before calling in here.
//
// Table name tracked against @magna-carta/database's per-firm schema by the schema-name-sync
// fitness test. This table exists only in the per-firm database; the caller supplies that handle.
export const RECORD_PRESENCE_TABLE = "record_presence";

/** How long after their last touch a member still counts as here. */
export const RECORD_PRESENCE_WINDOW_MILLISECONDS = 30_000;

/** How old a row may get before a touch on the same record clears it. */
const RECORD_PRESENCE_RETENTION_MILLISECONDS = 60 * 60 * 1000;

/** A record a member can be on: the kind of record the screen shows, and its id. */
export interface PresenceRecord {
  readonly recordKind: string;
  readonly recordId: string;
}

/** Someone else who has the record open. */
export interface PresentMember {
  readonly userId: UserId;
  readonly displayName: string;
  /** When they last touched, as an ISO-8601 instant. */
  readonly seenAt: string;
}

function instantBefore(now: string, milliseconds: number): string {
  return new Date(Date.parse(now) - milliseconds).toISOString();
}

/**
 * Says the member has the record open now, clears the record's stale rows, and answers who else is
 * here: every other member who touched within the window, by name, the most recent first.
 */
export async function touchRecordPresence(
  database: SqlDatabase,
  record: PresenceRecord,
  memberUserId: UserId,
  now: string,
): Promise<readonly PresentMember[]> {
  await database
    .prepare(
      `INSERT INTO ${RECORD_PRESENCE_TABLE} (record_kind, record_id, member_user_id, seen_at) ` +
        "VALUES (?1, ?2, ?3, ?4) " +
        "ON CONFLICT(record_kind, record_id, member_user_id) DO UPDATE SET seen_at = excluded.seen_at",
    )
    .bind(record.recordKind, record.recordId, memberUserId, now)
    .run();
  await database
    .prepare(
      `DELETE FROM ${RECORD_PRESENCE_TABLE} WHERE record_kind = ?1 AND record_id = ?2 AND seen_at < ?3`,
    )
    .bind(
      record.recordKind,
      record.recordId,
      instantBefore(now, RECORD_PRESENCE_RETENTION_MILLISECONDS),
    )
    .run();
  return readRecordPresence(database, record, memberUserId, now);
}

/** Who other than the member has the record open now. */
export async function readRecordPresence(
  database: SqlDatabase,
  record: PresenceRecord,
  memberUserId: UserId,
  now: string,
): Promise<readonly PresentMember[]> {
  const { results } = await database
    .prepare(
      "SELECT presence.member_user_id AS user_id, member.display_name AS display_name, presence.seen_at AS seen_at " +
        `FROM ${RECORD_PRESENCE_TABLE} AS presence ` +
        "JOIN member ON member.user_id = presence.member_user_id " +
        "WHERE presence.record_kind = ?1 AND presence.record_id = ?2 " +
        "AND presence.member_user_id <> ?3 AND presence.seen_at >= ?4 " +
        "AND member.status = 'active' " +
        "ORDER BY presence.seen_at DESC, member.display_name",
    )
    .bind(
      record.recordKind,
      record.recordId,
      memberUserId,
      instantBefore(now, RECORD_PRESENCE_WINDOW_MILLISECONDS),
    )
    .all<{ user_id: UserId; display_name: string; seen_at: string }>();
  return results.map((row) => ({
    userId: row.user_id,
    displayName: row.display_name,
    seenAt: row.seen_at,
  }));
}

/** Says the member has left the record. Leaving a record they were not on is not an error. */
export async function leaveRecordPresence(
  database: SqlDatabase,
  record: PresenceRecord,
  memberUserId: UserId,
): Promise<void> {
  await database
    .prepare(
      `DELETE FROM ${RECORD_PRESENCE_TABLE} WHERE record_kind = ?1 AND record_id = ?2 AND member_user_id = ?3`,
    )
    .bind(record.recordKind, record.recordId, memberUserId)
    .run();
}
