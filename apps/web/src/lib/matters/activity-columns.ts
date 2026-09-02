/*
 * The matter's activity as one table.
 *
 * IT IS THE PRODUCT'S TABLE, NOT A LIST THAT LOOKS LIKE ONE. Every other register here — time,
 * costs, files, matters, contacts — is a `DataTable.Grid`, and that shell already carries sorting,
 * per-column filtering, a set filter with counts, column show/hide/pin/reorder/resize, a search, a
 * footer that says how many rows a filter is hiding, and keyboard selection. A chronology written by
 * hand gets none of that and has to earn each piece back; written as columns it inherits all of it,
 * and a reader who has learned one register has learned this one.
 *
 * WHICH IS WHY THERE IS NO FILTER BAR ABOVE THE TABLE. Narrowing to notes is the Kind column's set
 * filter; narrowing to last month is the Date column's range; narrowing to one person is Who. A row
 * of chips over a table that can already do all three is a second filter for the reader to learn and
 * a second place for the two to disagree.
 *
 * THE ROW MODEL IS FLAT AND PRE-RESOLVED, deliberately. A grid column's `value` is called for every
 * row on every sort, filter and render, so it has to be a field read rather than a lookup — which is
 * what `activityRows` is for: the timeline entry, what its own subsystem calls it, who acted, and
 * where it opens, resolved once.
 */
import type { GridColumn } from "@magna-carta/design-system/data-table";
import type { ActivityEntry } from "./activity-api.ts";
import type { ActivityDetail } from "./activity-detail.svelte.ts";
import { timeOfDay } from "./activity-days.ts";
import {
  ACTIVITY_PRESENTATIONS,
  followableLink,
  happenedText,
  presentationFor,
} from "./activity-presentation.ts";

export const ACTIVITY_COLUMN_IDENTIFIERS = {
  date: "date",
  time: "time",
  kind: "kind",
  what: "what",
  details: "details",
  who: "who",
} as const;

/** One row of the matter's activity, with everything a column reads already resolved onto it. */
export interface ActivityRow {
  /** The render key and the selection key: one row per entry, across every source. */
  readonly key: string;
  readonly entry: ActivityEntry;
  /** The civil day it belongs to. What the Date column sorts and filters on. */
  readonly day: string;
  /** The clock time, where its source records one. Empty on a source that records only a day. */
  readonly time: string;
  /**
   * What kind of thing it is, in one word: Note, Time entry, or a file's own extension. It is the
   * Kind column's value, so it is also what that column's set filter narrows by.
   */
  readonly kind: string;
  /** What it is CALLED, where its own subsystem can say — otherwise what happened. */
  readonly what: string;
  /** The facts that ride beside it: a size, an amount, a state, the source's own declared label. */
  readonly details: string;
  /** Who did it, as a name. Empty where the platform acted or nothing recorded a person. */
  readonly who: string;
  /** Where the row opens, or null where no built section owns it. */
  readonly href: string | null;
}

/**
 * How wide a row's own name is allowed to make its column.
 *
 * The grid fits a column to the longest text in it, so one note whose opening line runs to a
 * paragraph would push Who and Details off the screen for every other row. The cell truncates on
 * top of this and the full text stays in the row's title attribute, so nothing is lost — what is
 * capped is the column's claim on the width, not the record.
 */
const WHAT_COLUMN_CHARACTERS = 72;

function shortened(text: string): string {
  return text.length <= WHAT_COLUMN_CHARACTERS
    ? text
    : `${text.slice(0, WHAT_COLUMN_CHARACTERS - 1).trimEnd()}…`;
}

/** What the row builder needs from the surface: the detail index and the roster. */
export interface ActivityRowContext {
  readonly detailFor: (sourceKey: string, rowId: string) => ActivityDetail | undefined;
  readonly nameOf: (userId: string | null) => string | null;
}

/**
 * Resolve a page of entries into rows.
 *
 * The order the server sent is kept: entries arrive under one comparable sort key across every
 * subsystem, and the table sorts what it is given rather than this deciding for it.
 */
export function activityRows(
  entries: readonly ActivityEntry[],
  context: ActivityRowContext,
): readonly ActivityRow[] {
  return entries.map((entry) => {
    const presentation = presentationFor(entry.sourceKey);
    const detail = context.detailFor(entry.sourceKey, entry.rowId);
    return {
      key: `${entry.sourceKey}:${entry.rowId}`,
      entry,
      day: entry.sortKey.slice(0, 10),
      time: timeOfDay(entry.sortKey) ?? "",
      // The subsystem's own word where it has a more exact one — a pdf rather than a Document.
      kind: detail?.kind ?? presentation?.noun ?? "Other",
      what: shortened(detail?.title ?? happenedText(entry.sourceKey)),
      details: [
        detail?.secondary,
        // The source's own declared label, named for what it is: a document's TYPE beside a document
        // reads as its name unless something says which field it is.
        entry.label === null
          ? undefined
          : `${presentation?.labelMeaning ?? "Recorded"}: ${entry.label}`,
      ]
        .filter((part) => part !== undefined && part !== "")
        .join(" · "),
      who: context.nameOf(entry.actorUserId) ?? "",
      href: followableLink(entry.sourceKey, entry.link),
    };
  });
}

/**
 * Every kind the platform can put on this table, whether or not a row on screen carries it.
 *
 * A set filter otherwise offers only what the loaded rows hold, which is right for a column over
 * whatever the data happens to contain and wrong for one over a vocabulary the platform declares: a
 * matter with no costs yet would show a filter that cannot say "Cost", and a reader would take that
 * for "this matter can never have one".
 */
export const ACTIVITY_KIND_VALUES: readonly string[] = [
  ...new Set(ACTIVITY_PRESENTATIONS.map((presentation) => presentation.noun)),
];

/** The declarative column model. Everything the register can do it does through this. */
export function activityColumns(): readonly GridColumn<ActivityRow>[] {
  return [
    {
      id: ACTIVITY_COLUMN_IDENTIFIERS.date,
      label: "Date",
      type: "date",
      // The row's anchor: a chronology read in any other order is not a chronology, so this column
      // always shows and always leads.
      anchored: true,
      value: (row) => row.day,
    },
    {
      id: ACTIVITY_COLUMN_IDENTIFIERS.time,
      label: "Time",
      type: "text",
      value: (row) => row.time,
    },
    {
      id: ACTIVITY_COLUMN_IDENTIFIERS.kind,
      label: "Kind",
      type: "text",
      // The set filter with the platform's whole vocabulary behind it. This is what replaced the row
      // of band chips: narrowing to notes is a filter on a column, like narrowing anything else.
      filter: "set",
      filterValues: ACTIVITY_KIND_VALUES,
      value: (row) => row.kind,
    },
    {
      id: ACTIVITY_COLUMN_IDENTIFIERS.what,
      label: "What",
      type: "text",
      // The link's arrow rides beyond the text, so the double-click fit has to account for it.
      fitExtra: 16,
      value: (row) => row.what,
    },
    {
      id: ACTIVITY_COLUMN_IDENTIFIERS.details,
      label: "Details",
      type: "text",
      value: (row) => row.details,
    },
    {
      id: ACTIVITY_COLUMN_IDENTIFIERS.who,
      label: "Who",
      type: "text",
      filter: "set",
      value: (row) => row.who,
    },
  ];
}
