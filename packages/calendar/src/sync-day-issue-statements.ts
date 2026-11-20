import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { IntegrationConnectionId } from "@magna-carta/identifiers/types";
import { CALENDAR_SYNC_LINK_TABLE, type SyncLinkKey } from "./sync-link-statements.ts";

// Table name tracked against @magna-carta/database's per-firm schema by the schema-name-sync
// fitness test.
export const CONNECTION_SYNC_DAY_ISSUE_TABLE = "connection_sync_day_issue";

// One day of a repeating event that is gone from a member's own calendar while the series is
// still there. One row per day, keyed by the series' copy and the day. The event in the firm's
// calendar is never changed by one of these: the member is told, and answers.

export type SyncDayIssueState = "open" | "left" | "restoring";

export interface SyncDayIssueRow {
  readonly local_kind: "matter_event" | "firm_event";
  readonly local_id: string;
  readonly occurrence_on: string;
  readonly state: SyncDayIssueState;
  readonly day_remote_id: string | null;
  readonly sent_json: string;
  readonly detected_at: string;
}

export interface SyncDayIssueKey extends SyncLinkKey {
  readonly occurrenceOn: string;
}

const DAY_ISSUE_COLUMNS =
  "local_kind, local_id, occurrence_on, state, day_remote_id, sent_json, detected_at";

export function selectSyncDayIssuesStatement(
  database: SqlDatabase,
  connectionId: IntegrationConnectionId,
): SqlStatement {
  return database
    .prepare(
      `SELECT ${DAY_ISSUE_COLUMNS} FROM ${CONNECTION_SYNC_DAY_ISSUE_TABLE} WHERE connection_id = ?1 ORDER BY occurrence_on, local_kind, local_id`,
    )
    .bind(connectionId);
}

export function selectSyncDayIssueStatement(
  database: SqlDatabase,
  key: SyncDayIssueKey,
): SqlStatement {
  return database
    .prepare(
      `SELECT ${DAY_ISSUE_COLUMNS} FROM ${CONNECTION_SYNC_DAY_ISSUE_TABLE} WHERE connection_id = ?1 AND local_kind = ?2 AND local_id = ?3 AND occurrence_on = ?4`,
    )
    .bind(key.connectionId, key.localKind, key.localId, key.occurrenceOn);
}

// A day already on record keeps its row and its answer: the member is asked about a day once. Only
// the handle is refreshed, because it is the provider's and may be given anew.
export function raiseSyncDayIssueStatement(
  database: SqlDatabase,
  key: SyncDayIssueKey,
  issue: { readonly dayRemoteId: string | null; readonly sentJson: string },
  now: string,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${CONNECTION_SYNC_DAY_ISSUE_TABLE} (connection_id, local_kind, local_id, occurrence_on, state, day_remote_id, sent_json, detected_at, settled_at) VALUES (?1, ?2, ?3, ?4, 'open', ?5, ?6, ?7, NULL) ON CONFLICT (connection_id, local_kind, local_id, occurrence_on) DO UPDATE SET day_remote_id = excluded.day_remote_id`,
    )
    .bind(
      key.connectionId,
      key.localKind,
      key.localId,
      key.occurrenceOn,
      issue.dayRemoteId,
      issue.sentJson,
      now,
    );
}

// The member's answer, or a pass handing a day it could not put back to the member again.
// fitness:unguarded-write — the route reads the row first and answers 404 without one; zero rows here means a second answer raced the first, which changes nothing
export function setSyncDayIssueStateStatement(
  database: SqlDatabase,
  key: SyncDayIssueKey,
  from: SyncDayIssueState,
  to: SyncDayIssueState,
  now: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${CONNECTION_SYNC_DAY_ISSUE_TABLE} SET state = ?6, settled_at = CASE WHEN ?6 = 'open' THEN NULL ELSE ?7 END WHERE connection_id = ?1 AND local_kind = ?2 AND local_id = ?3 AND occurrence_on = ?4 AND state = ?5`,
    )
    .bind(key.connectionId, key.localKind, key.localId, key.occurrenceOn, from, to, now);
}

// fitness:unguarded-write — a repeat is meant to be a no-op: zero rows means the row was already gone
export function deleteSyncDayIssueStatement(
  database: SqlDatabase,
  key: SyncDayIssueKey,
): SqlStatement {
  return database
    .prepare(
      `DELETE FROM ${CONNECTION_SYNC_DAY_ISSUE_TABLE} WHERE connection_id = ?1 AND local_kind = ?2 AND local_id = ?3 AND occurrence_on = ?4`,
    )
    .bind(key.connectionId, key.localKind, key.localId, key.occurrenceOn);
}

// A row whose series' copy was taken back is about nothing, and goes.
// fitness:unguarded-write — a sweep: zero rows means there was nothing left over
export function deleteSyncDayIssuesWithoutLinkStatement(
  database: SqlDatabase,
  connectionId: IntegrationConnectionId,
): SqlStatement {
  return database
    .prepare(
      `DELETE FROM ${CONNECTION_SYNC_DAY_ISSUE_TABLE} WHERE connection_id = ?1 AND NOT EXISTS (SELECT 1 FROM ${CALENDAR_SYNC_LINK_TABLE} link WHERE link.connection_id = ${CONNECTION_SYNC_DAY_ISSUE_TABLE}.connection_id AND link.local_kind = ${CONNECTION_SYNC_DAY_ISSUE_TABLE}.local_kind AND link.local_id = ${CONNECTION_SYNC_DAY_ISSUE_TABLE}.local_id)`,
    )
    .bind(connectionId);
}

// fitness:unguarded-write — a disconnect removes whatever is there; zero rows means the account had none
export function deleteSyncDayIssuesStatement(
  database: SqlDatabase,
  connectionId: IntegrationConnectionId,
): SqlStatement {
  return database
    .prepare(`DELETE FROM ${CONNECTION_SYNC_DAY_ISSUE_TABLE} WHERE connection_id = ?1`)
    .bind(connectionId);
}
