/*
 * The timed entries a day's hour axis holds: the ones that start AND end on that day.
 *
 * This module used to cut a timed entry that ran past midnight into a piece per day — the start
 * hour to midnight, a whole column in the middle, midnight to the end hour — so a Monday-to-
 * Wednesday trial showed on Tuesday. It showed as the whole of Tuesday, and where the day drew only
 * its working hours the piece ran from before the first row to after the last, which is what the
 * owner met (2026-09-18: "multi-day events expand above and below the actual calendar"; "multi-day
 * events actually render in the whole calendar, rather than in the all-day area above"). A span is
 * a fact about days, so it now reads in the band above the hours (`inAllDayBand`, day-axis.ts),
 * spanning its days there exactly as the month spans it, with its hours on the chip as text. What
 * is left for the axis is what the axis is for: a thing that begins and ends within the day.
 *
 * CIVIL DAYS, NEVER INSTANTS — the rule the whole grid keeps. A day holds an entry whose `date` is
 * that day; nothing here converts a zone.
 */
import type { CalendarDate } from "@internationalized/date";
import { formatCivilDate } from "./civil-date.ts";
import { inAllDayBand } from "./day-axis.ts";
import type { CalendarGridEntry } from "./types.ts";

/**
 * The entries the hour axis draws on a day: timed, on that day, and not running past it. Anything
 * the band above the hours holds is left to the band; a date that does not read as one is skipped.
 */
export function timedEntriesOn(
  entries: readonly CalendarGridEntry[],
  day: CalendarDate,
): CalendarGridEntry[] {
  const key = formatCivilDate(day);
  return entries.filter((entry) => entry.date === key && !inAllDayBand(entry));
}
