import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type {
  CalendarEventLinkId,
  FirmEventId,
  MatterEventId,
  UserId,
} from "@magna-carta/identifiers/types";
import type { CalendarEventLinkKind } from "./types.ts";

// Typed relations between events. The table is the calendar linking to itself, so the ends are real
// foreign keys — and the continuance chain is held to a chain by the two partial unique indexes in
// the migration (at most one predecessor and at most one successor per setting), which is the
// schema refusing a fork rather than a service invariant somebody forgets under concurrency.

export const CALENDAR_EVENT_LINK_TABLE = "calendar_event_link";

// One end of a link: a matter event or a firm event, exactly one.
export type LinkEnd =
  | { readonly matterEventId: MatterEventId }
  | { readonly firmEventId: FirmEventId };

export interface CalendarEventLinkRow {
  readonly id: CalendarEventLinkId;
  readonly from_matter_event_id: MatterEventId | null;
  readonly from_firm_event_id: FirmEventId | null;
  readonly to_matter_event_id: MatterEventId | null;
  readonly to_firm_event_id: FirmEventId | null;
  readonly kind: CalendarEventLinkKind;
  readonly note: string | null;
  readonly recorded_by: UserId | null;
  readonly created_at: string;
}

const LINK_COLUMNS =
  "id, from_matter_event_id, from_firm_event_id, to_matter_event_id, to_firm_event_id, kind, note, recorded_by, created_at";

function endColumns(end: LinkEnd): { matter: MatterEventId | null; firm: FirmEventId | null } {
  return "matterEventId" in end
    ? { matter: end.matterEventId, firm: null }
    : { matter: null, firm: end.firmEventId };
}

export function insertCalendarEventLinkStatement(
  database: SqlDatabase,
  input: {
    readonly id: CalendarEventLinkId;
    readonly from: LinkEnd;
    readonly to: LinkEnd;
    readonly kind: CalendarEventLinkKind;
    readonly note: string | null;
    readonly recordedBy: UserId | null;
    readonly now: string;
  },
): SqlStatement {
  const from = endColumns(input.from);
  const to = endColumns(input.to);
  return database
    .prepare(
      `INSERT INTO ${CALENDAR_EVENT_LINK_TABLE} (${LINK_COLUMNS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
    )
    .bind(
      input.id,
      from.matter,
      from.firm,
      to.matter,
      to.firm,
      input.kind,
      input.note,
      input.recordedBy,
      input.now,
    );
}

export function deleteCalendarEventLinkStatement(
  database: SqlDatabase,
  id: CalendarEventLinkId,
): SqlStatement {
  return database.prepare(`DELETE FROM ${CALENDAR_EVENT_LINK_TABLE} WHERE id = ?1`).bind(id);
}

export function selectCalendarEventLinkStatement(
  database: SqlDatabase,
  id: CalendarEventLinkId,
): SqlStatement {
  return database
    .prepare(`SELECT ${LINK_COLUMNS} FROM ${CALENDAR_EVENT_LINK_TABLE} WHERE id = ?1`)
    .bind(id);
}

export async function readCalendarEventLink(
  database: SqlDatabase,
  id: CalendarEventLinkId,
): Promise<CalendarEventLinkRow | undefined> {
  const { results } = await selectCalendarEventLinkStatement(
    database,
    id,
  ).all<CalendarEventLinkRow>();
  return results[0];
}

// Every link touching one event, from either side — the event card's list, bounded by the links one
// event realistically carries; the LIMIT is a backstop.
export function selectLinksTouchingEventStatement(
  database: SqlDatabase,
  end: LinkEnd,
  limit: number,
): SqlStatement {
  const columns = endColumns(end);
  const column = columns.matter !== null ? "matter_event_id" : "firm_event_id";
  const id = columns.matter ?? columns.firm;
  return database
    .prepare(
      `SELECT ${LINK_COLUMNS} FROM ${CALENDAR_EVENT_LINK_TABLE} ` +
        `WHERE from_${column} = ?1 OR to_${column} = ?1 ORDER BY created_at ASC, id ASC LIMIT ?2`,
    )
    .bind(id, limit);
}

export async function readLinksTouchingEvent(
  database: SqlDatabase,
  end: LinkEnd,
  limit = 200,
): Promise<CalendarEventLinkRow[]> {
  const { results } = await selectLinksTouchingEventStatement(
    database,
    end,
    limit,
  ).all<CalendarEventLinkRow>();
  return results;
}

// The continuance chain's two directional lookups, each one indexed read on a partial-unique
// column: the setting this one continued (this event as the FROM end), and the setting that
// continued this one (this event as the TO end).
export function selectContinuancePredecessorStatement(
  database: SqlDatabase,
  matterEventId: MatterEventId,
): SqlStatement {
  return database
    .prepare(
      `SELECT ${LINK_COLUMNS} FROM ${CALENDAR_EVENT_LINK_TABLE} ` +
        `WHERE from_matter_event_id = ?1 AND kind = 'continuance_of'`,
    )
    .bind(matterEventId);
}

export function selectContinuanceSuccessorStatement(
  database: SqlDatabase,
  matterEventId: MatterEventId,
): SqlStatement {
  return database
    .prepare(
      `SELECT ${LINK_COLUMNS} FROM ${CALENDAR_EVENT_LINK_TABLE} ` +
        `WHERE to_matter_event_id = ?1 AND kind = 'continuance_of'`,
    )
    .bind(matterEventId);
}

export async function readContinuancePredecessorLink(
  database: SqlDatabase,
  matterEventId: MatterEventId,
): Promise<CalendarEventLinkRow | undefined> {
  const { results } = await selectContinuancePredecessorStatement(
    database,
    matterEventId,
  ).all<CalendarEventLinkRow>();
  return results[0];
}

export async function readContinuanceSuccessorLink(
  database: SqlDatabase,
  matterEventId: MatterEventId,
): Promise<CalendarEventLinkRow | undefined> {
  const { results } = await selectContinuanceSuccessorStatement(
    database,
    matterEventId,
  ).all<CalendarEventLinkRow>();
  return results[0];
}

// The continuance neighbors for one PAGE of events, resolved in one bounded query rather than one
// per row — what lets an event list badge "continued from Mar 14" without a chain walk.
export function selectContinuanceLinksForEventsStatement(
  database: SqlDatabase,
  matterEventIds: readonly MatterEventId[],
): SqlStatement {
  const placeholders = matterEventIds.map(() => "?").join(", ");
  return database
    .prepare(
      `SELECT ${LINK_COLUMNS} FROM ${CALENDAR_EVENT_LINK_TABLE} ` +
        `WHERE kind = 'continuance_of' AND (from_matter_event_id IN (${placeholders}) OR to_matter_event_id IN (${placeholders}))`,
    )
    .bind(...matterEventIds, ...matterEventIds);
}

export async function readContinuanceLinksForEvents(
  database: SqlDatabase,
  matterEventIds: readonly MatterEventId[],
): Promise<CalendarEventLinkRow[]> {
  if (matterEventIds.length === 0) return [];
  const { results } = await selectContinuanceLinksForEventsStatement(
    database,
    matterEventIds,
  ).all<CalendarEventLinkRow>();
  return results;
}

// The duplicate-pair probe for related links, checked in BOTH directions: 'related' is undirected
// in meaning though stored directed, so A-to-B and B-to-A are the same fact twice.
export function selectRelatedLinkBetweenStatement(
  database: SqlDatabase,
  first: LinkEnd,
  second: LinkEnd,
): SqlStatement {
  const a = endColumns(first);
  const b = endColumns(second);
  return database
    .prepare(
      `SELECT ${LINK_COLUMNS} FROM ${CALENDAR_EVENT_LINK_TABLE} WHERE kind = 'related' AND (` +
        `(COALESCE(from_matter_event_id, from_firm_event_id) = ?1 AND COALESCE(to_matter_event_id, to_firm_event_id) = ?2) OR ` +
        `(COALESCE(from_matter_event_id, from_firm_event_id) = ?2 AND COALESCE(to_matter_event_id, to_firm_event_id) = ?1))`,
    )
    .bind(a.matter ?? a.firm, b.matter ?? b.firm);
}

export async function readRelatedLinkBetween(
  database: SqlDatabase,
  first: LinkEnd,
  second: LinkEnd,
): Promise<CalendarEventLinkRow | undefined> {
  const { results } = await selectRelatedLinkBetweenStatement(
    database,
    first,
    second,
  ).all<CalendarEventLinkRow>();
  return results[0];
}
