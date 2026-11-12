/*
 * The read plan: one scope plus one window, to the entries a grid paints.
 *
 * Written once here so that every host of the calendar makes the same reads in the same way. A
 * scope maps to a fixed set of reads, each walked to the end of the window:
 *
 *   firm / mine   the federated read narrowed to the event kind (pointers; the grid paints type
 *                 names and matter numbers), the deadlines read over the same window (titles, the
 *                 read-time overdue flag), and the firm's own events listing (titles; the firm's
 *                 scope is not per-matter). Mine adds the member to the federated read, which the
 *                 server resolves in SQL; the firm's all-members events are on everyone's answer.
 *   matter        the matter's own event listing, which carries titles and is newest-first, walked
 *                 until it passes the window's start (page one for the near future, which is the
 *                 common case); and the deadlines read for the matter over the window.
 *
 * ON THE FIRM SIDE THE PLAN IS A PLAN PER CALENDAR, NOT ONE READ. A reader who has turned on four
 * attorneys and two rooms gets the firm's own reads plus one member-filtered federated read each
 * and one availability read each — because "what is on Ada's calendar" is a predicate the server
 * already resolves in SQL, and the alternative is reading the whole firm into the browser and
 * deciding there who was at what. Every entry is tagged with the calendar its read returned it
 * from, and the same record arriving from two of them is merged into one row that knows it is on
 * both (`mergeByRecord`). The reads are made together, and a calendar whose read failed is named
 * on its own rather than taking the others down with it.
 *
 * THE READS FAIL INDEPENDENTLY. A firm whose deadline read errored still needs to see its hearings,
 * so a failure is reported beside the entries the other reads returned, named by which read it was.
 *
 * A WALK HAS A CEILING. Each read is cursor-paged, and a window over a busy firm can hold more than
 * one page, so each is walked; the walk stops at a fixed number of pages and says so (`truncated`)
 * rather than reading a whole firm's record into a browser. A month over a hundred rows a page is
 * far past what a grid can show anyway, and the agenda says "the first N" rather than pretending.
 */
import type { ApiOutcome, Failure, Page } from "$lib/api/request.ts";
import {
  listDeadlines,
  listFirmEvents,
  listMatterEvents,
  listSeries,
  readFirmCalendar,
  readResourceAvailability,
  type CalendarEvent,
  type SeriesQuery,
} from "./calendar-api.ts";
import {
  entryFromDeadline,
  entryFromAvailability,
  entryFromFirmEvent,
  entryFromMatterEvent,
  entryFromOwnAccountEvent,
  entryFromTimelineRow,
  entriesFromSeries,
  mergeByRecord,
  orderEntries,
  taggedWith,
  withoutSeriesRows,
  type CalendarEntry,
  type EntryContext,
} from "./calendar-entries.ts";
import type { CalendarScope } from "./calendar-scope.ts";
import { readOwnAccountEvents } from "./own-account-events.ts";
import { windowOverlaps, type CalendarWindow } from "./calendar-window.ts";
import { calendarLayer, FIRM_CALENDAR_KINDS } from "./calendar-vocabulary.ts";
import { FIRM_OWN_CALENDARS, type CalendarSource } from "./calendar-sources.ts";

/** Which of the plan's reads a failure belongs to, in the words a notice uses. */
export type CalendarReadName = "events" | "deadlines" | "firmEvents" | "bookings" | "ownEvents";

export interface CalendarReadFailure {
  readonly read: CalendarReadName;
  readonly failure: Failure;
  /**
   * The calendar whose read this was, where it was one particular calendar's — so a notice can say
   * WHOSE events could not be read rather than leaving a reader with six calendars on to guess.
   */
  readonly sourceName?: string;
}

export interface CalendarWindowResult {
  readonly entries: readonly CalendarEntry[];
  readonly failures: readonly CalendarReadFailure[];
  /** True when any walk hit its page ceiling, so the surface can say the answer is the first N. */
  readonly truncated: boolean;
}

/** How many pages one read is walked before the plan stops and says so. */
export const MAX_PAGES_PER_READ = 8;

type PageReader<T> = (cursor?: string) => Promise<ApiOutcome<Page<T>>>;

interface Walk<T> {
  readonly rows: T[];
  readonly failure: Failure | null;
  readonly truncated: boolean;
}

/**
 * Walk a cursor-paged read to its end or the ceiling. `stopAfter` lets a newest-first listing stop
 * once a page has passed the window, so the matter's whole record is not read for a month of it.
 */
async function walk<T>(read: PageReader<T>, stopAfter?: (page: T[]) => boolean): Promise<Walk<T>> {
  const rows: T[] = [];
  let cursor: string | undefined;
  for (let pages = 0; pages < MAX_PAGES_PER_READ; pages += 1) {
    const outcome = await read(cursor);
    if (outcome.kind !== "ok") return { rows, failure: outcome.failure, truncated: false };
    rows.push(...outcome.value.data);
    if (stopAfter?.(outcome.value.data) === true) return { rows, failure: null, truncated: false };
    if (outcome.value.nextCursor === null) return { rows, failure: null, truncated: false };
    cursor = outcome.value.nextCursor;
  }
  return { rows, failure: null, truncated: true };
}

export interface CalendarReadOptions {
  /**
   * The calendars the reader has turned on, in the rail's own order (calendar-sources.ts). Given,
   * they decide the whole firm-side plan; absent, the plan is the firm's own three calendars, which
   * is what every embedded host that never drew a rail asks for.
   */
  readonly sources?: readonly CalendarSource[];
}

/**
 * The repeating settings a calendar holds, one entry per day of each inside the window, and the
 * series whose own rows the other reads returned once on their first day and should not paint.
 *
 * Read beside every calendar that paints events, narrowed the way that calendar is narrowed, because
 * the ordinary reads find a series only on the day it began: a weekly conference that started in
 * March is not in November's rows at all. A failure is the calendar's events failing, in the same
 * words, rather than a third kind of notice a reader has to learn.
 */
async function readSeriesFor(
  fetchImpl: typeof fetch,
  query: SeriesQuery,
  context: EntryContext,
  scope: CalendarScope,
): Promise<{
  entries: CalendarEntry[];
  seriesIds: Set<string>;
  failure: Failure | null;
  truncated: boolean;
}> {
  const outcome = await listSeries(fetchImpl, query);
  if (outcome.kind !== "ok") {
    return { entries: [], seriesIds: new Set(), failure: outcome.failure, truncated: false };
  }
  return {
    entries: outcome.value.data.flatMap((series) => entriesFromSeries(series, context, scope)),
    seriesIds: new Set(outcome.value.data.map((series) => series.id)),
    failure: null,
    truncated: outcome.value.truncated,
  };
}

/** Everything the window holds for the scope, projected and ordered. */
export async function readCalendarWindow(
  fetchImpl: typeof fetch,
  scope: CalendarScope,
  window: CalendarWindow,
  context: EntryContext,
  options: CalendarReadOptions = {},
): Promise<CalendarWindowResult> {
  switch (scope.kind) {
    case "matter":
      return readMatterWindow(fetchImpl, scope.matterId, window, context, scope);
    case "resource":
      return readResourceWindow(fetchImpl, scope.resourceId, window, context);
    default:
      return readFirmWindow(
        fetchImpl,
        scope,
        window,
        context,
        options.sources ?? FIRM_OWN_CALENDARS,
      );
  }
}

/**
 * A resource's schedule: one un-paged read of its live bookings over the window, conflicts already
 * paired by the server. Nothing else is read, because a room is busy only ever on account of a
 * booking, and a booking is not a calendar entry anywhere but here.
 */
async function readResourceWindow(
  fetchImpl: typeof fetch,
  resourceId: string,
  window: CalendarWindow,
  context: EntryContext,
): Promise<CalendarWindowResult> {
  const outcome = await readResourceAvailability(fetchImpl, resourceId, {
    from: window.from,
    to: window.to,
  });
  if (outcome.kind !== "ok") {
    return {
      entries: [],
      failures: collectFailures([["bookings", outcome.failure]]),
      truncated: false,
    };
  }
  const entries = outcome.value.data
    .filter((entry) => windowOverlaps(window, entry.startsOn, entry.endsOn))
    .map((entry) => entryFromAvailability(entry, context));
  return { entries: orderEntries(entries), failures: [], truncated: false };
}

/**
 * The firm side: the calendars the reader turned on, each read in the way it is read, then merged.
 *
 * A calendar that was not turned on is not read at all — which is the point of the rail, and what
 * keeps the request count the reader's own choice rather than the roster's size. When no rail said
 * otherwise the plan is the firm's own three calendars, the same records it read before there were
 * calendars to choose between, so every embedded host keeps working unchanged.
 */
async function readFirmWindow(
  fetchImpl: typeof fetch,
  scope: CalendarScope,
  window: CalendarWindow,
  context: EntryContext,
  sources: readonly CalendarSource[],
): Promise<CalendarWindowResult> {
  // `mine` is the member the host embedded the calendar with, and it narrows the FIRM'S OWN
  // records read rather than adding a calendar: "my calendar" and "the calendar I turned on for
  // Ada" are the same predicate asked by two different people.
  const memberId = scope.kind === "mine" ? scope.memberId : undefined;
  const plans = sources.map((source) =>
    readOneCalendar(fetchImpl, source, window, context, scope, { memberId }),
  );
  const results = await Promise.all(plans);

  const entries = results.flatMap((result) => result.entries);
  const failures = results.flatMap((result) => result.failures);
  return {
    entries: orderEntries(mergeByRecord(entries)),
    failures,
    truncated: results.some((result) => result.truncated),
  };
}

/** What one calendar's read needs beyond the window: whose calendar this is. */
interface FirmReadOptions {
  /** The member a `mine` scope narrowed the firm's own records to, where it did. */
  readonly memberId: string | undefined;
}

/**
 * One calendar, read the way that kind of calendar is read, with every entry tagged as its.
 *
 * The five arms are the five things a calendar can BE (calendar-sources.ts), and the switch is
 * here rather than at the rail because a rail draws rows and a plan makes requests. A calendar
 * still waiting on a source it does not have is never in this list — the catalog refuses to turn
 * one on — so there is no arm for it and no read that quietly returns nothing.
 */
async function readOneCalendar(
  fetchImpl: typeof fetch,
  source: CalendarSource,
  window: CalendarWindow,
  context: EntryContext,
  scope: CalendarScope,
  options: FirmReadOptions,
): Promise<CalendarWindowResult> {
  switch (source.kind.kind) {
    case "caseSettings":
      return readCaseSettingsCalendar(fetchImpl, source, window, context, scope, options);
    case "deadlines":
      return readDeadlinesCalendar(fetchImpl, source, window, context, scope);
    case "firmEvents":
      return readFirmEventsCalendar(fetchImpl, source, window, context, scope);
    case "member":
      return readMemberCalendar(fetchImpl, source, source.kind.memberId, window, context, scope);
    case "resource":
      return readRoomCalendar(fetchImpl, source, source.kind.resourceId, window, context);
    case "layer":
      return readLayerCalendar(fetchImpl, source, source.kind.layerKey, window, context);
    case "ownAccount":
      return readOwnAccountCalendar(source, window, context);
  }
}

/**
 * The reader's own events from their connected account: one read of what a sync pass last stored
 * for them, which never waits on their provider. Not paged, because one person's own month is
 * small; the server says when it answered with less than everything.
 */
async function readOwnAccountCalendar(
  source: CalendarSource,
  window: CalendarWindow,
  context: EntryContext,
): Promise<CalendarWindowResult> {
  const outcome = await readOwnAccountEvents({ from: window.from, to: window.to });
  if (outcome.kind !== "ok") {
    return {
      entries: [],
      failures: collectFailures([["ownEvents", outcome.failure]]),
      truncated: false,
    };
  }
  const entries: CalendarEntry[] = [];
  for (const event of outcome.value.events) {
    const entry = entryFromOwnAccountEvent(event, context);
    // The server's window is a day wide of the reader's on each side, since it cannot know their
    // zone; the days the entry actually lands on are checked here.
    if (entry !== null && windowOverlaps(window, entry.date, entry.endDate ?? null)) {
      entries.push(taggedWith(entry, source.key));
    }
  }
  return { entries, failures: [], truncated: outcome.value.truncated };
}

/**
 * The firm's case settings: every matter's events, from the federated read narrowed to the matter
 * side and to the EVENT kind only. A date calendar (custody dates) is its own row in the rail with
 * its own read; widening this one with it would read the same rows twice and put a custody due-back
 * on the case settings calendar, which is not where it is.
 */
async function readCaseSettingsCalendar(
  fetchImpl: typeof fetch,
  source: CalendarSource,
  window: CalendarWindow,
  context: EntryContext,
  scope: CalendarScope,
  options: FirmReadOptions,
): Promise<CalendarWindowResult> {
  const [events, series] = await Promise.all([
    walk((cursor) =>
      readFirmCalendar(fetchImpl, {
        from: window.from,
        to: window.to,
        side: "matter",
        kinds: FIRM_CALENDAR_KINDS,
        memberId: options.memberId,
        cursor,
      }),
    ),
    readSeriesFor(
      fetchImpl,
      { from: window.from, to: window.to, side: "matter", memberId: options.memberId },
      context,
      scope,
    ),
  ]);
  const entries: CalendarEntry[] = [];
  for (const row of events.rows) {
    const entry = entryFromTimelineRow(row, context);
    if (entry !== null) entries.push(taggedWith(entry, source.key));
  }
  for (const entry of series.entries) entries.push(taggedWith(entry, source.key));
  return {
    entries: withoutSeriesRows(entries, series.seriesIds),
    failures: collectFailures([["events", events.failure ?? series.failure]]),
    truncated: events.truncated || series.truncated,
  };
}

/**
 * The firm's deadlines, from the deadlines read, which is the one that carries titles and the
 * read-time overdue flag. It takes no member: a deadline belongs to a case rather than to a person.
 */
async function readDeadlinesCalendar(
  fetchImpl: typeof fetch,
  source: CalendarSource,
  window: CalendarWindow,
  context: EntryContext,
  scope: CalendarScope,
): Promise<CalendarWindowResult> {
  const deadlines = await walk((cursor) =>
    listDeadlines(fetchImpl, { from: window.from, through: window.to, cursor }),
  );
  const entries = deadlines.rows.map((deadline) =>
    taggedWith(entryFromDeadline(deadline, context, scope), source.key),
  );
  return {
    entries,
    failures: collectFailures([["deadlines", deadlines.failure]]),
    truncated: deadlines.truncated,
  };
}

/** The firm's own events, from the firm's own listing, which carries their titles. */
async function readFirmEventsCalendar(
  fetchImpl: typeof fetch,
  source: CalendarSource,
  window: CalendarWindow,
  context: EntryContext,
  scope: CalendarScope,
): Promise<CalendarWindowResult> {
  const [firmEvents, series] = await Promise.all([
    walk((cursor) => listFirmEvents(fetchImpl, { from: window.from, to: window.to, cursor })),
    readSeriesFor(fetchImpl, { from: window.from, to: window.to, side: "firm" }, context, scope),
  ]);
  const entries = firmEvents.rows
    .filter((firmEvent) => windowOverlaps(window, firmEvent.startsOn, firmEvent.endsOn))
    .map((firmEvent) => taggedWith(entryFromFirmEvent(firmEvent, context), source.key));
  for (const entry of series.entries) entries.push(taggedWith(entry, source.key));
  return {
    entries: withoutSeriesRows(entries, series.seriesIds),
    failures: collectFailures([["firmEvents", firmEvents.failure ?? series.failure]], source.name),
    truncated: firmEvents.truncated || series.truncated,
  };
}

/**
 * One colleague's calendar: the federated read with the member filter the server resolves in SQL —
 * a participant, the matter's responsible member, or an all-members firm event.
 *
 * SETTINGS, NOT DEADLINES. The deadlines read takes a matter and a window and has no member
 * predicate, because a deadline belongs to a case rather than to a person; the firm's Deadlines
 * calendar is where a firm sees its deadlines, and it is on by default.
 */
async function readMemberCalendar(
  fetchImpl: typeof fetch,
  source: CalendarSource,
  memberId: string,
  window: CalendarWindow,
  context: EntryContext,
  scope: CalendarScope,
): Promise<CalendarWindowResult> {
  const [events, series] = await Promise.all([
    walk((cursor) =>
      readFirmCalendar(fetchImpl, {
        from: window.from,
        to: window.to,
        side: "all",
        memberId,
        cursor,
      }),
    ),
    // The matter side only, as the rows above paint: a firm event reaches a colleague's calendar
    // through the firm's own listing, never through theirs.
    readSeriesFor(
      fetchImpl,
      { from: window.from, to: window.to, side: "matter", memberId },
      context,
      scope,
    ),
  ]);
  const entries: CalendarEntry[] = [];
  for (const row of events.rows) {
    const entry = entryFromTimelineRow(row, context);
    if (entry !== null) entries.push(taggedWith(entry, source.key));
  }
  for (const entry of series.entries) entries.push(taggedWith(entry, source.key));
  return {
    entries: withoutSeriesRows(entries, series.seriesIds),
    failures: collectFailures([["events", events.failure ?? series.failure]], source.name),
    truncated: events.truncated || series.truncated,
  };
}

/** A room's calendar: its live bookings, with the conflicts the server already paired. */
async function readRoomCalendar(
  fetchImpl: typeof fetch,
  source: CalendarSource,
  resourceId: string,
  window: CalendarWindow,
  context: EntryContext,
): Promise<CalendarWindowResult> {
  const outcome = await readResourceAvailability(fetchImpl, resourceId, {
    from: window.from,
    to: window.to,
  });
  if (outcome.kind !== "ok") {
    return {
      entries: [],
      failures: collectFailures([["bookings", outcome.failure]], source.name),
      truncated: false,
    };
  }
  const entries = outcome.value.data
    .filter((entry) => windowOverlaps(window, entry.startsOn, entry.endsOn))
    .map((entry) => taggedWith(entryFromAvailability(entry, context), source.key));
  return { entries, failures: [], truncated: false };
}

/**
 * A calendar that is dates rather than people: the federated read narrowed to that layer's own
 * sources, so a reader can have custody dates on without the firm's whole record beside them.
 */
async function readLayerCalendar(
  fetchImpl: typeof fetch,
  source: CalendarSource,
  layerKey: string,
  window: CalendarWindow,
  context: EntryContext,
): Promise<CalendarWindowResult> {
  const layer = calendarLayer(layerKey);
  if (layer === undefined) return { entries: [], failures: [], truncated: false };
  const rows = await walk((cursor) =>
    readFirmCalendar(fetchImpl, {
      from: window.from,
      to: window.to,
      side: "matter",
      kinds: layer.sources,
      cursor,
    }),
  );
  const entries: CalendarEntry[] = [];
  for (const row of rows.rows) {
    const entry = entryFromTimelineRow(row, context);
    if (entry !== null) entries.push(taggedWith(entry, source.key));
  }
  return {
    entries,
    failures: collectFailures([["events", rows.failure]], source.name),
    truncated: rows.truncated,
  };
}

async function readMatterWindow(
  fetchImpl: typeof fetch,
  matterId: string,
  window: CalendarWindow,
  context: EntryContext,
  scope: CalendarScope,
): Promise<CalendarWindowResult> {
  const [events, deadlines, series] = await Promise.all([
    // Newest first: once a whole page starts before the window, nothing older can be inside it —
    // except a series, which the series read beside it finds wherever it began.
    walk<CalendarEvent>(
      (cursor) => listMatterEvents(fetchImpl, matterId, cursor),
      (page) => page.length > 0 && page.every((event) => event.startsOn < window.from),
    ),
    walk((cursor) =>
      listDeadlines(fetchImpl, { matterId, from: window.from, through: window.to, cursor }),
    ),
    readSeriesFor(
      fetchImpl,
      { from: window.from, to: window.to, side: "matter", matterId },
      context,
      scope,
    ),
  ]);

  const entries: CalendarEntry[] = [];
  for (const event of events.rows) {
    if (windowOverlaps(window, event.startsOn, event.endsOn)) {
      entries.push(entryFromMatterEvent(event, context, scope));
    }
  }
  entries.push(...series.entries);
  for (const deadline of deadlines.rows) entries.push(entryFromDeadline(deadline, context, scope));

  return {
    entries: orderEntries(withoutSeriesRows(entries, series.seriesIds)),
    failures: collectFailures([
      ["events", events.failure ?? series.failure],
      ["deadlines", deadlines.failure],
    ]),
    truncated: events.truncated || deadlines.truncated || series.truncated,
  };
}

function collectFailures(
  named: readonly (readonly [CalendarReadName, Failure | null])[],
  sourceName?: string,
): CalendarReadFailure[] {
  const failures: CalendarReadFailure[] = [];
  for (const [read, failure] of named) {
    if (failure !== null) failures.push({ read, failure, sourceName });
  }
  return failures;
}

/** What each read is a read OF, as a notice names it; the sentence and the title both read from here. */
const READ_SUBJECTS: Record<CalendarReadName, string> = {
  events: "the events",
  deadlines: "the deadlines",
  firmEvents: "the firm's own events",
  bookings: "the resource's bookings",
  ownEvents: "your own Outlook events",
};

/**
 * The sentence a notice leads with for a failed read, in this surface's own words — naming the
 * CALENDAR where the failure was one calendar's, because a reader with six on has no way to tell
 * which of them is missing from a grid that is still standing.
 */
export function describeReadFailure(read: CalendarReadName, sourceName?: string): string {
  const subject = READ_SUBJECTS[read];
  const opened = `${subject.charAt(0).toUpperCase()}${subject.slice(1)}`;
  return sourceName === undefined
    ? `${opened} could not be read.`
    : `${opened} on ${sourceName} could not be read.`;
}

/** The title a notice stands under for a failed read: the same fact, set as a heading. */
export function readFailureTitle(read: CalendarReadName): string {
  return `${READ_SUBJECTS[read]} could not be read`.replaceAll(
    /(^|\s)([a-z])/g,
    (_match: string, before: string, letter: string) => `${before}${letter.toUpperCase()}`,
  );
}

/**
 * A stable key for a failure, so a surface renders one notice per failed calendar rather than one
 * per read name. Two calendars whose events read failed are two facts.
 */
export function readFailureKey(failure: CalendarReadFailure): string {
  return `${failure.read}:${failure.sourceName ?? ""}`;
}
