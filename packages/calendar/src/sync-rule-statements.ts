import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type {
  IntegrationConnectionId,
  MatterEventTypeId,
  UserId,
} from "@magna-carta/identifiers/types";

// Table names tracked against @magna-carta/database's per-firm schema by the schema-name-sync
// fitness test.
export const CALENDAR_SYNC_RULE_TABLE = "calendar_sync_rule";
export const CALENDAR_SYNC_FIRM_LIMIT_TABLE = "calendar_sync_firm_limit";

// The one subject that is not an event type: every deadline, as a kind.
export const DEADLINE_SUBJECT = "deadline";

export const SYNC_RULE_SCOPES = ["mine", "my_matters"] as const;
export type SyncRuleScope = (typeof SYNC_RULE_SCOPES)[number];

export const SYNC_DETAIL_LEVELS = ["full", "minimal"] as const;
export type SyncDetailLevel = (typeof SYNC_DETAIL_LEVELS)[number];

export interface SyncRuleRow {
  readonly subject: string;
  readonly calendar_remote_id: string;
  readonly calendar_name: string;
  readonly scope: SyncRuleScope;
}

export interface SyncFirmLimitRow {
  readonly subject: string;
  readonly may_leave: number;
  readonly detail: SyncDetailLevel;
}

// The event type a subject names, or null for the deadline subject. The two columns say one thing
// twice on purpose: `subject` is the key, `event_type_id` is the foreign key that stops a rule
// naming a type that does not exist, and a check constraint keeps them in agreement.
function eventTypeIdOf(subject: string): MatterEventTypeId | null {
  return subject === DEADLINE_SUBJECT ? null : (subject as MatterEventTypeId);
}

export function selectSyncRulesStatement(
  database: SqlDatabase,
  connectionId: IntegrationConnectionId,
): SqlStatement {
  return database
    .prepare(
      `SELECT subject, calendar_remote_id, calendar_name, scope FROM ${CALENDAR_SYNC_RULE_TABLE} WHERE connection_id = ?1`,
    )
    .bind(connectionId);
}

export function deleteSyncRulesStatement(
  database: SqlDatabase,
  connectionId: IntegrationConnectionId,
): SqlStatement {
  return database
    .prepare(`DELETE FROM ${CALENDAR_SYNC_RULE_TABLE} WHERE connection_id = ?1`)
    .bind(connectionId);
}

// Every member's rule for one subject, removed when the firm stops that subject leaving.
export function deleteSyncRulesForSubjectStatement(
  database: SqlDatabase,
  subject: string,
): SqlStatement {
  return database
    .prepare(`DELETE FROM ${CALENDAR_SYNC_RULE_TABLE} WHERE subject = ?1`)
    .bind(subject);
}

export function insertSyncRuleStatement(
  database: SqlDatabase,
  connectionId: IntegrationConnectionId,
  rule: {
    readonly subject: string;
    readonly calendarRemoteId: string;
    readonly calendarName: string;
    readonly scope: SyncRuleScope;
  },
  now: string,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${CALENDAR_SYNC_RULE_TABLE} (connection_id, subject, event_type_id, calendar_remote_id, calendar_name, scope, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)`,
    )
    .bind(
      connectionId,
      rule.subject,
      eventTypeIdOf(rule.subject),
      rule.calendarRemoteId,
      rule.calendarName,
      rule.scope,
      now,
    );
}

export function selectSyncFirmLimitsStatement(database: SqlDatabase): SqlStatement {
  return database.prepare(
    `SELECT subject, may_leave, detail FROM ${CALENDAR_SYNC_FIRM_LIMIT_TABLE}`,
  );
}

export function upsertSyncFirmLimitStatement(
  database: SqlDatabase,
  limit: {
    readonly subject: string;
    readonly mayLeave: boolean;
    readonly detail: SyncDetailLevel;
  },
  updatedBy: UserId,
  now: string,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${CALENDAR_SYNC_FIRM_LIMIT_TABLE} (subject, event_type_id, may_leave, detail, updated_at, updated_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6) ON CONFLICT (subject) DO UPDATE SET may_leave = excluded.may_leave, detail = excluded.detail, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    )
    .bind(
      limit.subject,
      eventTypeIdOf(limit.subject),
      limit.mayLeave ? 1 : 0,
      limit.detail,
      now,
      updatedBy,
    );
}
