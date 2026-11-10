import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type {
  FirmEventId,
  FirmEventParticipantId,
  LocationId,
  MatterEventTypeId,
  UserId,
} from "@magna-carta/identifiers/types";
import type { FirmEventAudience, FirmEventStatus, MatterEventParticipantKind } from "./types.ts";

// The firm's own event scope. These reads deliberately compose NO visible-matter predicate: a firm
// event has no matter, and under the trusted-insider posture every member sees the firm's own
// calendar — an ethical wall is a MATTER screen with nothing to bind to on a firm meeting. That
// absence is a declared decision, not an oversight: the `firmEvent` timeline source declares
// `visibilityAnchor: 'firm'` and sits on a reviewed allowlist the source-fitness pass asserts. If a
// firm-event screen is ever needed (a partners-only compensation meeting), it is a new declared
// anchor with its own predicate, never a loosening of the matter one.

// Table names tracked against @magna-carta/database's per-firm schema by the schema-name-sync
// fitness test.
export const FIRM_EVENT_TABLE = "firm_event";
export const FIRM_EVENT_PARTICIPANT_TABLE = "firm_event_participant";

export interface FirmEventRow {
  readonly id: FirmEventId;
  readonly event_type_id: MatterEventTypeId | null;
  readonly title: string;
  readonly description: string | null;
  readonly status: FirmEventStatus;
  readonly status_reason: string | null;
  readonly starts_on: string;
  readonly starts_at_time: string | null;
  readonly ends_on: string | null;
  readonly ends_at_time: string | null;
  readonly time_zone: string;
  readonly audience: FirmEventAudience;
  readonly location_id: LocationId | null;
  readonly location_text: string | null;
  // Where an online firm meeting is JOINED, which is a different fact from where it is held.
  readonly conference_url: string | null;
  /** The RFC 5545 rule a repeating event runs on, null on a one-off. One row carries the series. */
  readonly recurrence_rule: string | null;
  /** The series and the day this row replaces, where it is one occurrence written as an exception. */
  readonly recurrence_parent_id: FirmEventId | null;
  readonly recurrence_occurrence_on: string | null;
  readonly recorded_at: string;
  readonly recorded_by: UserId | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface FirmEventParticipantRow {
  readonly id: FirmEventParticipantId;
  readonly firm_event_id: FirmEventId;
  readonly participant_kind: MatterEventParticipantKind;
  readonly member_user_id: UserId | null;
  readonly entity_id: string | null;
  readonly participant_name: string | null;
  readonly role: string | null;
}

const FIRM_EVENT_COLUMNS =
  "id, event_type_id, title, description, status, status_reason, starts_on, starts_at_time, ends_on, " +
  "ends_at_time, time_zone, audience, location_id, location_text, conference_url, recurrence_rule, recorded_at, recorded_by, created_at, updated_at, " +
  "recurrence_parent_id, recurrence_occurrence_on";

export interface InsertFirmEventInput {
  readonly id: FirmEventId;
  readonly eventTypeId: MatterEventTypeId | null;
  readonly title: string;
  readonly description: string | null;
  readonly status: FirmEventStatus;
  readonly startsOn: string;
  readonly startsAtTime: string | null;
  readonly endsOn: string | null;
  readonly endsAtTime: string | null;
  readonly timeZone: string;
  readonly audience: FirmEventAudience;
  readonly locationId: LocationId | null;
  readonly locationText: string | null;
  readonly conferenceUrl: string | null;
  /** The RFC 5545 rule, or null for an event that happens once. */
  readonly recurrenceRule: string | null;
  /** The series and the day this row replaces, where it is one occurrence written as an exception. */
  readonly recurrenceParentId?: FirmEventId | null;
  readonly recurrenceOccurrenceOn?: string | null;
  readonly recordedAt: string;
  readonly recordedBy: UserId | null;
  readonly now: string;
}

export function insertFirmEventStatement(
  database: SqlDatabase,
  input: InsertFirmEventInput,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${FIRM_EVENT_TABLE} (${FIRM_EVENT_COLUMNS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?19, ?20, ?21)`,
    )
    .bind(
      input.id,
      input.eventTypeId,
      input.title,
      input.description,
      input.status,
      // A new event starts with no status reason: the column belongs to cancellation.
      null,
      input.startsOn,
      input.startsAtTime,
      input.endsOn,
      input.endsAtTime,
      input.timeZone,
      input.audience,
      input.locationId,
      input.locationText,
      input.conferenceUrl,
      input.recurrenceRule,
      input.recordedAt,
      input.recordedBy,
      input.now,
      input.recurrenceParentId ?? null,
      input.recurrenceOccurrenceOn ?? null,
    );
}

export function updateFirmEventStatement(
  database: SqlDatabase,
  id: FirmEventId,
  patch: {
    readonly eventTypeId: MatterEventTypeId | null;
    readonly title: string;
    readonly description: string | null;
    readonly status: FirmEventStatus;
    readonly startsOn: string;
    readonly startsAtTime: string | null;
    readonly endsOn: string | null;
    readonly endsAtTime: string | null;
    readonly timeZone: string;
    readonly audience: FirmEventAudience;
    readonly locationId: LocationId | null;
    readonly locationText: string | null;
    readonly conferenceUrl: string | null;
    /** The repeat rule, which a correction may change or clear. */
    readonly recurrenceRule: string | null;
  },
  updatedAt: string,
): SqlStatement {
  // A firm event keeps edit-in-place semantics throughout — a moved staff meeting is not
  // procedural history, so there is no continuance machinery here.
  return database
    .prepare(
      `UPDATE ${FIRM_EVENT_TABLE} SET event_type_id = ?2, title = ?3, description = ?4, status = ?5, ` +
        `starts_on = ?6, starts_at_time = ?7, ends_on = ?8, ends_at_time = ?9, time_zone = ?10, ` +
        `audience = ?11, location_id = ?12, location_text = ?13, conference_url = ?14, ` +
        `recurrence_rule = ?15, updated_at = ?16 WHERE id = ?1`,
    )
    .bind(
      id,
      patch.eventTypeId,
      patch.title,
      patch.description,
      patch.status,
      patch.startsOn,
      patch.startsAtTime,
      patch.endsOn,
      patch.endsAtTime,
      patch.timeZone,
      patch.audience,
      patch.locationId,
      patch.locationText,
      patch.conferenceUrl,
      patch.recurrenceRule,
      updatedAt,
    );
}

export function cancelFirmEventStatement(
  database: SqlDatabase,
  id: FirmEventId,
  updatedAt: string,
  statusReason: string | null,
): SqlStatement {
  // Cancelled, never deleted — and cancelling releases the event's bookings by DERIVATION: a
  // booking blocks its resource only while its event's status is not 'cancelled', so no second
  // write exists to forget.
  return database
    .prepare(
      `UPDATE ${FIRM_EVENT_TABLE} SET status = 'cancelled', status_reason = ?3, updated_at = ?2 WHERE id = ?1`,
    )
    .bind(id, updatedAt, statusReason);
}

export function selectFirmEventStatement(database: SqlDatabase, id: FirmEventId): SqlStatement {
  return database
    .prepare(`SELECT ${FIRM_EVENT_COLUMNS} FROM ${FIRM_EVENT_TABLE} WHERE id = ?1`)
    .bind(id);
}

export async function readFirmEvent(
  database: SqlDatabase,
  id: FirmEventId,
): Promise<FirmEventRow | undefined> {
  const { results } = await selectFirmEventStatement(database, id).all<FirmEventRow>();
  return results[0];
}

// The firm's own event list, date-windowed and keyset over (starts_on, id) — the shape the firm
// calendar's cursor already speaks. The window is REQUIRED by the route (and capped as a refusal);
// this statement trusts its caller to have asserted it.
export function selectFirmEventsStatement(
  database: SqlDatabase,
  options: {
    readonly fromDate: string;
    readonly toDate: string;
    readonly status?: FirmEventStatus;
    readonly eventTypeId?: MatterEventTypeId;
    readonly cursor?: { sortKey: string; id: string };
    readonly limit: number;
  },
): SqlStatement {
  // A firm event can SPAN days — a week of office closure, a two-day training — so the window holds
  // it while it is still running rather than only on the day it began. `COALESCE` makes a one-day
  // event behave exactly as it always did: its end IS its start.
  const conditions = ["COALESCE(ends_on, starts_on) >= ?", "starts_on <= ?"];
  const bindings: unknown[] = [options.fromDate, options.toDate];
  if (options.status !== undefined) {
    conditions.push("status = ?");
    bindings.push(options.status);
  }
  if (options.eventTypeId !== undefined) {
    conditions.push("event_type_id = ?");
    bindings.push(options.eventTypeId);
  }
  if (options.cursor !== undefined) {
    conditions.push("(starts_on < ? OR (starts_on = ? AND id < ?))");
    bindings.push(options.cursor.sortKey, options.cursor.sortKey, options.cursor.id);
  }
  bindings.push(options.limit);
  return database
    .prepare(
      `SELECT ${FIRM_EVENT_COLUMNS} FROM ${FIRM_EVENT_TABLE} WHERE ${conditions.join(" AND ")} ` +
        `ORDER BY starts_on DESC, id DESC LIMIT ?`,
    )
    .bind(...bindings);
}

export function insertFirmEventParticipantStatement(
  database: SqlDatabase,
  row: {
    readonly id: FirmEventParticipantId;
    readonly firmEventId: FirmEventId;
    readonly participantKind: MatterEventParticipantKind;
    readonly memberUserId: UserId | null;
    readonly entityId: string | null;
    readonly participantName: string | null;
    readonly role: string | null;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${FIRM_EVENT_PARTICIPANT_TABLE} (id, firm_event_id, participant_kind, member_user_id, entity_id, participant_name, role, created_at, updated_at) ` +
        `VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)`,
    )
    .bind(
      row.id,
      row.firmEventId,
      row.participantKind,
      row.memberUserId,
      row.entityId,
      row.participantName,
      row.role,
      row.now,
    );
}

// Participants are a replace-set, exactly as a matter event's are: who is at a meeting is one list
// a person edits, not a stream of additions and removals nobody would reconcile.
export function deleteFirmEventParticipantsStatement(
  database: SqlDatabase,
  firmEventId: FirmEventId,
): SqlStatement {
  return database
    .prepare(`DELETE FROM ${FIRM_EVENT_PARTICIPANT_TABLE} WHERE firm_event_id = ?1`)
    .bind(firmEventId);
}

export function selectFirmEventParticipantsStatement(
  database: SqlDatabase,
  firmEventId: FirmEventId,
): SqlStatement {
  return database
    .prepare(
      `SELECT id, firm_event_id, participant_kind, member_user_id, entity_id, participant_name, role ` +
        `FROM ${FIRM_EVENT_PARTICIPANT_TABLE} WHERE firm_event_id = ?1 ORDER BY id ASC`,
    )
    .bind(firmEventId);
}

export async function readFirmEventParticipants(
  database: SqlDatabase,
  firmEventId: FirmEventId,
): Promise<FirmEventParticipantRow[]> {
  const { results } = await selectFirmEventParticipantsStatement(
    database,
    firmEventId,
  ).all<FirmEventParticipantRow>();
  return results;
}
