/*
 * The matter's activity as one table.
 *
 * IT IS THE PRODUCT'S TABLE, NOT A LIST THAT LOOKS LIKE ONE. Every other register here — time,
 * costs, files, matters, contacts — is a `DataTable.Grid`, and that shell already carries sorting,
 * per-column filtering, a set filter with counts, column show/hide/pin/reorder/resize, and a footer
 * that says how many rows a filter is hiding. A chronology written by hand gets none of that and has
 * to earn each piece back; written as columns it inherits all of it.
 *
 * WHICH IS WHY THERE IS NO FILTER BAR ABOVE THE TABLE. Narrowing to notes is the Section column's
 * set filter; narrowing to last month is the Date column's range; narrowing to one person is Who.
 *
 * TWO WORDS PER ROW, NOT ONE. Section says which part of the matter a row belongs to — a closed
 * vocabulary the registry declares — and Type says what the row IS in its own subsystem's words: a
 * document's type, an event's type, a note, a deadline. One column doing both jobs mixed "Deadline"
 * with "pdf" in one filter list.
 *
 * THE ROW MODEL IS FLAT AND PRE-RESOLVED, deliberately. A grid column's `value` is called for every
 * row on every sort, filter and render, so it has to be a field read rather than a lookup — which
 * is what `activityRows` is for: the entry, what its own subsystem calls it, its facts, who acted,
 * and how it opens, resolved once.
 */
import type { GridColumn } from "@magna-carta/design-system/data-table";
import type { ActivityEntry } from "$lib/matters/activity-api.ts";
import {
  describedRowOf,
  type ActivityContribution,
  type Fact,
  type FactContext,
  type Glyph,
  type OpenTarget,
} from "./contribution.ts";
import {
  ACTIVITY_SECTION_VALUES,
  ACTIVITY_TYPE_VALUES,
  contributionFor,
  happenedText,
  openTargetFor,
} from "./contributions.ts";

export const ACTIVITY_COLUMN_IDENTIFIERS = {
  date: "date",
  time: "time",
  section: "section",
  type: "type",
  name: "name",
  details: "details",
  who: "who",
} as const;

/** One row of the matter's activity, with everything a column reads already resolved onto it. */
export interface ActivityRow {
  /** The render key and the selection key: one row per entry, across every source. */
  readonly key: string;
  readonly entry: ActivityEntry;
  readonly contribution: ActivityContribution | undefined;
  /** The civil day it belongs to. What the Date column sorts and filters on. */
  readonly day: string;
  /** The clock time, where its source records one. Empty on a source that records only a day. */
  readonly time: string;
  /** Which part of the matter it belongs to. The Section column's value and its filter's word. */
  readonly section: string;
  /** What it IS, in its subsystem's own word. The Type column's value and its filter's word. */
  readonly type: string;
  readonly glyph: Glyph | null;
  /** What it is CALLED, where its subsystem described it — otherwise what happened. */
  readonly name: string;
  readonly facts: readonly Fact[];
  /** The facts as one line, for the column's sort, filter and title. */
  readonly details: string;
  /** Who did it, as a name. Empty where the platform acted or nothing recorded a person. */
  readonly who: string;
  readonly target: OpenTarget;
}

/**
 * How wide a row's own name is allowed to make its column.
 *
 * The grid fits a column to the longest text in it, so one note whose opening line runs to a
 * paragraph would push Who and Details off the screen for every other row. The cell truncates on
 * top of this and the full text stays in the row's title attribute, so nothing is lost — what is
 * capped is the column's claim on the width, not the record.
 */
const NAME_COLUMN_CHARACTERS = 72;

function shortened(text: string): string {
  return text.length <= NAME_COLUMN_CHARACTERS
    ? text
    : `${text.slice(0, NAME_COLUMN_CHARACTERS - 1).trimEnd()}…`;
}

/** The clock time of an instant sort key, or null on a civil-date key that records none. */
export function timeOfDay(sortKey: string): string | null {
  if (sortKey.length <= 10) return null;
  const date = new Date(sortKey);
  if (Number.isNaN(date.getTime())) return null;
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/** What the row builder needs from the surface: the roster and the formatters. */
export interface ActivityRowContext {
  readonly nameOf: (userId: string | null) => string | null;
  readonly facts: FactContext;
}

function factLine(fact: Fact): string {
  return fact.label === undefined ? fact.value : `${fact.label} ${fact.value}`;
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
    const contribution = contributionFor(entry.sourceKey);
    const described = describedRowOf(entry);
    const noun = contribution?.noun ?? "Unknown";
    const facts: Fact[] = [];
    if (described !== null && contribution?.factsOf !== undefined) {
      facts.push(...contribution.factsOf(described, context.facts));
    }
    // The source's own declared label, named for what it is, where the description did not already
    // say more: a document's TYPE beside a document reads as its name unless something says which
    // field it is.
    if (described === null && entry.label !== null) {
      facts.push({ label: contribution?.labelMeaning ?? "Recorded", value: entry.label });
    }
    return {
      key: `${entry.sourceKey}:${entry.rowId}`,
      entry,
      contribution,
      day: entry.sortKey.slice(0, 10),
      time: timeOfDay(entry.sortKey) ?? "",
      section: contribution?.section ?? "Unknown",
      type:
        described === null
          ? noun
          : (contribution?.typeOf?.(described) ?? described.typeText ?? noun),
      glyph:
        described !== null && contribution?.glyphOf !== undefined
          ? contribution.glyphOf(described)
          : contribution === undefined
            ? null
            : { kind: "icon", icon: contribution.icon },
      name: shortened(described?.title ?? happenedText(entry.sourceKey, entry.kind)),
      facts,
      details: facts.map(factLine).join(" · "),
      who: context.nameOf(entry.actorUserId) ?? "",
      target: openTargetFor(entry),
    };
  });
}

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
      id: ACTIVITY_COLUMN_IDENTIFIERS.section,
      label: "Section",
      type: "text",
      // The set filter with the platform's whole vocabulary behind it: narrowing to notes is a
      // filter on this column, like narrowing anything else.
      filter: "set",
      filterValues: ACTIVITY_SECTION_VALUES,
      value: (row) => row.section,
    },
    {
      id: ACTIVITY_COLUMN_IDENTIFIERS.type,
      label: "Type",
      type: "text",
      filter: "set",
      filterValues: ACTIVITY_TYPE_VALUES,
      value: (row) => row.type,
    },
    {
      id: ACTIVITY_COLUMN_IDENTIFIERS.name,
      label: "Name",
      type: "text",
      // The open glyph rides beyond the text, so the double-click fit has to account for it.
      fitExtra: 16,
      value: (row) => row.name,
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
