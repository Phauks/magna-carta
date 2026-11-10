import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { IntegrationConnectionId, UserId } from "@magna-carta/identifiers/types";
import { MATTER_DEADLINE_TABLE } from "./deadline-statements.ts";
import { MATTER_EVENT_TABLE } from "./event-statements.ts";
import { FIRM_EVENT_TABLE } from "./firm-event-statements.ts";
import { CALENDAR_SYNC_CATEGORY } from "./sync-port.ts";
import { CALENDAR_SYNC_RULE_TABLE } from "./sync-rule-statements.ts";
import type { VisibleMatterPredicate } from "./visibility.ts";

// Table name tracked against @magna-carta/database's per-firm schema by the schema-name-sync
// fitness test.
export const CALENDAR_SYNC_LINK_TABLE = "calendar_sync_link";

export const SYNC_LOCAL_KINDS = ["matter_event", "firm_event", "deadline"] as const;
export type SyncLocalKind = (typeof SYNC_LOCAL_KINDS)[number];

export interface SyncLinkKey {
  readonly connectionId: IntegrationConnectionId;
  readonly localKind: SyncLocalKind;
  readonly localId: string;
}

export interface SyncLinkRow {
  readonly local_kind: SyncLocalKind;
  readonly local_id: string;
  readonly calendar_remote_id: string;
  readonly transaction_id: string;
  readonly remote_event_id: string | null;
  readonly remote_version_tag: string | null;
  readonly agreed_hash: string;
  readonly state: "pending" | "synced" | "failed";
}

export function selectSyncLinksStatement(
  database: SqlDatabase,
  connectionId: IntegrationConnectionId,
): SqlStatement {
  return database
    .prepare(
      `SELECT local_kind, local_id, calendar_remote_id, transaction_id, remote_event_id, remote_version_tag, agreed_hash, state FROM ${CALENDAR_SYNC_LINK_TABLE} WHERE connection_id = ?1`,
    )
    .bind(connectionId);
}

// Written before the provider is asked for anything, so the request's identifier survives a pass
// that dies waiting for the answer.
export function insertPendingSyncLinkStatement(
  database: SqlDatabase,
  key: SyncLinkKey,
  link: {
    readonly calendarRemoteId: string;
    readonly transactionId: string;
    readonly agreedHash: string;
  },
  now: string,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${CALENDAR_SYNC_LINK_TABLE} (connection_id, local_kind, local_id, calendar_remote_id, transaction_id, remote_event_id, remote_version_tag, agreed_hash, state, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, NULL, NULL, ?6, 'pending', ?7, ?7)`,
    )
    .bind(
      key.connectionId,
      key.localKind,
      key.localId,
      link.calendarRemoteId,
      link.transactionId,
      link.agreedHash,
      now,
    );
}

// fitness:unguarded-write — the pass holds the link it is recording against; zero rows means the member disconnected mid-pass, and there is then nothing to record
export function markSyncLinkSyncedStatement(
  database: SqlDatabase,
  key: SyncLinkKey,
  agreed: {
    readonly remoteEventId: string;
    readonly remoteVersionTag: string | null;
    readonly agreedHash: string;
  },
  now: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${CALENDAR_SYNC_LINK_TABLE} SET remote_event_id = ?4, remote_version_tag = ?5, agreed_hash = ?6, state = 'synced', updated_at = ?7 WHERE connection_id = ?1 AND local_kind = ?2 AND local_id = ?3`,
    )
    .bind(
      key.connectionId,
      key.localKind,
      key.localId,
      agreed.remoteEventId,
      agreed.remoteVersionTag,
      agreed.agreedHash,
      now,
    );
}

// The provider refused this one event for a reason that waiting will not change. The row stays, so
// the next pass sees it was tried, and its digest is cleared so a later edit to the event is tried
// again.
// fitness:unguarded-write — zero rows means the member disconnected mid-pass, and there is then nothing to record
export function markSyncLinkFailedStatement(
  database: SqlDatabase,
  key: SyncLinkKey,
  agreedHash: string,
  now: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${CALENDAR_SYNC_LINK_TABLE} SET agreed_hash = ?4, state = 'failed', updated_at = ?5 WHERE connection_id = ?1 AND local_kind = ?2 AND local_id = ?3`,
    )
    .bind(key.connectionId, key.localKind, key.localId, agreedHash, now);
}

// The copy at the provider no longer matches what was sent and is to be sent again. Clearing the
// digest is the whole instruction: the next pass finds the event differs from what was agreed and
// writes it.
// fitness:unguarded-write — zero rows means the copy was taken back in the meantime, and there is then nothing to send again
export function clearSyncLinkAgreementStatement(
  database: SqlDatabase,
  key: SyncLinkKey,
  now: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${CALENDAR_SYNC_LINK_TABLE} SET agreed_hash = '', updated_at = ?4 WHERE connection_id = ?1 AND local_kind = ?2 AND local_id = ?3`,
    )
    .bind(key.connectionId, key.localKind, key.localId, now);
}

// The provider's tag moved and the copy still reads as it was sent (a reminder dismissed, a
// category set). The new tag is kept so the same non-change is not examined on every pass.
// fitness:unguarded-write — zero rows means the member disconnected mid-pass, and there is then nothing to record
export function recordSyncLinkVersionStatement(
  database: SqlDatabase,
  key: SyncLinkKey,
  remoteVersionTag: string,
  now: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${CALENDAR_SYNC_LINK_TABLE} SET remote_version_tag = ?4, updated_at = ?5 WHERE connection_id = ?1 AND local_kind = ?2 AND local_id = ?3`,
    )
    .bind(key.connectionId, key.localKind, key.localId, remoteVersionTag, now);
}

// fitness:unguarded-write — a repeat is meant to be a no-op: zero rows means the link was already gone
export function deleteSyncLinkStatement(database: SqlDatabase, key: SyncLinkKey): SqlStatement {
  return database
    .prepare(
      `DELETE FROM ${CALENDAR_SYNC_LINK_TABLE} WHERE connection_id = ?1 AND local_kind = ?2 AND local_id = ?3`,
    )
    .bind(key.connectionId, key.localKind, key.localId);
}

// Every link of one account, removed when the account is disconnected. The copies stay in the
// member's calendar: the sign-in that could have removed them is the thing being deleted.
export function deleteSyncLinksStatement(
  database: SqlDatabase,
  connectionId: IntegrationConnectionId,
): SqlStatement {
  return database
    .prepare(`DELETE FROM ${CALENDAR_SYNC_LINK_TABLE} WHERE connection_id = ?1`)
    .bind(connectionId);
}

export interface SyncingConnectionRow {
  readonly id: IntegrationConnectionId;
  readonly principal_ref: UserId;
}

// The accounts a change to the calendar could matter to: every connected calendar account that has
// a rule, or still has a copy out from a rule since removed. An account with neither has nothing to
// send and nothing to take back.
export function selectSyncingConnectionsStatement(database: SqlDatabase): SqlStatement {
  return database
    .prepare(
      `SELECT connection.id AS id, connection.principal_ref AS principal_ref FROM integration_connection AS connection WHERE connection.category = ?1 AND connection.status = 'connected' AND (EXISTS (SELECT 1 FROM ${CALENDAR_SYNC_RULE_TABLE} AS rule WHERE rule.connection_id = connection.id) OR EXISTS (SELECT 1 FROM ${CALENDAR_SYNC_LINK_TABLE} AS link WHERE link.connection_id = connection.id))`,
    )
    .bind(CALENDAR_SYNC_CATEGORY);
}

// One thing that could be sent, as its table holds it. `takes_part` and `on_own_matter` are the two
// facts a rule's scope is decided from; the decision itself is made in sync-outbound.ts, where the
// rule is.
export interface SyncCandidateRow {
  readonly id: string;
  readonly subject: string;
  readonly title: string;
  readonly description: string | null;
  readonly starts_on: string;
  readonly starts_at_time: string | null;
  readonly ends_on: string | null;
  readonly ends_at_time: string | null;
  readonly time_zone: string;
  readonly location_text: string | null;
  readonly conference_url: string | null;
  readonly matter_number: string | null;
  readonly type_name: string | null;
  readonly takes_part: number;
  readonly on_own_matter: number;
  // The stored repeat rule of a series, or null for something that happens once.
  readonly recurrence_rule: string | null;
  // The days of a series that a row of their own stands in for (changed or called off), joined by
  // commas. Those days are not the series' to show.
  readonly replaced_days: string | null;
}

export interface SyncWindow {
  readonly from: string; // YYYY-MM-DD, inclusive
  readonly to: string; // YYYY-MM-DD, inclusive
}

const OWN_MATTER = (matterIdExpression: string): string =>
  `EXISTS (SELECT 1 FROM matter_assignment AS assignment WHERE assignment.matter_id = ${matterIdExpression} AND assignment.member_user_id = ?1 AND assignment.valid_to IS NULL)`;

// A member's matter events inside the window: the ones they are named on, and the ones on a matter
// they are currently assigned to. A repeating series is one row, read whenever it started, because
// a series begun years ago may fall inside the window today; the caller drops one that has ended.
// It carries the days a row of its own replaces. A changed day is such a row and is read like any
// other event; a day called off is a cancelled row and is not read at all.
export function selectMatterEventSyncCandidatesStatement(
  database: SqlDatabase,
  visibility: VisibleMatterPredicate,
  memberUserId: UserId,
  window: SyncWindow,
): SqlStatement {
  const takesPart = `EXISTS (SELECT 1 FROM matter_event_participant AS participant WHERE participant.event_id = event.id AND participant.member_user_id = ?1)`;
  const onOwnMatter = OWN_MATTER("event.matter_id");
  return database
    .prepare(
      `SELECT event.id AS id, event.event_type_id AS subject, event.title AS title, event.description AS description, event.starts_on AS starts_on, event.starts_at_time AS starts_at_time, event.ends_on AS ends_on, event.ends_at_time AS ends_at_time, event.time_zone AS time_zone, event.location_text AS location_text, event.conference_url AS conference_url, (SELECT origin.matter_number FROM matter AS origin WHERE origin.id = event.matter_id) AS matter_number, (SELECT type.name FROM matter_event_type AS type WHERE type.id = event.event_type_id) AS type_name, ${takesPart} AS takes_part, ${onOwnMatter} AS on_own_matter, event.recurrence_rule AS recurrence_rule, (SELECT group_concat(replacement.recurrence_occurrence_on) FROM ${MATTER_EVENT_TABLE} AS replacement WHERE replacement.recurrence_parent_id = event.id) AS replaced_days FROM ${MATTER_EVENT_TABLE} AS event WHERE event.status <> 'cancelled' AND event.event_type_id IS NOT NULL AND event.starts_on <= ?3 AND (event.recurrence_rule IS NOT NULL OR event.starts_on >= ?2) AND ${visibility.fragmentFor("event.matter_id")} AND (${takesPart} OR ${onOwnMatter})`,
    )
    .bind(memberUserId, window.from, window.to, ...visibility.bindings);
}

// A member's firm events inside the window: the ones they are named on, and the ones held for every
// member. A firm event has no matter, so both scopes of a rule mean the same thing for it.
export function selectFirmEventSyncCandidatesStatement(
  database: SqlDatabase,
  memberUserId: UserId,
  window: SyncWindow,
): SqlStatement {
  const takesPart = `(event.audience = 'all_members' OR EXISTS (SELECT 1 FROM firm_event_participant AS participant WHERE participant.firm_event_id = event.id AND participant.member_user_id = ?1))`;
  return database
    .prepare(
      `SELECT event.id AS id, event.event_type_id AS subject, event.title AS title, event.description AS description, event.starts_on AS starts_on, event.starts_at_time AS starts_at_time, event.ends_on AS ends_on, event.ends_at_time AS ends_at_time, event.time_zone AS time_zone, event.location_text AS location_text, event.conference_url AS conference_url, NULL AS matter_number, (SELECT type.name FROM matter_event_type AS type WHERE type.id = event.event_type_id) AS type_name, 1 AS takes_part, 0 AS on_own_matter, event.recurrence_rule AS recurrence_rule, (SELECT group_concat(replacement.recurrence_occurrence_on) FROM ${FIRM_EVENT_TABLE} AS replacement WHERE replacement.recurrence_parent_id = event.id) AS replaced_days FROM ${FIRM_EVENT_TABLE} AS event WHERE event.status <> 'cancelled' AND event.event_type_id IS NOT NULL AND event.starts_on <= ?3 AND (event.recurrence_rule IS NOT NULL OR event.starts_on >= ?2) AND ${takesPart}`,
    )
    .bind(memberUserId, window.from, window.to);
}

// The open deadlines on a member's matters inside the window. A deadline names nobody, so the
// matter decides whose it is: the narrow scope is the matters the member is responsible for, the
// wide one every matter they are currently assigned to.
export function selectDeadlineSyncCandidatesStatement(
  database: SqlDatabase,
  visibility: VisibleMatterPredicate,
  memberUserId: UserId,
  window: SyncWindow,
): SqlStatement {
  const responsible = `EXISTS (SELECT 1 FROM matter AS led WHERE led.id = deadline.matter_id AND led.responsible_member_id = ?1)`;
  const assigned = OWN_MATTER("deadline.matter_id");
  return database
    .prepare(
      `SELECT deadline.id AS id, 'deadline' AS subject, deadline.title AS title, NULL AS description, deadline.due_on AS starts_on, deadline.due_at_time AS starts_at_time, NULL AS ends_on, NULL AS ends_at_time, deadline.time_zone AS time_zone, NULL AS location_text, NULL AS conference_url, (SELECT origin.matter_number FROM matter AS origin WHERE origin.id = deadline.matter_id) AS matter_number, NULL AS type_name, ${responsible} AS takes_part, ${assigned} AS on_own_matter, NULL AS recurrence_rule, NULL AS replaced_days FROM ${MATTER_DEADLINE_TABLE} AS deadline WHERE deadline.state = 'open' AND deadline.due_on >= ?2 AND deadline.due_on <= ?3 AND ${visibility.fragmentFor("deadline.matter_id")} AND (${responsible} OR ${assigned})`,
    )
    .bind(memberUserId, window.from, window.to, ...visibility.bindings);
}
