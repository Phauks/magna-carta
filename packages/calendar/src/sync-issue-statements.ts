import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { IntegrationConnectionId } from "@magna-carta/identifiers/types";
import {
  CALENDAR_SYNC_LINK_TABLE,
  type SyncLinkKey,
  type SyncLocalKind,
} from "./sync-link-statements.ts";

// Table name tracked against @magna-carta/database's per-firm schema by the schema-name-sync
// fitness test.
export const CONNECTION_SYNC_ISSUE_TABLE = "connection_sync_issue";

// A copy in a member's own calendar that no longer matches what was sent (`changed`) or is no
// longer there (`removed`). One row per copy, keyed as its link is.

export type SyncIssueKind = "changed" | "removed";

// One side of the difference: the fields a member can see in their calendar and nothing else.
// Notes are left out because a provider hands them back reformatted, so they never compare.
export interface SyncCopyReading {
  readonly title: string;
  readonly location: string | null;
  readonly startsOn: string;
  // HH:MM, or null for a copy that takes the whole day.
  readonly startsAtTime: string | null;
  readonly endsOn: string;
  readonly endsAtTime: string | null;
  readonly timeZone: string;
}

export interface SyncIssueRow {
  readonly local_kind: SyncLocalKind;
  readonly local_id: string;
  readonly kind: SyncIssueKind;
  readonly state: "open" | "left";
  readonly remote_version_tag: string | null;
  readonly sent_json: string;
  readonly found_json: string | null;
  readonly detected_at: string;
}

const ISSUE_COLUMNS =
  "local_kind, local_id, kind, state, remote_version_tag, sent_json, found_json, detected_at";

export function selectSyncIssuesStatement(
  database: SqlDatabase,
  connectionId: IntegrationConnectionId,
): SqlStatement {
  return database
    .prepare(
      `SELECT ${ISSUE_COLUMNS} FROM ${CONNECTION_SYNC_ISSUE_TABLE} WHERE connection_id = ?1 ORDER BY detected_at DESC, local_kind, local_id`,
    )
    .bind(connectionId);
}

export function selectSyncIssueStatement(database: SqlDatabase, key: SyncLinkKey): SqlStatement {
  return database
    .prepare(
      `SELECT ${ISSUE_COLUMNS} FROM ${CONNECTION_SYNC_ISSUE_TABLE} WHERE connection_id = ?1 AND local_kind = ?2 AND local_id = ?3`,
    )
    .bind(key.connectionId, key.localKind, key.localId);
}

// Raising a difference for a copy that already has a row replaces the row and opens it again: the
// copy has moved on since the member last answered, so the earlier answer was about something else.
export function raiseSyncIssueStatement(
  database: SqlDatabase,
  key: SyncLinkKey,
  issue: {
    readonly kind: SyncIssueKind;
    readonly remoteVersionTag: string | null;
    readonly sentJson: string;
    readonly foundJson: string | null;
  },
  now: string,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${CONNECTION_SYNC_ISSUE_TABLE} (connection_id, local_kind, local_id, kind, state, remote_version_tag, sent_json, found_json, detected_at, settled_at) VALUES (?1, ?2, ?3, ?4, 'open', ?5, ?6, ?7, ?8, NULL) ON CONFLICT (connection_id, local_kind, local_id) DO UPDATE SET kind = excluded.kind, state = 'open', remote_version_tag = excluded.remote_version_tag, sent_json = excluded.sent_json, found_json = excluded.found_json, detected_at = excluded.detected_at, settled_at = NULL`,
    )
    .bind(
      key.connectionId,
      key.localKind,
      key.localId,
      issue.kind,
      issue.remoteVersionTag,
      issue.sentJson,
      issue.foundJson,
      now,
    );
}

// The member's answer "leave it as it is". The row stays, so the copy as it now stands is not
// raised again.
// fitness:unguarded-write — the route reads the row first and answers 404 without one; zero rows here means a second answer raced the first, which changes nothing
export function leaveSyncIssueStatement(
  database: SqlDatabase,
  key: SyncLinkKey,
  now: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${CONNECTION_SYNC_ISSUE_TABLE} SET state = 'left', settled_at = ?4 WHERE connection_id = ?1 AND local_kind = ?2 AND local_id = ?3 AND state = 'open'`,
    )
    .bind(key.connectionId, key.localKind, key.localId, now);
}

// fitness:unguarded-write — a repeat is meant to be a no-op: zero rows means the row was already gone
export function deleteSyncIssueStatement(database: SqlDatabase, key: SyncLinkKey): SqlStatement {
  return database
    .prepare(
      `DELETE FROM ${CONNECTION_SYNC_ISSUE_TABLE} WHERE connection_id = ?1 AND local_kind = ?2 AND local_id = ?3`,
    )
    .bind(key.connectionId, key.localKind, key.localId);
}

// A row whose copy was taken back (the event was cancelled, the rule removed, the firm closed the
// type) is about nothing, and goes.
// fitness:unguarded-write — a sweep: zero rows means there was nothing left over
export function deleteSyncIssuesWithoutLinkStatement(
  database: SqlDatabase,
  connectionId: IntegrationConnectionId,
): SqlStatement {
  return database
    .prepare(
      `DELETE FROM ${CONNECTION_SYNC_ISSUE_TABLE} WHERE connection_id = ?1 AND NOT EXISTS (SELECT 1 FROM ${CALENDAR_SYNC_LINK_TABLE} link WHERE link.connection_id = ${CONNECTION_SYNC_ISSUE_TABLE}.connection_id AND link.local_kind = ${CONNECTION_SYNC_ISSUE_TABLE}.local_kind AND link.local_id = ${CONNECTION_SYNC_ISSUE_TABLE}.local_id)`,
    )
    .bind(connectionId);
}

// fitness:unguarded-write — a disconnect removes whatever is there; zero rows means the account had no open questions
export function deleteSyncIssuesStatement(
  database: SqlDatabase,
  connectionId: IntegrationConnectionId,
): SqlStatement {
  return database
    .prepare(`DELETE FROM ${CONNECTION_SYNC_ISSUE_TABLE} WHERE connection_id = ?1`)
    .bind(connectionId);
}
