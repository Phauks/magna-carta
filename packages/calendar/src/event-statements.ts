import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type {
  MatterEventId,
  MatterEventParticipantId,
  MatterEventTypeId,
  MatterId,
  UserId,
} from "@magna-carta/identifiers/types";
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
  readonly court_reference: string | null;
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
  "ends_at_time, time_zone, location_text, court_reference, recorded_at, recorded_by, created_at, updated_at";

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
  readonly courtReference: string | null;
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
      `INSERT INTO ${MATTER_EVENT_TABLE} (${EVENT_COLUMNS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?17)`,
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
      input.courtReference,
      input.recordedAt,
      input.recordedBy,
      input.now,
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
    readonly courtReference: string | null;
    readonly status: MatterEventStatus;
  },
  updatedAt: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MATTER_EVENT_TABLE} SET event_type_id = ?2, title = ?3, description = ?4, starts_on = ?5, ` +
        `starts_at_time = ?6, ends_on = ?7, ends_at_time = ?8, time_zone = ?9, location_text = ?10, ` +
        `court_reference = ?11, status = ?12, updated_at = ?13 WHERE id = ?1`,
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
      patch.courtReference,
      patch.status,
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
  const conditions = ["matter_id = ?"];
  const bindings: unknown[] = [matterId];
  if (options.cursor !== undefined) {
    conditions.push("(starts_on < ? OR (starts_on = ? AND id < ?))");
    bindings.push(options.cursor.sortKey, options.cursor.sortKey, options.cursor.id);
  }
  conditions.push(options.visibility.fragmentFor(`${MATTER_EVENT_TABLE}.matter_id`));
  bindings.push(...options.visibility.bindings);
  bindings.push(options.limit);
  return database
    .prepare(
      `SELECT ${EVENT_COLUMNS} FROM ${MATTER_EVENT_TABLE} WHERE ${conditions.join(" AND ")} ` +
        `ORDER BY starts_on DESC, id DESC LIMIT ?`,
    )
    .bind(...bindings);
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
