/*
 * One of the reader's own Outlook or Google events, put on a matter.
 *
 * The reader presses their own event and its window asks two things: which matter, and what kind
 * of event it is. Everything else is the event as they already wrote it. Saving records an
 * ordinary event on the matter, seen by everyone who can see the matter, and names the event in
 * their own calendar as the one it was made from, so the server keeps that one as the synced copy
 * and they never see two.
 *
 * THE HOURS ARE THE READER'S. Their own event arrives as two instants with no zone, and the grid
 * already draws it at the reader's hour (`entryFromOwnAccountEvent`). The event recorded from it
 * is given that same day and hour in the reader's zone, because that is the hour they are looking
 * at when they press it.
 *
 * THE READER IS ON THE EVENT. It was in their calendar, so they are named on it, which is also
 * what keeps it there: the event stays in step with their own calendar while they take part in it.
 */
import { zonedReading } from "@magna-carta/civil-time/time-zone";
import { formatCivilDateLong, parseCivilDate } from "@magna-carta/design-system/calendar-grid";
import { formatWallClock, type CreateEventRequest } from "./calendar-api.ts";
import type { OwnAccountEvent } from "./own-account-events.ts";
import { shortfall, type Shortfall } from "./shortfall.ts";

export interface OwnEventOnMatterDraft {
  matterId: string | null;
  eventTypeId: string | null;
}

/** What the event recorded from an own event carries, beside the ordinary create request. */
export interface OwnEventOnMatterRequest extends CreateEventRequest {
  fromAccountEvent: { provider: OwnAccountEvent["provider"]; id: string };
}

const PROVIDER_CALENDAR_NAME: Record<OwnAccountEvent["provider"], string> = {
  microsoft: "My Outlook Calendar",
  google: "My Google Calendar",
};

/** Where the event is from, in the rail's own name for that calendar. */
export function ownEventSource(event: OwnAccountEvent): string {
  return `${PROVIDER_CALENDAR_NAME[event.provider]}. Only you see this.`;
}

interface OwnEventTiming {
  readonly startsOn: string;
  readonly startsAtTime: string | null;
  readonly endsOn: string | null;
  readonly endsAtTime: string | null;
}

/** The event's days and hours as the reader's screen places them, or null where it carries none. */
export function ownEventTiming(
  event: OwnAccountEvent,
  readerTimeZone: string,
): OwnEventTiming | null {
  if (event.wholeDay) {
    if (event.startsOn === null) return null;
    return {
      startsOn: event.startsOn,
      startsAtTime: null,
      endsOn: event.endsOn !== null && event.endsOn !== event.startsOn ? event.endsOn : null,
      endsAtTime: null,
    };
  }
  const startsAt = event.startsAt === null ? Number.NaN : Date.parse(event.startsAt);
  const endsAt = event.endsAt === null ? Number.NaN : Date.parse(event.endsAt);
  if (Number.isNaN(startsAt) || Number.isNaN(endsAt)) return null;
  const start = zonedReading(startsAt, readerTimeZone);
  const end = zonedReading(endsAt, readerTimeZone);
  return {
    startsOn: start.civilDate,
    startsAtTime: start.wallClockTime,
    endsOn: end.civilDate === start.civilDate ? null : end.civilDate,
    endsAtTime: end.wallClockTime,
  };
}

/** When the event is, as one line: "Thursday, December 3, 2026, 11:00 AM to 11:30 AM". */
export function ownEventWhen(event: OwnAccountEvent, readerTimeZone: string): string {
  const timing = ownEventTiming(event, readerTimeZone);
  if (timing === null) return "";
  const day = (civilDate: string): string => formatCivilDateLong(parseCivilDate(civilDate));
  const clock = (time: string | null, on: string): string =>
    formatWallClock(time, readerTimeZone, readerTimeZone, on) ?? "";
  const lastDay = timing.endsOn ?? timing.startsOn;
  if (timing.startsAtTime === null) {
    return lastDay === timing.startsOn
      ? day(timing.startsOn)
      : `${day(timing.startsOn)} to ${day(lastDay)}`;
  }
  const from = `${day(timing.startsOn)}, ${clock(timing.startsAtTime, timing.startsOn)}`;
  if (timing.endsAtTime === null || timing.endsAtTime === timing.startsAtTime) return from;
  return lastDay === timing.startsOn
    ? `${from} to ${clock(timing.endsAtTime, lastDay)}`
    : `${from} to ${day(lastDay)}, ${clock(timing.endsAtTime, lastDay)}`;
}

/** What still has to be answered before the event can go on a matter. */
export function ownEventShortfalls(draft: OwnEventOnMatterDraft): Shortfall[] {
  const shortfalls: Shortfall[] = [];
  if (draft.matterId === null) shortfalls.push(shortfall("matter", "Choose a matter."));
  if (draft.eventTypeId === null) shortfalls.push(shortfall("type", "Choose a type."));
  return shortfalls;
}

/** The create request for the matter event, or null while something is unanswered. */
export function ownEventOnMatterRequest(
  event: OwnAccountEvent,
  draft: OwnEventOnMatterDraft,
  reader: { readonly timeZone: string; readonly memberUserId: string | null },
): OwnEventOnMatterRequest | null {
  if (draft.matterId === null || draft.eventTypeId === null) return null;
  // A runtime that cannot name the reader's zone places the event where the grid drew it.
  const timeZone = reader.timeZone === "" ? "UTC" : reader.timeZone;
  const timing = ownEventTiming(event, timeZone);
  if (timing === null) return null;
  const title = event.title.trim();
  return {
    eventTypeId: draft.eventTypeId,
    title: title === "" ? "Untitled event" : title,
    ...timing,
    timeZone,
    locationText: event.location,
    participants:
      reader.memberUserId === null
        ? []
        : [{ participantKind: "member", memberUserId: reader.memberUserId }],
    fromAccountEvent: { provider: event.provider, id: event.id },
  };
}
