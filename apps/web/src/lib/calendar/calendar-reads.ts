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
  readFirmCalendar,
  readResourceAvailability,
  type CalendarEvent,
} from "./calendar-api.ts";
import {
  entryFromDeadline,
  entryFromAvailability,
  entryFromFirmEvent,
  entryFromMatterEvent,
  entryFromTimelineRow,
  orderEntries,
  type CalendarEntry,
  type EntryContext,
} from "./calendar-entries.ts";
import type { CalendarScope } from "./calendar-scope.ts";
import { windowOverlaps, type CalendarWindow } from "./calendar-window.ts";
import { firmCalendarKinds } from "./calendar-vocabulary.ts";

/** Which of the plan's reads a failure belongs to, in the words a notice uses. */
export type CalendarReadName = "events" | "deadlines" | "firmEvents" | "bookings";

export interface CalendarReadFailure {
  readonly read: CalendarReadName;
  readonly failure: Failure;
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
   * The layers turned on over the firm calendar (calendar-vocabulary.ts, `CALENDAR_LAYERS`): the
   * timeline's other date-bearing sources the federated read is widened to. None by default, so
   * the firm grid opens on what the firm recorded as a calendar entry.
   */
  readonly layers?: ReadonlySet<string>;
}

const NO_LAYERS: ReadonlySet<string> = new Set();

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
      return readFirmWindow(fetchImpl, scope, window, context, options.layers ?? NO_LAYERS);
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

async function readFirmWindow(
  fetchImpl: typeof fetch,
  scope: CalendarScope,
  window: CalendarWindow,
  context: EntryContext,
  layers: ReadonlySet<string>,
): Promise<CalendarWindowResult> {
  const memberId = scope.kind === "mine" ? scope.memberId : undefined;
  const [events, deadlines, firmEvents] = await Promise.all([
    walk((cursor) =>
      readFirmCalendar(fetchImpl, {
        from: window.from,
        to: window.to,
        side: "matter",
        kinds: firmCalendarKinds(layers),
        memberId,
        cursor,
      }),
    ),
    walk((cursor) => listDeadlines(fetchImpl, { from: window.from, through: window.to, cursor })),
    walk((cursor) => listFirmEvents(fetchImpl, { from: window.from, to: window.to, cursor })),
  ]);

  const entries: CalendarEntry[] = [];
  for (const row of events.rows) {
    const entry = entryFromTimelineRow(row, context);
    if (entry !== null) entries.push(entry);
  }
  for (const deadline of deadlines.rows) entries.push(entryFromDeadline(deadline, context, scope));
  for (const firmEvent of firmEvents.rows) {
    if (windowOverlaps(window, firmEvent.startsOn, firmEvent.endsOn)) {
      entries.push(entryFromFirmEvent(firmEvent, context));
    }
  }

  return {
    entries: orderEntries(entries),
    failures: collectFailures([
      ["events", events.failure],
      ["deadlines", deadlines.failure],
      ["firmEvents", firmEvents.failure],
    ]),
    truncated: events.truncated || deadlines.truncated || firmEvents.truncated,
  };
}

async function readMatterWindow(
  fetchImpl: typeof fetch,
  matterId: string,
  window: CalendarWindow,
  context: EntryContext,
  scope: CalendarScope,
): Promise<CalendarWindowResult> {
  const [events, deadlines] = await Promise.all([
    // Newest first: once a whole page starts before the window, nothing older can be inside it.
    walk<CalendarEvent>(
      (cursor) => listMatterEvents(fetchImpl, matterId, cursor),
      (page) => page.length > 0 && page.every((event) => event.startsOn < window.from),
    ),
    walk((cursor) =>
      listDeadlines(fetchImpl, { matterId, from: window.from, through: window.to, cursor }),
    ),
  ]);

  const entries: CalendarEntry[] = [];
  for (const event of events.rows) {
    if (windowOverlaps(window, event.startsOn, event.endsOn)) {
      entries.push(entryFromMatterEvent(event, context, scope));
    }
  }
  for (const deadline of deadlines.rows) entries.push(entryFromDeadline(deadline, context, scope));

  return {
    entries: orderEntries(entries),
    failures: collectFailures([
      ["events", events.failure],
      ["deadlines", deadlines.failure],
    ]),
    truncated: events.truncated || deadlines.truncated,
  };
}

function collectFailures(
  named: readonly (readonly [CalendarReadName, Failure | null])[],
): CalendarReadFailure[] {
  const failures: CalendarReadFailure[] = [];
  for (const [read, failure] of named) {
    if (failure !== null) failures.push({ read, failure });
  }
  return failures;
}

/** What each read is a read OF, as a notice names it; the sentence and the title both read from here. */
const READ_SUBJECTS: Record<CalendarReadName, string> = {
  events: "the events",
  deadlines: "the deadlines",
  firmEvents: "the firm's own events",
  bookings: "the resource's bookings",
};

/** The sentence a notice leads with for a failed read, in this surface's own words. */
export function describeReadFailure(read: CalendarReadName): string {
  const subject = READ_SUBJECTS[read];
  return `${subject.charAt(0).toUpperCase()}${subject.slice(1)} could not be read.`;
}

/** The title a notice stands under for a failed read: the same fact, set as a heading. */
export function readFailureTitle(read: CalendarReadName): string {
  return `${READ_SUBJECTS[read]} could not be read`.replaceAll(
    /(^|\s)([a-z])/g,
    (_match: string, before: string, letter: string) => `${before}${letter.toUpperCase()}`,
  );
}
