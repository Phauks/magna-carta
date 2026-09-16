/*
 * What a proposed setting would collide with: the days and hours already spoken for on the
 * calendars it would land on.
 *
 * A DOUBLE BOOKING IS NEVER REFUSED, ONLY STATED. The platform does not know that two things at
 * once are wrong — a partner signs an order at nine while an associate takes a deposition, and the
 * room is booked for both halves of a mediation on purpose. So this reports and the reader decides,
 * which is the same posture the resource booking already takes ("lands even when it double-books,
 * and says so in `conflicts`").
 *
 * RECURRENCE IS WHY IT EXISTS. One hearing at a bad hour is visible in the day schedule beside the
 * form. A weekly setting for a year is fifty-two chances to collide, and nobody scrolls a year to
 * check. So a recurring setting's conflicts are counted across every occurrence it would create and
 * stated before it is recorded.
 *
 * IT COMPARES CIVIL DAYS AND WALL CLOCKS, never instants, exactly as the grid does. Two settings
 * collide when they share a civil day AND their minutes overlap on it; an all-day record collides
 * with everything on its day, because a thing true of the whole day is true of every hour of it.
 * Nothing here converts a zone: a reader looking at a proposed Tuesday is comparing it against the
 * Tuesday the other records name, and converting would move half of them to Monday.
 */
import type { CalendarEntry } from "./calendar-entries.ts";

/** A moment on a civil day, in the day's own terms. Absent minutes mean all day. */
export interface ProposedOccurrence {
  /** The civil day (`YYYY-MM-DD`) this occurrence falls on. */
  readonly date: string;
  /** Minutes past midnight it starts, or undefined for an all-day record. */
  readonly startMinute?: number;
  /** Minutes past midnight it ends. Undefined where nothing was recorded. */
  readonly endMinute?: number;
}

/** One collision: which proposed day hit what. */
export interface ScheduleConflict {
  /** The civil day the collision is on. */
  readonly date: string;
  /** The record already there. */
  readonly entry: CalendarEntry;
}

/**
 * What a proposed set of occurrences collides with, among the entries already on screen.
 *
 * A SETTLED RECORD IS NOT A CONFLICT. A hearing that was vacated and a deadline already satisfied
 * are not competing for anybody's Tuesday, and counting them would make a firm that keeps its
 * history honestly look busier than one that deletes it.
 *
 * The result is ordered by day and then by the order the entries came, so a list of them reads down
 * the calendar rather than in whatever order the reads happened to land.
 */
export function scheduleConflicts(
  occurrences: readonly ProposedOccurrence[],
  entries: readonly CalendarEntry[],
  options: { readonly ignoreRecordId?: string } = {},
): ScheduleConflict[] {
  const live = entries.filter(
    (entry) => !entry.settled && entry.recordId !== options.ignoreRecordId,
  );
  const byDay = new Map<string, CalendarEntry[]>();
  for (const entry of live) {
    const existing = byDay.get(entry.date);
    if (existing === undefined) byDay.set(entry.date, [entry]);
    else existing.push(entry);
  }
  const found: ScheduleConflict[] = [];
  for (const occurrence of [...occurrences].toSorted((left, right) =>
    left.date.localeCompare(right.date),
  )) {
    for (const entry of byDay.get(occurrence.date) ?? []) {
      if (overlaps(occurrence, entry)) found.push({ date: occurrence.date, entry });
    }
  }
  return found;
}

/**
 * Whether a proposed occurrence and an entry on the same day compete for the same hours.
 *
 * Either being all day makes it a collision: a filing due that day and a hearing that day are both
 * true of the day, and the form's job is to say so rather than to decide they do not overlap
 * because one of them named no hour.
 *
 * Touching is not overlapping. A setting that ends at eleven and one that starts at eleven are
 * back to back, which is a full morning rather than a conflict.
 */
function overlaps(occurrence: ProposedOccurrence, entry: CalendarEntry): boolean {
  const proposedStart = occurrence.startMinute;
  const entryStart = entry.startMinute;
  if (proposedStart === undefined || entryStart === undefined) return true;
  // An end nobody recorded is a point: it competes only with what is running at that minute.
  const proposedEnd = occurrence.endMinute ?? proposedStart;
  const entryEnd = entry.endMinute ?? entryStart;
  return (
    proposedStart < Math.max(entryEnd, entryStart + 1) &&
    entryStart < Math.max(proposedEnd, proposedStart + 1)
  );
}

/** How many DAYS a set of conflicts touches, which is what a person asks about a long series. */
export function conflictedDays(conflicts: readonly ScheduleConflict[]): number {
  return new Set(conflicts.map((conflict) => conflict.date)).size;
}

/**
 * The sentence a form shows above a recurring setting it is about to record.
 *
 * It counts DAYS rather than collisions: "three of the twelve dates" is the question a person asks
 * about a series, where "seven conflicts" leaves them working out whether that is seven bad days or
 * two crowded ones. It never says the word "conflict" alone without saying what with — a bare count
 * is an alarm rather than an answer.
 */
export function conflictSentence(
  conflicts: readonly ScheduleConflict[],
  occurrenceCount: number,
): string | null {
  const days = conflictedDays(conflicts);
  if (days === 0) return null;
  if (occurrenceCount <= 1) {
    return conflicts.length === 1
      ? "Something else is already on this calendar at that hour."
      : `${conflicts.length} other records are already on this calendar at that hour.`;
  }
  const dates = days === 1 ? "date" : "dates";
  return `${days} of the ${occurrenceCount} ${dates} already have something on the calendar at that hour.`;
}
