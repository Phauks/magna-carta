import { domainAuditStatement } from "@magna-carta/data-access/audit-statements";
import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import type { IntegrationConnectionId } from "@magna-carta/identifiers/types";
import type { ProviderCalendar } from "./sync-port.ts";
import { SyncRuleRefusal, type SyncServiceOptions } from "./sync-rule-service.ts";
import {
  deleteExternalEventsNotShownStatement,
  deleteShownCalendarsStatement,
  insertShownCalendarStatement,
  selectExternalEventsStatement,
  selectShownCalendarsStatement,
  type ExternalEventRow,
  type ExternalEventWindow,
  type ShownCalendarRow,
} from "./sync-shown-statements.ts";

// WHICH OF A MEMBER'S OWN CALENDARS THE FIRM'S CALENDAR SHOWS THEM, AND WHAT IS IN THEM.
//
// The member's choice and nobody else's: the firm's limits are about what leaves, and nothing
// leaves here. A calendar they can only read is as good a choice as one they can write to. What is
// read from a chosen calendar is shown to that member alone, so every function here takes their
// connection and there is none that takes anybody else's.

export interface ShownCalendar {
  readonly calendarRemoteId: string;
  readonly calendarName: string;
}

export async function readShownCalendars(
  database: SqlDatabase,
  connectionId: IntegrationConnectionId,
): Promise<ShownCalendar[]> {
  const { results } = await selectShownCalendarsStatement(
    database,
    connectionId,
  ).all<ShownCalendarRow>();
  return results.map((row) => ({
    calendarRemoteId: row.calendar_remote_id,
    calendarName: row.calendar_name,
  }));
}

// Replaces the member's whole choice. Each calendar is checked against the account's calendars as
// they stand and takes its name from there. What was read from a calendar no longer chosen is
// removed in the same batch, so turning one off takes its events off the member's screen at once
// and not at the next pass.
export function replaceShownCalendars(
  database: SqlDatabase,
  connectionId: IntegrationConnectionId,
  calendarRemoteIds: readonly string[],
  calendars: readonly ProviderCalendar[],
  options: SyncServiceOptions,
): { effect: EffectWrite } {
  const calendarById = new Map(calendars.map((calendar) => [calendar.remoteId, calendar]));
  const now = options.clock.now();
  const chosen = new Map<string, ProviderCalendar>();
  for (const remoteId of calendarRemoteIds) {
    const calendar = calendarById.get(remoteId);
    if (calendar === undefined) {
      throw new SyncRuleRefusal(
        "calendar-sync-unknown-calendar",
        remoteId,
        "the connected account has no such calendar",
      );
    }
    // The same calendar twice means it once.
    chosen.set(remoteId, calendar);
  }
  return {
    effect: {
      statements: [
        deleteShownCalendarsStatement(database, connectionId),
        ...[...chosen.values()].map((calendar) =>
          insertShownCalendarStatement(database, connectionId, calendar, now),
        ),
        deleteExternalEventsNotShownStatement(database, connectionId),
        domainAuditStatement(database, {
          event: "calendar_sync.shown_calendars_replaced",
          subjectId: connectionId,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
          // How many, and never which: a calendar's name is the member's own.
          metadata: { count: chosen.size },
        }),
      ],
      outboxMessages: [],
    },
  };
}

export interface ExternalEvent {
  readonly remoteEventId: string;
  readonly calendarRemoteId: string;
  readonly calendarName: string | null;
  readonly title: string;
  readonly location: string | null;
  readonly wholeDay: boolean;
  readonly startsOn: string | null;
  readonly endsOn: string | null;
  readonly startsAt: string | null;
  readonly endsAt: string | null;
}

// The most events one read answers with. A month of one person's own calendar is far below it.
export const EXTERNAL_EVENT_READ_LIMIT = 1000;

// The member's own events that touch a window, earliest first.
export async function readExternalEvents(
  database: SqlDatabase,
  connectionId: IntegrationConnectionId,
  window: ExternalEventWindow,
): Promise<{ events: ExternalEvent[]; truncated: boolean }> {
  const { results } = await selectExternalEventsStatement(
    database,
    connectionId,
    window,
    EXTERNAL_EVENT_READ_LIMIT + 1,
  ).all<ExternalEventRow>();
  return {
    events: results.slice(0, EXTERNAL_EVENT_READ_LIMIT).map((row) => ({
      remoteEventId: row.remote_event_id,
      calendarRemoteId: row.calendar_remote_id,
      calendarName: row.calendar_name,
      title: row.title,
      location: row.location_text,
      wholeDay: row.whole_day === 1,
      startsOn: row.starts_on,
      endsOn: row.ends_on,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
    })),
    truncated: results.length > EXTERNAL_EVENT_READ_LIMIT,
  };
}
