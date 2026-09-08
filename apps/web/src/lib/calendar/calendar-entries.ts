/*
 * From the calendar's four record shapes to the one entry the grid paints.
 *
 * The grid is domain-free: it takes an entry with a day, a label, a detail line, a time, a tone and
 * a strike, and never learns whether it was a hearing. This module is where that knowledge lives,
 * once, for every surface that embeds the calendar.
 *
 * The identifier composes the kind with the record's own id, because a matter event and a firm
 * event could in principle share a row id shape and a render key must be unique across the whole
 * window. The controller keeps the entries it painted by that key, so an activation from the grid
 * comes back to the record it came from.
 */
import { civilDayOf } from "@magna-carta/civil-time/civil-date";
import type { CalendarGridEntry } from "@magna-carta/design-system/calendar-grid";
import {
  deadlineTone,
  firmEventAudienceLabel,
  formatWallClock,
  type CalendarDeadline,
  type CalendarEvent,
  type EventType,
  type FirmEvent,
  type ResourceAvailabilityEntry,
  type TimelineEntry,
} from "./calendar-api.ts";
import { isMatterScope, type CalendarScope } from "./calendar-scope.ts";
import {
  eventTypeNameForCode,
  eventTypeTone,
  layeredKindLabel,
  UNCLASSIFIED_EVENT_LABEL,
  UNCLASSIFIED_FIRM_EVENT_LABEL,
} from "./calendar-vocabulary.ts";

export type CalendarEntryKind = "event" | "deadline" | "firmEvent" | "other";

/** A grid entry that still remembers what it is, so the window that opens on it knows what to read. */
export interface CalendarEntry extends CalendarGridEntry {
  readonly kind: CalendarEntryKind;
  /** The record's own identifier, without the kind prefix. */
  readonly recordId: string;
  readonly matterId: string | null;
  /** The federated read's own deep link, where the entry came from it. */
  readonly link: string | null;
  /**
   * True for an entry whose record is no longer coming: a cancelled setting, a satisfied, vacated
   * or superseded deadline. Painted by default (struck where it was called off), and what the
   * agenda's "hide settled" filter narrows out of "what is coming".
   */
  readonly settled: boolean;
}

/** What the projection needs to know beyond the row: the names identifiers resolve to. */
export interface EntryContext {
  /** Matter id to the number a person quotes; a matter that resolves to nothing paints without one. */
  readonly matterNumbers: ReadonlyMap<string, string>;
  /** The type catalog by upper-cased code, for the federated read's labels. */
  readonly eventTypesByCode: ReadonlyMap<string, EventType>;
  /** The reader's zone, so a wall-clock time shows its zone only where it differs. */
  readonly readerTimeZone: string;
}

export function entryId(kind: CalendarEntryKind, recordId: string): string {
  return `${kind}:${recordId}`;
}

function matterLine(matterId: string | null, context: EntryContext): string | undefined {
  if (matterId === null) return undefined;
  return context.matterNumbers.get(matterId);
}

/**
 * A row of the federated read. A matter event paints its type's name; a deadline is skipped,
 * because the deadlines read carries its title and paints it instead; a firm event is skipped for
 * the same reason (its own listing carries the title); any other kind (a custody due-back, a
 * review date, from a layer the reader turned on) paints the word its layer gives it, with the
 * source's own declared label (a custody number) beside the matter number.
 */
export function entryFromTimelineRow(
  row: TimelineEntry,
  context: EntryContext,
): CalendarEntry | null {
  if (row.kind === "deadline" || row.kind === "firmEvent") return null;
  const date = civilDayOf(row.sortKey);
  if (row.kind === "event" || row.kind === "cancelledEvent") {
    // The source says a setting was called off as its own kind, so the firm grid can strike it.
    const cancelled = row.kind === "cancelledEvent";
    return {
      id: entryId("event", row.rowId),
      kind: "event",
      recordId: row.rowId,
      matterId: row.matterId,
      link: row.link,
      settled: cancelled,
      date,
      label: eventTypeNameForCode(row.label, context.eventTypesByCode),
      detail: matterLine(row.matterId, context),
      tone: cancelled ? "warning" : eventTypeTone(row.label),
      struck: cancelled,
    };
  }
  const matter = matterLine(row.matterId, context);
  return {
    id: entryId("other", `${row.sourceKey}:${row.rowId}`),
    kind: "other",
    recordId: row.rowId,
    matterId: row.matterId,
    link: row.link,
    settled: false,
    date,
    label: layeredKindLabel(row.kind),
    detail:
      [matter, row.label].filter((part): part is string => part != null).join(" · ") || undefined,
    tone: "neutral",
  };
}

/** A deadline, from its own read, which carries its title and its read-time overdue flag. */
export function entryFromDeadline(
  deadline: CalendarDeadline,
  context: EntryContext,
  scope: CalendarScope,
): CalendarEntry {
  const struck = deadline.state === "vacated" || deadline.state === "superseded";
  return {
    id: entryId("deadline", deadline.id),
    kind: "deadline",
    recordId: deadline.id,
    matterId: deadline.matterId,
    link: null,
    settled: deadline.state !== "open",
    date: deadline.dueOn,
    label: deadline.title,
    detail: isMatterScope(scope) ? undefined : matterLine(deadline.matterId, context),
    time:
      formatWallClock(deadline.dueAtTime, deadline.timeZone, context.readerTimeZone) ?? undefined,
    tone: deadlineTone(deadline),
    struck,
  };
}

/** A matter event from the matter's own listing, which carries its title: the matter scope's source. */
export function entryFromMatterEvent(
  event: CalendarEvent,
  context: EntryContext,
  scope: CalendarScope,
): CalendarEntry {
  const typeName = event.eventTypeName ?? UNCLASSIFIED_EVENT_LABEL;
  const place = event.locationText ?? event.courtReference;
  const detail = isMatterScope(scope)
    ? [typeName, place].filter((part): part is string => part !== null).join(" · ")
    : (matterLine(event.matterId, context) ?? typeName);
  return {
    id: entryId("event", event.id),
    kind: "event",
    recordId: event.id,
    matterId: event.matterId,
    link: null,
    settled: event.status === "cancelled",
    date: event.startsOn,
    endDate: event.endsOn ?? undefined,
    label: event.title,
    detail,
    time: formatWallClock(event.startsAtTime, event.timeZone, context.readerTimeZone) ?? undefined,
    tone: event.status === "cancelled" ? "warning" : eventTypeTone(typeCodeOf(event, context)),
    struck: event.status === "cancelled",
  };
}

/** The platform code behind a matter event's type name, where the catalog knows it. */
function typeCodeOf(event: CalendarEvent, context: EntryContext): string | null {
  if (event.eventTypeName === null) return null;
  for (const type of context.eventTypesByCode.values()) {
    if (type.name === event.eventTypeName) return type.code;
  }
  return null;
}

/** A firm event from the firm's own listing. The accent register: a firm entry is an edge, not a matter. */
export function entryFromFirmEvent(event: FirmEvent, context: EntryContext): CalendarEntry {
  const typeName = firmEventTypeName(event, context);
  return {
    id: entryId("firmEvent", event.id),
    kind: "firmEvent",
    recordId: event.id,
    matterId: null,
    link: null,
    settled: event.status === "cancelled",
    date: event.startsOn,
    endDate: event.endsOn ?? undefined,
    label: event.title,
    detail: [typeName, firmEventAudienceLabel(event.audience)].join(" · "),
    time: formatWallClock(event.startsAtTime, event.timeZone, context.readerTimeZone) ?? undefined,
    tone: event.status === "cancelled" ? "warning" : "accent",
    struck: event.status === "cancelled",
  };
}

/** What a booking on a resource's schedule paints as when it double-books. */
export const DOUBLE_BOOKED_LABEL = "Double-booked";

/**
 * A booking on a resource's schedule. It paints as the EVENT it belongs to (its type's name, since
 * the availability read carries no title), keyed by the event so activating it opens that event's
 * window, and it takes the danger register with a "Double-booked" line when the read pre-paired
 * it with another booking: a room in two places at once is the one fact a room grid exists to show.
 */
export function entryFromAvailability(
  entry: ResourceAvailabilityEntry,
  context: EntryContext,
): CalendarEntry {
  const doubleBooked = entry.overlappingBookingIds.length > 0;
  const kind: CalendarEntryKind = entry.eventKind === "firmEvent" ? "firmEvent" : "event";
  const label =
    entry.eventTypeName ??
    (entry.eventKind === "firmEvent" ? UNCLASSIFIED_FIRM_EVENT_LABEL : UNCLASSIFIED_EVENT_LABEL);
  return {
    id: entryId(kind, entry.eventId),
    kind,
    recordId: entry.eventId,
    matterId: null,
    link: entry.link,
    settled: false,
    date: entry.startsOn,
    endDate: entry.endsOn ?? undefined,
    label,
    detail: doubleBooked ? DOUBLE_BOOKED_LABEL : undefined,
    time: formatWallClock(entry.startsAtTime, entry.timeZone, context.readerTimeZone) ?? undefined,
    tone: doubleBooked ? "danger" : entry.eventKind === "firmEvent" ? "accent" : "info",
  };
}

function firmEventTypeName(event: FirmEvent, context: EntryContext): string {
  if (event.eventTypeId === null) return UNCLASSIFIED_FIRM_EVENT_LABEL;
  for (const type of context.eventTypesByCode.values()) {
    if (type.id === event.eventTypeId) return type.name;
  }
  return UNCLASSIFIED_FIRM_EVENT_LABEL;
}

/**
 * The order a day reads in: all-day entries first (a filing is due whatever the hour), then by the
 * recorded time, then by label so two entries never swap between reads. Days themselves are
 * ordered by date, which the grid also relies on for its day groups.
 */
export function orderEntries(entries: readonly CalendarEntry[]): CalendarEntry[] {
  return [...entries].toSorted((left, right) => {
    if (left.date !== right.date) return left.date < right.date ? -1 : 1;
    const leftTime = left.time ?? "";
    const rightTime = right.time ?? "";
    if ((leftTime === "") !== (rightTime === "")) return leftTime === "" ? -1 : 1;
    if (leftTime !== rightTime) return compareClock(leftTime, rightTime);
    return left.label.localeCompare(right.label);
  });
}

/** Two formatted clocks ("9:00 AM", "2:30 PM (America/Chicago)") compared by their hour of day. */
function compareClock(left: string, right: string): number {
  return clockMinutes(left) - clockMinutes(right);
}

function clockMinutes(clock: string): number {
  const match = /^(\d{1,2}):(\d{2}) (AM|PM)/.exec(clock);
  if (match === null) return 0;
  const hour12 = Number(match[1]) % 12;
  const hour = match[3] === "PM" ? hour12 + 12 : hour12;
  return hour * 60 + Number(match[2]);
}
