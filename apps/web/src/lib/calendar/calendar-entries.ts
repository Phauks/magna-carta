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
import {
  wallClockMinutes,
  type CalendarGridColor,
  type CalendarGridEntry,
} from "@magna-carta/design-system/calendar-grid";
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
  /**
   * Which of the reader's calendars this row is on — the catalog keys of the reads that returned
   * it (calendar-sources.ts). Usually one; several where a hearing is on two attorneys' calendars
   * and the firm's records besides, which is a fact about the hearing and not a duplicate.
   *
   * THE PROJECTION LEAVES IT EMPTY and the read plan fills it in, because a projection is handed a
   * row and has no idea which read produced it. A surface reading an untagged entry is reading one
   * that never went through the plan.
   */
  readonly sourceKeys: readonly string[];
  /** The record's own identifier, without the kind prefix. */
  readonly recordId: string;
  readonly matterId: string | null;
  /**
   * Whether `detail` is — or is standing in for — this entry's matter NUMBER.
   *
   * The number is the one part of a chip that does not come from the entry's own read: it is
   * looked up in the firm's matters, which arrive separately and later. A chip painted before they
   * land carries whatever `detail` could say without one (a type name, or nothing), and `numbered`
   * fills the number in when it arrives. This flag is what lets it: without it a later pass cannot
   * tell a detail that WANTED a number from one that is complete as it stands, and would overwrite
   * "Hearing · Department 12" on a matter's own calendar, where the number is the one fact every
   * row shares and therefore the one worth saying nowhere.
   */
  readonly detailIsMatterNumber: boolean;
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
      detailIsMatterNumber: true,
      link: row.link,
      settled: cancelled,
      sourceKeys: [],
      date,
      label: eventTypeNameForCode(row.label, context.eventTypesByCode),
      detail: matterLine(row.matterId, context),
      time:
        formatWallClock(row.timeOfDay, row.timeZone ?? "", context.readerTimeZone, date) ??
        undefined,
      startMinute: minutesOf(row.timeOfDay),
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
    detailIsMatterNumber: false,
    link: row.link,
    settled: false,
    sourceKeys: [],
    date,
    label: layeredKindLabel(row.kind),
    time:
      formatWallClock(row.timeOfDay, row.timeZone ?? "", context.readerTimeZone, date) ?? undefined,
    startMinute: minutesOf(row.timeOfDay),
    detail:
      [matter, row.label].filter((part): part is string => part != null).join(" · ") || undefined,
    tone: "neutral",
  };
}

/**
 * The words a federated firm-event row paints as.
 *
 * The source declares "Firm meeting · all_members" — the catalog type name and the audience column
 * — because the TITLE is not the platform's to broadcast beyond the event's own access-gated read.
 * The audience arrives as the column's own value, so it is read into the product's word here; a
 * label with no audience the product knows is printed as it came, because a source that has learned
 * a new audience should read oddly rather than be dropped.
 */
function firmEventTimelineLabel(label: string | null): string {
  if (label === null || label.trim() === "") return UNCLASSIFIED_FIRM_EVENT_LABEL;
  const parts = label.split(" · ");
  const audience = parts.at(-1);
  if (audience !== "all_members" && audience !== "participants") return label;
  const said = firmEventAudienceLabel(audience);
  return parts.length === 1
    ? `${UNCLASSIFIED_FIRM_EVENT_LABEL} · ${said}`
    : [...parts.slice(0, -1), said].join(" · ");
}

/**
 * A row of the federated read as an AVAILABILITY answer — the projection above, plus the firm
 * events it deliberately leaves to somebody else.
 *
 * The grid skips a firm-event row because the firm's own listing is read beside it and carries the
 * title, so painting both would put the same event on the day twice. Availability has no second
 * read to defer to: the member filter the server resolves in SQL is the whole question, and a firm
 * event is on a colleague's calendar exactly as a hearing is. Dropped, somebody sitting in a
 * firm-wide training read as "Free", which is the one answer this line must never give.
 *
 * What it prints is still never a title — `member-availability.ts` says why at length — and the
 * source's own declared label is non-privileged by contract.
 */
export function availabilityEntryFromTimelineRow(
  row: TimelineEntry,
  context: EntryContext,
): CalendarEntry | null {
  if (row.kind !== "firmEvent") return entryFromTimelineRow(row, context);
  const date = civilDayOf(row.sortKey);
  return {
    id: entryId("firmEvent", row.rowId),
    kind: "firmEvent",
    recordId: row.rowId,
    matterId: null,
    detailIsMatterNumber: false,
    link: row.link,
    settled: false,
    sourceKeys: [],
    date,
    label: firmEventTimelineLabel(row.label),
    time:
      formatWallClock(row.timeOfDay, row.timeZone ?? "", context.readerTimeZone, date) ?? undefined,
    startMinute: minutesOf(row.timeOfDay),
    tone: "accent",
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
    detailIsMatterNumber: !isMatterScope(scope),
    link: null,
    settled: deadline.state !== "open",
    sourceKeys: [],
    date: deadline.dueOn,
    label: deadline.title,
    detail: isMatterScope(scope) ? undefined : matterLine(deadline.matterId, context),
    time:
      formatWallClock(
        deadline.dueAtTime,
        deadline.timeZone,
        context.readerTimeZone,
        deadline.dueOn,
      ) ?? undefined,
    startMinute: minutesOf(deadline.dueAtTime),
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
    detailIsMatterNumber: !isMatterScope(scope),
    link: null,
    settled: event.status === "cancelled",
    sourceKeys: [],
    date: event.startsOn,
    endDate: event.endsOn ?? undefined,
    label: event.title,
    detail,
    time:
      formatWallClock(event.startsAtTime, event.timeZone, context.readerTimeZone, event.startsOn) ??
      undefined,
    startMinute: minutesOf(event.startsAtTime),
    endMinute: minutesOf(event.endsAtTime),
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
    detailIsMatterNumber: false,
    link: null,
    settled: event.status === "cancelled",
    sourceKeys: [],
    date: event.startsOn,
    endDate: event.endsOn ?? undefined,
    label: event.title,
    detail: [typeName, firmEventAudienceLabel(event.audience)].join(" · "),
    time:
      formatWallClock(event.startsAtTime, event.timeZone, context.readerTimeZone, event.startsOn) ??
      undefined,
    startMinute: minutesOf(event.startsAtTime),
    endMinute: minutesOf(event.endsAtTime),
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
    detailIsMatterNumber: false,
    recordId: entry.eventId,
    matterId: null,
    link: entry.link,
    settled: false,
    sourceKeys: [],
    date: entry.startsOn,
    endDate: entry.endsOn ?? undefined,
    label,
    detail: doubleBooked ? DOUBLE_BOOKED_LABEL : undefined,
    time:
      formatWallClock(entry.startsAtTime, entry.timeZone, context.readerTimeZone, entry.startsOn) ??
      undefined,
    startMinute: minutesOf(entry.startsAtTime),
    endMinute: minutesOf(entry.endsAtTime),
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

/**
 * A recorded wall clock as minutes past midnight, for the day grid's hour rows; undefined where
 * there is none, which is what all day means.
 *
 * IN THE RECORD'S OWN ZONE, never the reader's. The grid is civil: an entry sits on the day its row
 * names and at the hour its row names, and only the formatted text says whose zone that is. A
 * conversion here would move a nine o'clock hearing to the eleven o'clock row for a reader two
 * zones east, which is the one thing a calendar of court settings must never do.
 */
function minutesOf(time: string | null): number | undefined {
  if (time === null) return undefined;
  return wallClockMinutes(time) ?? undefined;
}

/**
 * The same entry, on one of the reader's calendars. The read plan calls it as each read lands, so
 * an entry knows where it came from before anything merges it.
 */
export function taggedWith(entry: CalendarEntry, sourceKey: string): CalendarEntry {
  return { ...entry, sourceKeys: [sourceKey] };
}

/**
 * Entries from several calendars, merged into one row per record.
 *
 * A hearing two attorneys are at comes back from both their reads, and it is ONE hearing: merging
 * by the entry's own identity and unioning the calendars it arrived from is what keeps a month grid
 * from painting it twice, and what lets a day grid put it in both their columns on purpose. The
 * first arrival wins on every other field, because the reads project the same record the same way
 * and a later copy would only re-decide what the first already decided.
 */
export function mergeByRecord(entries: readonly CalendarEntry[]): CalendarEntry[] {
  const byId = new Map<string, CalendarEntry>();
  for (const entry of entries) {
    const existing = byId.get(entry.id);
    if (existing === undefined) {
      byId.set(entry.id, entry);
      continue;
    }
    const keys = new Set([...existing.sourceKeys, ...entry.sourceKeys]);
    byId.set(entry.id, { ...existing, sourceKeys: [...keys] });
  }
  return [...byId.values()];
}

/**
 * The colour an entry paints in: the one its calendar was given.
 *
 * An entry on several calendars takes the colour of the FIRST of them in the rail's own order,
 * because the rail's order is the reader's own arrangement and "the first calendar this is on" is
 * an answer they can predict. On a day grid the lane decides instead, which is why the lane
 * expansion below overwrites it.
 */
/**
 * The entry with its matter's number filled in, once the firm's matters have arrived.
 *
 * THE NUMBER IS THE ONE PART OF A CHIP THAT IS NOT IN ITS OWN READ. Everything else a chip says
 * comes back with the row; the matter number is a lookup against the firm's matters, which are read
 * separately and — for a firm with a lot of them — considerably later. The calendar used to WAIT for
 * that list before issuing its own reads, so the grid stayed blank until every page of the firm's
 * matter listing had come back. That made the time to first paint scale with how many matters the
 * firm has ever opened, which is exactly the wrong thing for it to scale with.
 *
 * So the grid paints as soon as ITS read lands, with the number missing, and this fills it in when
 * the matters arrive. `detailIsMatterNumber` is what makes that safe: it marks the chips whose
 * detail wanted a number, so a later pass cannot overwrite a detail that was already complete.
 *
 * It is a pure function over one entry, applied in the controller's own derived — so the chips
 * re-label when the numbers land and NOTHING is read a second time.
 */
export function numbered(
  entry: CalendarEntry,
  matterNumbers: ReadonlyMap<string, string>,
): CalendarEntry {
  if (!entry.detailIsMatterNumber || entry.matterId === null) return entry;
  const number = matterNumbers.get(entry.matterId);
  // Unchanged where the number is not known yet, and where the chip already carries it: returning
  // the same object keeps the grid from re-rendering a row nothing happened to.
  if (number === undefined || number === entry.detail) return entry;
  return { ...entry, detail: number };
}

export function colored(
  entry: CalendarEntry,
  colors: ReadonlyMap<string, CalendarGridColor>,
  order: readonly string[],
): CalendarEntry {
  for (const key of order) {
    if (!entry.sourceKeys.includes(key)) continue;
    const color = colors.get(key);
    if (color !== undefined) return { ...entry, color };
  }
  return entry;
}

/**
 * A day's entries expanded one per lane: an entry on three calendars becomes three rows, each in
 * its own column, each wearing that column's colour.
 *
 * This is the one place the same record is deliberately drawn more than once, and it is what a
 * column per calendar MEANS — a hearing both attorneys are at is on both their days, and a column
 * that left it out of one of them would be lying about that attorney's afternoon. The render key
 * carries the lane so the two copies are two rows to Svelte rather than one row that moved; a press
 * on either reaches the one record through `recordKeyOf`.
 */
export function perLane(
  entries: readonly CalendarEntry[],
  lanes: readonly string[],
  colors: ReadonlyMap<string, CalendarGridColor>,
): CalendarEntry[] {
  const expanded: CalendarEntry[] = [];
  for (const entry of entries) {
    for (const lane of lanes) {
      if (!entry.sourceKeys.includes(lane)) continue;
      expanded.push({
        ...entry,
        id: `${lane}${LANE_KEY_SEPARATOR}${entry.id}`,
        lane,
        color: colors.get(lane),
      });
    }
  }
  return expanded;
}

/** How a lane-expanded render key is spelled: the lane, this mark, then the entry's own key. */
const LANE_KEY_SEPARATOR = "|";

/**
 * The entry key behind a grid row's identifier — the same string either way for a row the day grid
 * expanded into a lane and for one nothing touched.
 *
 * A press on a hearing in the second attorney's column must open that hearing, not fail to find a
 * key nothing recorded, so the lane the row was drawn in comes off here rather than at each surface
 * that activates one. A record identifier is minted with `_`, and a lane key with `:`, so neither
 * can carry this separator and the split is unambiguous.
 */
export function recordKeyOf(gridEntryId: string): string {
  const separator = gridEntryId.indexOf(LANE_KEY_SEPARATOR);
  return separator === -1 ? gridEntryId : gridEntryId.slice(separator + 1);
}
