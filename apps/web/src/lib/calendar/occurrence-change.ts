/*
 * One day of a repeating setting, opened and changed.
 *
 * A series is ONE record carrying a rule, and every day of it on the grid opens that record. So the
 * window has to know two things the record alone cannot tell it: WHICH day was pressed, so the pane
 * shows that Tuesday rather than the day the series began; and, when something is changed, how far
 * the change reaches. Guessing that second answer is how a firm's calendar quietly moves, so it is
 * asked every time, with three answers:
 *
 *   this        only the day pressed. Written as its own event that names the series and the day
 *               it replaces; the series skips that day from then on.
 *   following   the day pressed and every later one. The series ends the day before, and a new one
 *               starts on that day with the change; what already happened is not rewritten.
 *   all         every day, past ones included. The ordinary edit of the series record, with a date
 *               moved on this day moving the series' own start by the same number of days.
 *
 * Every decision is made here, without a browser, and the window renders it.
 */
import { formatCivilDateLong, parseCivilDate } from "@magna-carta/design-system/calendar-grid";
import { movedLikeOccurrence } from "@magna-carta/civil-time/recurrence";
import type { EntryRecord, EntryReference } from "./entry-reference.ts";

/** How far a change to one day of a series reaches. */
export type SeriesChangeScope = "this" | "following" | "all";

export interface SeriesChangeChoice {
  readonly value: SeriesChangeScope;
  readonly label: string;
  /** The line under the label: which days, in words a person checks before saving. */
  readonly detail: string;
}

/** What one day of a series looks like before it is changed: the series' own dates, kept aside. */
export interface SeriesDates {
  readonly startsOn: string;
  readonly endsOn: string | null;
}

interface DatedEvent {
  readonly startsOn: string;
  readonly endsOn: string | null;
  readonly recurrenceRule: string | null;
}

/** The day of a series a reference points at, or null where the record does not repeat. */
export function occurrenceOf(
  record: EntryRecord | null,
  reference: EntryReference | null,
): string | null {
  if (record === null || record.kind === "deadline") return null;
  if (record.event.recurrenceRule === null) return null;
  return reference?.occurrenceOn ?? record.event.startsOn;
}

/**
 * The series record as it stands on one of its days: the same record with that day's dates. A
 * two-day series' Friday runs to Saturday, because the series' own length rides along.
 */
export function atOccurrence<Event extends DatedEvent>(event: Event, day: string): Event {
  if (day === event.startsOn) return event;
  return {
    ...event,
    startsOn: day,
    endsOn: event.endsOn === null ? null : movedLikeOccurrence(event.endsOn, event.startsOn, day),
  };
}

/**
 * The fields of a change to every day, with any date moved on THIS day moving the series by the same
 * number of days. Somebody who moves this Tuesday's conference to Wednesday and says "all events"
 * means every Tuesday becomes a Wednesday, not that the series now starts this Wednesday.
 */
export function seriesWideFields<Fields extends { startsOn?: string; endsOn?: string | null }>(
  fields: Fields,
  series: SeriesDates,
  occurrenceOn: string,
): Fields {
  if (fields.startsOn === undefined) return fields;
  const startsOn = movedLikeOccurrence(series.startsOn, occurrenceOn, fields.startsOn);
  const endsOn =
    fields.endsOn === undefined || fields.endsOn === null
      ? fields.endsOn
      : movedLikeOccurrence(fields.endsOn, fields.startsOn, startsOn);
  return { ...fields, startsOn, endsOn };
}

/** The three answers, worded for the day pressed. */
export function seriesChangeChoices(occurrenceOn: string): SeriesChangeChoice[] {
  const day = longDay(occurrenceOn);
  return [
    { value: "this", label: "This event only", detail: day },
    {
      value: "following",
      label: "This and all later events",
      detail: `${day} onward. Earlier ones stay as they were.`,
    },
    {
      value: "all",
      label: "All events in the series",
      detail: "Every one, including ones already past.",
    },
  ];
}

/**
 * Why a scope cannot take this change, or undefined where it can. A new repeat rule is a change to
 * how a series repeats, which one day on its own cannot have.
 */
export function seriesChangeRefusal(
  scope: SeriesChangeScope,
  ruleChanged: boolean,
): string | undefined {
  if (scope === "this" && ruleChanged) {
    return "A change to how it repeats reaches more than one day. Choose later events or all events.";
  }
  return undefined;
}

/**
 * The scope the server is actually asked for. "This and all later" from the series' first day IS the
 * whole series, and is sent as the ordinary edit so a meeting and its rooms move with it as they
 * always have.
 */
export function effectiveScope(
  scope: SeriesChangeScope,
  occurrenceOn: string,
  series: SeriesDates,
): SeriesChangeScope {
  return scope === "following" && occurrenceOn <= series.startsOn ? "all" : scope;
}

function longDay(civilDate: string): string {
  try {
    return formatCivilDateLong(parseCivilDate(civilDate));
  } catch {
    return civilDate;
  }
}
