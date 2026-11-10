import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type {
  MatterEventId,
  MatterEventParticipantId,
  MatterEventTypeId,
  MatterId,
  UserId,
} from "@magna-carta/identifiers/types";
import { MATTER_EVENT_TYPE_TABLE } from "./event-type-statements.ts";
import type { MatterEventParticipantKind, MatterEventStatus } from "./types.ts";
import type { VisibleMatterPredicate } from "./visibility.ts";

// Table names tracked against @magna-carta/database's per-firm schema by the schema-name-sync
// fitness test.
export const MATTER_EVENT_TABLE = "matter_event";
export const MATTER_EVENT_PARTICIPANT_TABLE = "matter_event_participant";

export interface MatterEventRow {
  readonly id: MatterEventId;
  readonly matter_id: MatterId;
  readonly event_type_id: MatterEventTypeId | null;
  readonly title: string;
  readonly description: string | null;
  readonly status: MatterEventStatus;
  // Why this setting is no longer happening, when it is not — set by the cancel and continuance
  // paths, null otherwise.
  readonly status_reason: string | null;
  readonly starts_on: string;
  readonly starts_at_time: string | null;
  readonly ends_on: string | null;
  readonly ends_at_time: string | null;
  readonly time_zone: string;
  readonly location_text: string | null;
  // Where an online setting is JOINED, which is a different fact from where it is held.
  readonly conference_url: string | null;
  readonly court_reference: string | null;
  /**
   * The RFC 5545 rule a repeating setting runs on ("FREQ=WEEKLY;BYDAY=TU;COUNT=12"), null on a
   * one-off. A repeating setting is ONE row: the reads expand it across the window they were asked
   * for, rather than a row per occurrence multiplying a firm's calendar by the length of its
   * longest series.
   */
  readonly recurrence_rule: string | null;
  /**
   * The series this row stands in for one day of, and which day: an EXCEPTION is a real event that
   * knows what it replaces, so a moved or cancelled occurrence is an ordinary row every read already
   * understands, and the series' expansion skips that day. Both null on a one-off and on a series.
   */
  readonly recurrence_parent_id: MatterEventId | null;
  readonly recurrence_occurrence_on: string | null;
  readonly recorded_at: string;
  readonly recorded_by: UserId | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface MatterEventParticipantRow {
  readonly id: MatterEventParticipantId;
  readonly event_id: MatterEventId;
  readonly participant_kind: MatterEventParticipantKind;
  readonly member_user_id: UserId | null;
  readonly entity_id: string | null;
  readonly participant_name: string | null;
  readonly role: string | null;
}

const EVENT_COLUMNS =
  "id, matter_id, event_type_id, title, description, status, status_reason, starts_on, starts_at_time, ends_on, " +
  "ends_at_time, time_zone, location_text, conference_url, court_reference, recurrence_rule, recorded_at, recorded_by, created_at, updated_at, " +
  "recurrence_parent_id, recurrence_occurrence_on";

/**
 * The same row with the event type's NAME beside its identifier. A display read answers "what kind
 * of setting is this" with a word a person recognizes; the identifier alone is a fact only the
 * database can use, and a screen handed one has nothing to render. Null covers both an event
 * classified under nothing and a type row that has since gone.
 */
export interface MatterEventDisplayRow extends MatterEventRow {
  readonly event_type_name: string | null;
}

// Every column qualified, because the display projection joins a table that also has `id`,
// `created_at`, and `updated_at`.
const EVENT_DISPLAY_COLUMNS =
  `${MATTER_EVENT_TABLE}.id, ${MATTER_EVENT_TABLE}.matter_id, ${MATTER_EVENT_TABLE}.event_type_id, ` +
  `${MATTER_EVENT_TABLE}.title, ${MATTER_EVENT_TABLE}.description, ${MATTER_EVENT_TABLE}.status, ` +
  `${MATTER_EVENT_TABLE}.status_reason, ${MATTER_EVENT_TABLE}.starts_on, ${MATTER_EVENT_TABLE}.starts_at_time, ` +
  `${MATTER_EVENT_TABLE}.ends_on, ${MATTER_EVENT_TABLE}.ends_at_time, ${MATTER_EVENT_TABLE}.time_zone, ` +
  `${MATTER_EVENT_TABLE}.location_text, ${MATTER_EVENT_TABLE}.conference_url, ` +
  `${MATTER_EVENT_TABLE}.court_reference, ${MATTER_EVENT_TABLE}.recurrence_rule, ` +
  `${MATTER_EVENT_TABLE}.recurrence_parent_id, ${MATTER_EVENT_TABLE}.recurrence_occurrence_on, ` +
  `${MATTER_EVENT_TABLE}.recorded_at, ` +
  `${MATTER_EVENT_TABLE}.recorded_by, ${MATTER_EVENT_TABLE}.created_at, ${MATTER_EVENT_TABLE}.updated_at, ` +
  `${MATTER_EVENT_TYPE_TABLE}.name AS event_type_name`;

// LEFT, never INNER: an event classified under nothing, or under a type row that has gone, is still
// an event on the matter and must not fall out of the list.
const EVENT_TYPE_JOIN = `LEFT JOIN ${MATTER_EVENT_TYPE_TABLE} ON ${MATTER_EVENT_TYPE_TABLE}.id = ${MATTER_EVENT_TABLE}.event_type_id`;

export interface InsertMatterEventInput {
  readonly id: MatterEventId;
  readonly matterId: MatterId;
  readonly eventTypeId: MatterEventTypeId | null;
  readonly title: string;
  readonly description: string | null;
  readonly status: MatterEventStatus;
  readonly startsOn: string;
  readonly startsAtTime: string | null;
  readonly endsOn: string | null;
  readonly endsAtTime: string | null;
  readonly timeZone: string;
  readonly locationText: string | null;
  readonly conferenceUrl: string | null;
  readonly courtReference: string | null;
  /** The RFC 5545 rule, or null for a setting that happens once. */
  readonly recurrenceRule: string | null;
  /** The series and the day this row replaces, where it is one occurrence written as an exception. */
  readonly recurrenceParentId?: MatterEventId | null;
  readonly recurrenceOccurrenceOn?: string | null;
  readonly recordedAt: string;
  readonly recordedBy: UserId | null;
  readonly now: string;
}

export function insertMatterEventStatement(
  database: SqlDatabase,
  input: InsertMatterEventInput,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${MATTER_EVENT_TABLE} (${EVENT_COLUMNS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?19, ?20, ?21)`,
    )
    .bind(
      input.id,
      input.matterId,
      input.eventTypeId,
      input.title,
      input.description,
      input.status,
      // A new setting starts with no status reason: the column belongs to cancellation and
      // continuance, which are the only paths that write it.
      null,
      input.startsOn,
      input.startsAtTime,
      input.endsOn,
      input.endsAtTime,
      input.timeZone,
      input.locationText,
      input.conferenceUrl,
      input.courtReference,
      input.recurrenceRule,
      input.recordedAt,
      input.recordedBy,
      input.now,
      input.recurrenceParentId ?? null,
      input.recurrenceOccurrenceOn ?? null,
    );
}

// A continued hearing is the same hearing on a new date, so it is an UPDATE and the audit row
// written in the same batch carries the change. A second row would put two hearings on the calendar
// and make every consumer responsible for hiding one of them.
export function updateMatterEventStatement(
  database: SqlDatabase,
  id: MatterEventId,
  patch: {
    readonly eventTypeId: MatterEventTypeId | null;
    readonly title: string;
    readonly description: string | null;
    readonly startsOn: string;
    readonly startsAtTime: string | null;
    readonly endsOn: string | null;
    readonly endsAtTime: string | null;
    readonly timeZone: string;
    readonly locationText: string | null;
    readonly conferenceUrl: string | null;
    readonly courtReference: string | null;
    readonly status: MatterEventStatus;
    /**
     * The rule, which a correction may change or clear. It is sent on every update because the
     * update contract replaces the record's editable fields wholesale; a caller that did not touch
     * it passes back what it read.
     */
    readonly recurrenceRule: string | null;
  },
  updatedAt: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MATTER_EVENT_TABLE} SET event_type_id = ?2, title = ?3, description = ?4, starts_on = ?5, ` +
        `starts_at_time = ?6, ends_on = ?7, ends_at_time = ?8, time_zone = ?9, location_text = ?10, ` +
        `conference_url = ?11, court_reference = ?12, status = ?13, recurrence_rule = ?14, ` +
        `updated_at = ?15 WHERE id = ?1`,
    )
    .bind(
      id,
      patch.eventTypeId,
      patch.title,
      patch.description,
      patch.startsOn,
      patch.startsAtTime,
      patch.endsOn,
      patch.endsAtTime,
      patch.timeZone,
      patch.locationText,
      patch.conferenceUrl,
      patch.courtReference,
      patch.status,
      patch.recurrenceRule,
      updatedAt,
    );
}

export function cancelMatterEventStatement(
  database: SqlDatabase,
  id: MatterEventId,
  updatedAt: string,
  statusReason: string | null = null,
): SqlStatement {
  // Cancelled, never deleted: a hearing that was taken off is a fact about the case, and a firm that
  // has to prove it was vacated cannot do so from a row that is gone. The reason is optional — an
  // outright cancellation does not always deserve a paragraph — and this statement touches ONLY the
  // status, its reason, and updated_at: the continuance path relies on every historical column of
  // the vacated setting staying byte-identical.
  return database
    .prepare(
      `UPDATE ${MATTER_EVENT_TABLE} SET status = 'cancelled', status_reason = ?3, updated_at = ?2 WHERE id = ?1`,
    )
    .bind(id, updatedAt, statusReason);
}

// The single-event read. It resolves by identifier, which is exactly why it takes the predicate: an
// event's title, description, court reference, and participant list are the most sensitive things
// this package holds, and "resolve by id" is the shape that quietly reads across a barrier.
export function selectMatterEventStatement(
  database: SqlDatabase,
  id: MatterEventId,
  visibility: VisibleMatterPredicate,
): SqlStatement {
  return database
    .prepare(
      `SELECT ${EVENT_COLUMNS} FROM ${MATTER_EVENT_TABLE} WHERE id = ? AND ` +
        visibility.fragmentFor(`${MATTER_EVENT_TABLE}.matter_id`),
    )
    .bind(id, ...visibility.bindings);
}

export async function readMatterEvent(
  database: SqlDatabase,
  id: MatterEventId,
  visibility: VisibleMatterPredicate,
): Promise<MatterEventRow | undefined> {
  const { results } = await selectMatterEventStatement(
    database,
    id,
    visibility,
  ).all<MatterEventRow>();
  return results[0];
}

// The matter's own event list — the read an edit surface makes, without the federation. Keyset over
// (starts_on, id) so it shares the timeline's cursor shape.
//
// The visible-matter predicate is REQUIRED here, exactly as it is on every timeline source, and for
// the same reason: an id-addressed read that skipped it is the read an information-barrier overlay
// would be built past. A source cannot decline the predicate, so neither can the direct reads beside
// them. `test/visibility-fitness.test.ts` proves every SELECT over this table carries it.
export function selectMatterEventsStatement(
  database: SqlDatabase,
  matterId: MatterId,
  options: {
    readonly cursor?: { sortKey: string; id: string };
    readonly limit: number;
    readonly visibility: VisibleMatterPredicate;
  },
): SqlStatement {
  const conditions = [`${MATTER_EVENT_TABLE}.matter_id = ?`];
  const bindings: unknown[] = [matterId];
  if (options.cursor !== undefined) {
    conditions.push(
      `(${MATTER_EVENT_TABLE}.starts_on < ? OR (${MATTER_EVENT_TABLE}.starts_on = ? AND ${MATTER_EVENT_TABLE}.id < ?))`,
    );
    bindings.push(options.cursor.sortKey, options.cursor.sortKey, options.cursor.id);
  }
  conditions.push(options.visibility.fragmentFor(`${MATTER_EVENT_TABLE}.matter_id`));
  bindings.push(...options.visibility.bindings);
  bindings.push(options.limit);
  return database
    .prepare(
      `SELECT ${EVENT_DISPLAY_COLUMNS} FROM ${MATTER_EVENT_TABLE} ${EVENT_TYPE_JOIN} ` +
        `WHERE ${conditions.join(" AND ")} ` +
        `ORDER BY ${MATTER_EVENT_TABLE}.starts_on DESC, ${MATTER_EVENT_TABLE}.id DESC LIMIT ?`,
    )
    .bind(...bindings);
}

// The single-event DISPLAY read, beside the lean one above rather than replacing it. The lifecycle
// services resolve an event to decide whether a change is allowed, and the type's name is not part
// of that decision; carrying a join through every one of those paths would widen six reads to serve
// one. This is the read a screen makes.
export function selectMatterEventDetailStatement(
  database: SqlDatabase,
  id: MatterEventId,
  visibility: VisibleMatterPredicate,
): SqlStatement {
  return database
    .prepare(
      `SELECT ${EVENT_DISPLAY_COLUMNS} FROM ${MATTER_EVENT_TABLE} ${EVENT_TYPE_JOIN} ` +
        `WHERE ${MATTER_EVENT_TABLE}.id = ? AND ` +
        visibility.fragmentFor(`${MATTER_EVENT_TABLE}.matter_id`),
    )
    .bind(id, ...visibility.bindings);
}

export async function readMatterEventDetail(
  database: SqlDatabase,
  id: MatterEventId,
  visibility: VisibleMatterPredicate,
): Promise<MatterEventDisplayRow | undefined> {
  const { results } = await selectMatterEventDetailStatement(
    database,
    id,
    visibility,
  ).all<MatterEventDisplayRow>();
  return results[0];
}

// The chain read's bulk resolve: the settings of one continuance chain by their identifiers, under
// the same predicate every read of this table carries. The projection is the chain node's shape —
// dates, status, and reason — and deliberately not the full row: the chain is procedural history,
// not an edit surface.
export function selectMatterEventChainNodesStatement(
  database: SqlDatabase,
  ids: readonly MatterEventId[],
  visibility: VisibleMatterPredicate,
): SqlStatement {
  const placeholders = ids.map(() => "?").join(", ");
  return database
    .prepare(
      `SELECT id, starts_on, starts_at_time, time_zone, status, status_reason FROM ${MATTER_EVENT_TABLE} ` +
        `WHERE id IN (${placeholders}) AND ` +
        visibility.fragmentFor(`${MATTER_EVENT_TABLE}.matter_id`),
    )
    .bind(...ids, ...visibility.bindings);
}

export function insertMatterEventParticipantStatement(
  database: SqlDatabase,
  row: {
    readonly id: MatterEventParticipantId;
    readonly eventId: MatterEventId;
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
      `INSERT INTO ${MATTER_EVENT_PARTICIPANT_TABLE} (id, event_id, participant_kind, member_user_id, entity_id, participant_name, role, created_at, updated_at) ` +
        `VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)`,
    )
    .bind(
      row.id,
      row.eventId,
      row.participantKind,
      row.memberUserId,
      row.entityId,
      row.participantName,
      row.role,
      row.now,
    );
}

// Participants are a replace-set: who was at a hearing is one list a person edits, not a stream of
// additions and removals nobody would reconcile.
export function deleteMatterEventParticipantsStatement(
  database: SqlDatabase,
  eventId: MatterEventId,
): SqlStatement {
  return database
    .prepare(`DELETE FROM ${MATTER_EVENT_PARTICIPANT_TABLE} WHERE event_id = ?1`)
    .bind(eventId);
}

export function selectMatterEventParticipantsStatement(
  database: SqlDatabase,
  eventId: MatterEventId,
): SqlStatement {
  return database
    .prepare(
      `SELECT id, event_id, participant_kind, member_user_id, entity_id, participant_name, role ` +
        `FROM ${MATTER_EVENT_PARTICIPANT_TABLE} WHERE event_id = ?1 ORDER BY id ASC`,
    )
    .bind(eventId);
}

export async function readMatterEventParticipants(
  database: SqlDatabase,
  eventId: MatterEventId,
): Promise<MatterEventParticipantRow[]> {
  const { results } = await selectMatterEventParticipantsStatement(
    database,
    eventId,
  ).all<MatterEventParticipantRow>();
  return results;
}
