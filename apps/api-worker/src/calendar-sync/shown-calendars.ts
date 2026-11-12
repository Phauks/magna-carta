import type { CalendarSyncPort, ProviderCalendarEvent } from "@magna-carta/calendar/sync-port";
import {
  deleteExternalEventStatement,
  deleteExternalEventsNotShownStatement,
  selectKnownExternalEventsStatement,
  selectShownCalendarsStatement,
  selectWrittenRemoteEventIdsStatement,
  upsertExternalEventStatement,
  type ExternalEventKnownRow,
  type ExternalEventWrite,
  type ShownCalendarRow,
} from "@magna-carta/calendar/sync-shown-statements";
import { addCalendarDays, civilDateOf } from "@magna-carta/civil-time/civil-date";
import { commitEffectBatch, type BatchDatabase } from "@magna-carta/data-access/effect-batch";
import type { SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { IntegrationConnectionId } from "@magna-carta/identifiers/types";

// THE MEMBER'S OWN EVENTS, READ FROM THE CALENDARS THEY CHOSE TO BE SHOWN.
//
// The other direction from everything else a pass does. A member names which of their account's
// calendars the firm's calendar should show them, and this reads those calendars over a window and
// makes the firm's private table agree: a new event is written, a changed one written again, one
// the provider no longer lists is removed. Only the member ever reads the table
// (@magna-carta/calendar/sync-shown-statements), and nothing here changes anything at the provider.
//
// A copy this platform wrote is left out. It is in the firm's calendar already, as the event it is
// a copy of, and reading it back would show the member every synced hearing twice.
//
// Like the pass out, this is a reconciliation and not a replay: it is handed nothing about what
// changed and asks the provider what is there. A notice from the provider only brings it forward.

// A month back keeps last week readable; a year ahead is as far as a member plans their own
// calendar in the firm's. A series is read as one event per day it falls on, so the window is
// also what bounds a daily series that never ends.
const SHOWN_DAYS_BACK = 31;
const SHOWN_DAYS_AHEAD = 366;

// One batch is one transaction inside one invocation. A first read of a busy calendar is a few
// hundred rows; this keeps each transaction small and lets a pass that dies partway keep what it
// had written.
const STATEMENTS_PER_BATCH = 100;

export type ShownCalendarsOutcome =
  // The table agrees with the provider, as far as the provider answered in full.
  | { readonly kind: "read"; readonly written: number; readonly removed: number }
  // The provider could not be reached, or asked for patience. What was read before stays.
  | { readonly kind: "unavailable" }
  | { readonly kind: "sign-in-again" };

export interface ShownCalendarsInput {
  readonly database: BatchDatabase;
  readonly connectionId: IntegrationConnectionId;
  readonly port: CalendarSyncPort;
  readonly now: () => Date;
}

function writeOf(event: ProviderCalendarEvent, calendarRemoteId: string): ExternalEventWrite {
  return {
    remoteEventId: event.remoteId,
    calendarRemoteId,
    remoteVersionTag: event.versionTag,
    title: event.title,
    location: event.location,
    when:
      event.when.kind === "days"
        ? event.when
        : {
            kind: "instants",
            startsAt: new Date(event.when.startsAtMilliseconds).toISOString(),
            endsAt: new Date(event.when.endsAtMilliseconds).toISOString(),
          },
  };
}

export async function readShownCalendars(
  input: ShownCalendarsInput,
): Promise<ShownCalendarsOutcome> {
  const { database, connectionId, port } = input;
  const instant = input.now();
  const now = instant.toISOString();
  const [shown, known, written] = await Promise.all([
    selectShownCalendarsStatement(database, connectionId).all<ShownCalendarRow>(),
    selectKnownExternalEventsStatement(database, connectionId).all<ExternalEventKnownRow>(),
    selectWrittenRemoteEventIdsStatement(database, connectionId).all<{
      remote_event_id: string;
    }>(),
  ]);
  // A member who shows nothing costs the provider no request, and anything left over from a
  // choice they have since taken back goes.
  if (shown.results.length === 0) {
    if (known.results.length === 0) return { kind: "read", written: 0, removed: 0 };
    await deleteExternalEventsNotShownStatement(database, connectionId).run();
    return { kind: "read", written: 0, removed: known.results.length };
  }

  const writtenIds = new Set(written.results.map((row) => row.remote_event_id));
  const knownById = new Map(known.results.map((row) => [row.remote_event_id, row]));
  const today = civilDateOf(instant);
  const window = {
    fromInstant: `${addCalendarDays(today, -SHOWN_DAYS_BACK)}T00:00:00Z`,
    toInstant: `${addCalendarDays(today, SHOWN_DAYS_AHEAD)}T00:00:00Z`,
  };

  const statements: SqlStatement[] = [
    deleteExternalEventsNotShownStatement(database, connectionId),
  ];
  let writes = 0;
  let removals = 0;
  for (const calendar of shown.results) {
    const listed = await port.listCalendarEvents(calendar.calendar_remote_id, window);
    if (!listed.ok) {
      return { kind: listed.problem?.category === "auth" ? "sign-in-again" : "unavailable" };
    }
    // The account no longer has the calendar. Its events go; the choice stays, so the settings
    // page can still name what was chosen until the member changes it.
    const events = listed.value === null ? [] : listed.value.events;
    const complete = listed.value === null || listed.value.complete;
    const listedIds = new Set<string>();
    for (const event of events) {
      // A copy of the firm's own event: a single one by its identifier, a day of a series by the
      // series it belongs to.
      if (writtenIds.has(event.remoteId)) continue;
      if (event.seriesRemoteId !== null && writtenIds.has(event.seriesRemoteId)) continue;
      listedIds.add(event.remoteId);
      const before = knownById.get(event.remoteId);
      const unchanged =
        before !== undefined &&
        before.calendar_remote_id === calendar.calendar_remote_id &&
        before.remote_version_tag !== null &&
        before.remote_version_tag === event.versionTag;
      if (unchanged) continue;
      statements.push(
        upsertExternalEventStatement(
          database,
          connectionId,
          writeOf(event, calendar.calendar_remote_id),
          now,
        ),
      );
      writes += 1;
    }
    // A list the provider cut short proves nothing about what is missing from it.
    if (!complete) continue;
    for (const row of known.results) {
      if (row.calendar_remote_id !== calendar.calendar_remote_id) continue;
      if (listedIds.has(row.remote_event_id)) continue;
      statements.push(
        deleteExternalEventStatement(
          database,
          connectionId,
          row.remote_event_id,
          calendar.calendar_remote_id,
        ),
      );
      removals += 1;
    }
  }

  const clock = { now: () => now };
  for (let start = 0; start < statements.length; start += STATEMENTS_PER_BATCH) {
    await commitEffectBatch(
      database,
      { statements: statements.slice(start, start + STATEMENTS_PER_BATCH), outboxMessages: [] },
      clock,
    );
  }
  return { kind: "read", written: writes, removed: removals };
}
