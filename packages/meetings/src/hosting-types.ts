import type { MeetingHostId, MeetingId, UserId } from "@magna-carta/identifiers/types";

// WHO IS RUNNING A MEETING, as the record holds it.
//
// The permission key and the grant answer different questions, and this file exists because of the
// split. `meetings:host` says who a firm lets convene a meeting — granted once, read everywhere. It
// cannot say who is running THIS room, because that changes while the meeting runs: hosting is
// handed over, co-hosts are named and withdrawn, and the member who opened the room may have been
// called away an hour ago.
//
// So authority over a meeting is a GRANT ON THE MEETING rather than a capability of a seat, and the
// grant is a row: `granted_at`, `revoked_at`, never deleted. The question a firm asks of the record
// months later is who was hosting when something happened, which is a question about an interval.

// THE TWO ROLES, and the difference is one act. A co-host holds every host act except acting on the
// host — they may not remove them, withdraw their grant, or hand the room over. A co-host is a fact
// about ONE meeting rather than a standing rank in the firm, which is why it is a row under a
// meeting and nothing in access control.
//
// Also a SQLite CHECK on the row, so a value that reaches a write without appearing here fails at
// the database and not only at the type checker.
export const MEETING_HOST_ROLES = Object.freeze(["host", "co-host"] as const);
export type MeetingHostRole = (typeof MEETING_HOST_ROLES)[number];

export function isMeetingHostRole(value: string): value is MeetingHostRole {
  return (MEETING_HOST_ROLES as readonly string[]).includes(value);
}

/**
 * One grant of authority over one meeting, in the database's own column names.
 *
 * `granted_by_user_id` is null exactly where nobody gave it: the starter's own grant, written in the
 * same batch as the room, and a claim of a room nobody was running. Both are recorded as what they
 * are rather than attributed to somebody who did not act.
 */
export interface MeetingHostRow {
  readonly id: MeetingHostId;
  readonly meeting_id: MeetingId;
  readonly user_id: UserId;
  readonly role: MeetingHostRole;
  readonly granted_by_user_id: UserId | null;
  readonly granted_at: string;
  /** Null while the grant stands. A grant is CLOSED, never deleted — the interval is the record. */
  readonly revoked_at: string | null;
  readonly revoked_by_user_id: UserId | null;
  readonly created_at: string;
  readonly updated_at: string;
}

/**
 * One live grant as a surface paints it.
 *
 * Three fields and no more: everybody in the room needs to know who is running it, and nothing about
 * how the room came to be theirs is part of that. The closed grants — the intervals — are the
 * record's, read from the row above rather than from this list.
 */
export interface MeetingHostGrant {
  readonly userId: UserId;
  readonly role: MeetingHostRole;
  readonly grantedAt: string;
}
