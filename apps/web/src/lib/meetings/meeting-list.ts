/*
 * The Meetings screen's three sections, and what a row of each one says.
 *
 * WHY THREE SECTIONS AND NOT ONE TABLE WITH A STATUS COLUMN. The standing rule for a list screen is
 * one table at the full width, and a second table has to earn the difference. These three earn it by
 * being three different questions rather than three values of one column: what can I walk into right
 * now, what am I due in, and what has just finished. A member arriving at this screen is answering
 * exactly one of them, and each is a separate read of the server — so a single table would either
 * merge three listings into an order none of them has, or make the reader narrow a column to get
 * back to the listing they came for.
 *
 * WHAT A ROW SAYS IS THE SAME IN ALL THREE, and the sections differ only in the one fact that is
 * theirs: how many people are in the room, when it starts, when it ended. That is deliberate — the
 * columns a reader learns in the first section are the columns they read in the other two.
 *
 * THE EVENT'S CLOCK IS THE EVENT'S, THE INSTANTS ARE THE READER'S. A meeting hangs on a calendar
 * entry, and that entry's time is a wall clock in its own zone: a hearing at nine in Denver is at
 * nine for everybody reading it, which is why the date and the start time are formatted in the
 * event's zone and stated with its shortcode. When something HAPPENED — a room going live, a meeting
 * ending — is an instant, and an instant is read in the zone of whoever is looking.
 * docs/conventions/dates.md is the home of both rules.
 */
import type { GridColumn } from "@magna-carta/design-system/data-table";
import {
  formatDate,
  formatInstant,
  formatTimeZoneAbbreviation,
} from "@magna-carta/design-system/formatters";
import { instantForCivilDateTime } from "@magna-carta/civil-time/time-zone";
import { formatWallClock } from "$lib/calendar/calendar-api.ts";
import type { Failure } from "$lib/api/problem.ts";
import type { MeetingSummary } from "@magna-carta/api-client";

/** The three questions the screen answers, in the order it answers them. */
export const MEETING_SCOPES = ["live", "upcoming", "recent"] as const;
export type MeetingScope = (typeof MEETING_SCOPES)[number];

/** What each section is called, and what its table announces to a screen reader. */
export const MEETING_SECTIONS: Record<
  MeetingScope,
  { readonly heading: string; readonly caption: string; readonly noun: string }
> = {
  live: {
    heading: "Live Now",
    caption: "Meetings running right now",
    noun: "meetings running now",
  },
  upcoming: {
    heading: "Upcoming",
    caption: "Meetings on events today or later",
    noun: "upcoming meetings",
  },
  recent: {
    heading: "Recently Ended",
    caption: "Meetings that ended in the last thirty days",
    noun: "meetings that have ended",
  },
};

/**
 * One section's standing, as the page's own read of that scope leaves it.
 *
 * Null meetings is a read in flight, an empty array is an answer, and a failure is neither: the
 * three are different things on screen and the type keeps them apart rather than collapsing an
 * unanswered section into an empty one.
 */
export interface MeetingSectionState {
  readonly meetings: readonly MeetingSummary[] | null;
  readonly failure?: Failure | null;
  /** Whether the listing carries on past what is in hand. */
  readonly more?: boolean;
  readonly loadingMore?: boolean;
  readonly onRetry?: () => void;
  readonly onLoadMore?: () => void;
}

/** Column ids, spelled in full, so a test and the cell snippet name the same thing as the column. */
export const MEETING_COLUMN_IDENTIFIERS = {
  title: "title",
  where: "where",
  when: "when",
  inTheRoom: "inTheRoom",
  ended: "ended",
  actions: "actions",
} as const;

/**
 * What a meeting's event is ON, in the words the row uses.
 *
 * A meeting on a firm event says so outright. A meeting on a matter's event NAMES THE MATTER ONLY BY
 * ITS LINK, because the summary carries the matter's identifier and not its name — the row would
 * otherwise print a handle at a reader. When the summary carries a name, this is where it goes.
 */
export function meetingWhere(meeting: MeetingSummary): string {
  return meeting.matterId === null ? "Firm event" : "Matter";
}

/** Where the matter behind a meeting is read, or null for a meeting on a firm event. */
export function matterAddress(meeting: MeetingSummary): string | null {
  if (meeting.matterId === null) return null;
  return `/matters/${encodeURIComponent(meeting.matterId)}/overview`;
}

/** The room itself. */
export function meetingAddress(meeting: MeetingSummary): string {
  return `/meetings/${encodeURIComponent(meeting.id)}`;
}

/**
 * When the meeting's event is, read in the EVENT'S zone: the day, the clock where the entry carries
 * one, and the zone's shortcode so a reader in another office knows which nine o'clock this is.
 *
 * The shortcode is worked out on the record's own day, because the same zone is PST in January and
 * PDT in July and a code taken from today is wrong about half the year's meetings.
 */
export function meetingWhen(meeting: MeetingSummary): string {
  const day = formatDate(meeting.startsOn);
  const clock = formatWallClock(meeting.startsAtTime, meeting.timeZone, meeting.timeZone);
  if (clock === null) return day;
  const code = zoneCodeOn(meeting);
  return code === "" ? `${day}, ${clock}` : `${day}, ${clock} ${code}`;
}

/*
 * The zone's shortcode on the record's own day, or nothing.
 *
 * A row that cannot be dated says the clock without a code rather than taking the whole listing
 * down: the instant is only needed to choose between the standard and daylight spellings, and a
 * value this refuses is one the columns beside it will render as whatever text arrived.
 */
function zoneCodeOn(meeting: MeetingSummary): string {
  try {
    return formatTimeZoneAbbreviation(
      meeting.timeZone,
      new Date(instantForCivilDateTime(meeting.startsOn, meeting.startsAtTime, meeting.timeZone)),
    );
  } catch {
    return "";
  }
}

/** When a meeting ended, as an instant in the reader's own zone. Empty while it has not. */
export function meetingEnded(meeting: MeetingSummary): string {
  return meeting.endedAt === null ? "" : formatInstant(meeting.endedAt);
}

/**
 * The columns a section's table declares.
 *
 * The three sets share their first two columns and differ in the third, which is the fact that
 * section exists to state. Sorting is the grid's own; the initial sort is what the server's own
 * order already is, so a reader who touches nothing reads the listing as the server assembled it.
 */
export function meetingColumns(scope: MeetingScope): GridColumn<MeetingSummary>[] {
  const columns: GridColumn<MeetingSummary>[] = [
    {
      id: MEETING_COLUMN_IDENTIFIERS.title,
      label: "Event",
      type: "text",
      anchored: true,
      value: (meeting) => meeting.title,
    },
    {
      id: MEETING_COLUMN_IDENTIFIERS.where,
      label: "On",
      type: "text",
      filter: "set",
      filterValues: ["Matter", "Firm event"],
      value: (meeting) => meetingWhere(meeting),
    },
    {
      id: MEETING_COLUMN_IDENTIFIERS.when,
      label: "When",
      // The value sorts and filters on the event's own civil day; the text says the clock and the
      // zone beside it, which is what a reader needs and what no date sort should be done on.
      type: "date",
      value: (meeting) => meeting.startsOn,
      text: (meeting) => meetingWhen(meeting),
    },
  ];
  if (scope === "live") {
    columns.push({
      id: MEETING_COLUMN_IDENTIFIERS.inTheRoom,
      label: "In the Room",
      type: "number",
      value: (meeting) => meeting.liveCount,
    });
  }
  if (scope === "recent") {
    columns.push({
      id: MEETING_COLUMN_IDENTIFIERS.ended,
      label: "Ended",
      type: "date",
      value: (meeting) => meeting.endedAt,
      text: (meeting) => meetingEnded(meeting),
    });
  }
  columns.push({
    id: MEETING_COLUMN_IDENTIFIERS.actions,
    label: "Actions",
    type: "text",
    filter: "none",
    align: "end",
    value: () => null,
    text: () => "",
  });
  return columns;
}

/** Each section opens on what the server put first: the soonest event, the latest ending. */
export function meetingInitialSort(scope: MeetingScope): {
  readonly columnId: string;
  readonly direction: "ascending" | "descending";
} {
  if (scope === "recent") {
    return { columnId: MEETING_COLUMN_IDENTIFIERS.ended, direction: "descending" };
  }
  return { columnId: MEETING_COLUMN_IDENTIFIERS.when, direction: "ascending" };
}
