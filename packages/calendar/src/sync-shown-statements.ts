import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { IntegrationConnectionId } from "@magna-carta/identifiers/types";
import { CALENDAR_SYNC_LINK_TABLE } from "./sync-link-statements.ts";

// Table names tracked against @magna-carta/database's per-firm schema by the schema-name-sync
// fitness test.
export const CALENDAR_SYNC_SHOWN_CALENDAR_TABLE = "calendar_sync_shown_calendar";
export const EXTERNAL_CALENDAR_EVENT_TABLE = "external_calendar_event";

// WHAT A MEMBER'S OWN CALENDAR HOLDS, SHOWN BACK TO THAT MEMBER AND TO NOBODY ELSE.
//
// Two tables keyed by the member's connection. The first is their choice: which of their account's
// calendars the firm's calendar shows them. The second is what a pass read from those calendars,
// one row per event as the provider holds it, a series as one row per day it falls on.
//
// Every read here is by connection, and a connection is found from the session member's own
// principal and from nothing a request names. That is the whole of who may read a row: there is no
// statement in this module that reads across connections.

export interface ShownCalendarRow {
  readonly calendar_remote_id: string;
  readonly calendar_name: string;
}

export function selectShownCalendarsStatement(
  database: SqlDatabase,
  connectionId: IntegrationConnectionId,
): SqlStatement {
  return database
    .prepare(
      `SELECT calendar_remote_id, calendar_name FROM ${CALENDAR_SYNC_SHOWN_CALENDAR_TABLE} WHERE connection_id = ?1 ORDER BY calendar_name, calendar_remote_id`,
    )
    .bind(connectionId);
}

// fitness:unguarded-write — a replace of the whole set, or a disconnect: zero rows means the member had chosen none
export function deleteShownCalendarsStatement(
  database: SqlDatabase,
  connectionId: IntegrationConnectionId,
): SqlStatement {
  return database
    .prepare(`DELETE FROM ${CALENDAR_SYNC_SHOWN_CALENDAR_TABLE} WHERE connection_id = ?1`)
    .bind(connectionId);
}

export function insertShownCalendarStatement(
  database: SqlDatabase,
  connectionId: IntegrationConnectionId,
  calendar: { readonly remoteId: string; readonly name: string },
  now: string,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${CALENDAR_SYNC_SHOWN_CALENDAR_TABLE} (connection_id, calendar_remote_id, calendar_name, created_at) VALUES (?1, ?2, ?3, ?4)`,
    )
    .bind(connectionId, calendar.remoteId, calendar.name, now);
}

// One event as a pass read it. A whole-day event is civil days with an inclusive last day. A timed
// one is two instants: the provider answers in its own zone and the reader's screen decides which
// day and hour that is for the person looking.
export type ExternalEventWhen =
  | { readonly kind: "days"; readonly startsOn: string; readonly endsOn: string }
  | { readonly kind: "instants"; readonly startsAt: string; readonly endsAt: string };

export interface ExternalEventWrite {
  readonly remoteEventId: string;
  readonly calendarRemoteId: string;
  readonly remoteVersionTag: string | null;
  readonly title: string;
  readonly location: string | null;
  readonly when: ExternalEventWhen;
}

export interface ExternalEventRow {
  readonly remote_event_id: string;
  readonly calendar_remote_id: string;
  readonly calendar_name: string | null;
  readonly title: string;
  readonly location_text: string | null;
  readonly whole_day: number;
  readonly starts_on: string | null;
  readonly ends_on: string | null;
  readonly starts_at: string | null;
  readonly ends_at: string | null;
}

export interface ExternalEventKnownRow {
  readonly remote_event_id: string;
  readonly calendar_remote_id: string;
  readonly remote_version_tag: string | null;
}

// What a pass already holds for one account: enough to tell which rows the provider has changed
// and which it no longer has, without reading a title.
export function selectKnownExternalEventsStatement(
  database: SqlDatabase,
  connectionId: IntegrationConnectionId,
): SqlStatement {
  return database
    .prepare(
      `SELECT remote_event_id, calendar_remote_id, remote_version_tag FROM ${EXTERNAL_CALENDAR_EVENT_TABLE} WHERE connection_id = ?1`,
    )
    .bind(connectionId);
}

export function upsertExternalEventStatement(
  database: SqlDatabase,
  connectionId: IntegrationConnectionId,
  event: ExternalEventWrite,
  now: string,
): SqlStatement {
  const days = event.when.kind === "days" ? event.when : null;
  const instants = event.when.kind === "instants" ? event.when : null;
  return database
    .prepare(
      `INSERT INTO ${EXTERNAL_CALENDAR_EVENT_TABLE} (connection_id, remote_event_id, calendar_remote_id, remote_version_tag, title, location_text, whole_day, starts_on, ends_on, starts_at, ends_at, read_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12) ON CONFLICT (connection_id, remote_event_id) DO UPDATE SET calendar_remote_id = excluded.calendar_remote_id, remote_version_tag = excluded.remote_version_tag, title = excluded.title, location_text = excluded.location_text, whole_day = excluded.whole_day, starts_on = excluded.starts_on, ends_on = excluded.ends_on, starts_at = excluded.starts_at, ends_at = excluded.ends_at, read_at = excluded.read_at`,
    )
    .bind(
      connectionId,
      event.remoteEventId,
      event.calendarRemoteId,
      event.remoteVersionTag,
      event.title,
      event.location,
      days === null ? 0 : 1,
      days?.startsOn ?? null,
      days?.endsOn ?? null,
      instants?.startsAt ?? null,
      instants?.endsAt ?? null,
      now,
    );
}

// An event the provider no longer lists in the calendar a pass read it from. The calendar is part
// of the match on purpose: an event moved to another shown calendar was written again under that
// calendar earlier in the same batch, and must not then be removed as missing from the first.
// fitness:unguarded-write — zero rows means the event moved to another calendar and was kept there
export function deleteExternalEventStatement(
  database: SqlDatabase,
  connectionId: IntegrationConnectionId,
  remoteEventId: string,
  calendarRemoteId: string,
): SqlStatement {
  return database
    .prepare(
      `DELETE FROM ${EXTERNAL_CALENDAR_EVENT_TABLE} WHERE connection_id = ?1 AND remote_event_id = ?2 AND calendar_remote_id = ?3`,
    )
    .bind(connectionId, remoteEventId, calendarRemoteId);
}

// Everything read from a calendar the member no longer chooses to be shown. Run in the batch that
// replaces their choice, so what they turned off is gone when the save answers, and again by each
// pass, so a row a dying pass wrote after the save does not stay.
// fitness:unguarded-write — a sweep: zero rows means nothing was left over
export function deleteExternalEventsNotShownStatement(
  database: SqlDatabase,
  connectionId: IntegrationConnectionId,
): SqlStatement {
  return database
    .prepare(
      `DELETE FROM ${EXTERNAL_CALENDAR_EVENT_TABLE} WHERE connection_id = ?1 AND calendar_remote_id NOT IN (SELECT shown.calendar_remote_id FROM ${CALENDAR_SYNC_SHOWN_CALENDAR_TABLE} AS shown WHERE shown.connection_id = ?1)`,
    )
    .bind(connectionId);
}

// fitness:unguarded-write — a disconnect removes whatever is there; zero rows means nothing had been read
export function deleteExternalEventsStatement(
  database: SqlDatabase,
  connectionId: IntegrationConnectionId,
): SqlStatement {
  return database
    .prepare(`DELETE FROM ${EXTERNAL_CALENDAR_EVENT_TABLE} WHERE connection_id = ?1`)
    .bind(connectionId);
}

export interface ExternalEventWindow {
  readonly from: string; // YYYY-MM-DD, inclusive
  readonly to: string; // YYYY-MM-DD, inclusive
  // The same window as instants, widened by the caller far enough that an event on the window's
  // first or last day in any zone is inside it.
  readonly fromInstant: string;
  readonly toInstant: string;
}

// One account's events that touch a window, earliest first. `limit` is one more than the caller
// will show, so it can say there were more.
export function selectExternalEventsStatement(
  database: SqlDatabase,
  connectionId: IntegrationConnectionId,
  window: ExternalEventWindow,
  limit: number,
): SqlStatement {
  return database
    .prepare(
      `SELECT event.remote_event_id AS remote_event_id, event.calendar_remote_id AS calendar_remote_id, (SELECT shown.calendar_name FROM ${CALENDAR_SYNC_SHOWN_CALENDAR_TABLE} AS shown WHERE shown.connection_id = event.connection_id AND shown.calendar_remote_id = event.calendar_remote_id) AS calendar_name, event.title AS title, event.location_text AS location_text, event.whole_day AS whole_day, event.starts_on AS starts_on, event.ends_on AS ends_on, event.starts_at AS starts_at, event.ends_at AS ends_at FROM ${EXTERNAL_CALENDAR_EVENT_TABLE} AS event WHERE event.connection_id = ?1 AND ((event.whole_day = 1 AND event.starts_on <= ?3 AND event.ends_on >= ?2) OR (event.whole_day = 0 AND event.starts_at < ?5 AND event.ends_at >= ?4)) ORDER BY COALESCE(event.starts_at, event.starts_on), event.remote_event_id LIMIT ?6`,
    )
    .bind(connectionId, window.from, window.to, window.fromInstant, window.toInstant, limit);
}

// The provider's identifiers of the copies this platform wrote into the account. A pass leaves
// those out of what it reads back: they are already in the firm's calendar as the events they are
// copies of.
export function selectWrittenRemoteEventIdsStatement(
  database: SqlDatabase,
  connectionId: IntegrationConnectionId,
): SqlStatement {
  return database
    .prepare(
      `SELECT remote_event_id FROM ${CALENDAR_SYNC_LINK_TABLE} WHERE connection_id = ?1 AND remote_event_id IS NOT NULL`,
    )
    .bind(connectionId);
}
