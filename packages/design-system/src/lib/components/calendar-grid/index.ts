/*
 * CalendarGrid is a family of four domain-free presentations over the same entry shape: a month, a
 * week, a day and an agenda. Two of them are TIME GRIDS — the Day, whose columns are the calendars
 * a reader turned on, and the Week, whose columns are its seven days — where an hour is a row and
 * every timed entry is a block from its start to its end. The month and the agenda put a civil DAY
 * in a cell and an entry in the day it is on, with no hour axis at all.
 *
 * The dual export — bare names (Month, Week, Day, Agenda) plus CalendarGrid-prefixed aliases — is
 * the house namespace shape (Card, Tabs, … follow it), so both `import * as CalendarGrid` then
 * <CalendarGrid.Month> and `import { CalendarGridMonth }` work.
 *
 * This is NOT the date picker: `calendar/` is a selection widget over Bits UI, where a day is a
 * value to choose. Here a day is a place entries sit, and nothing is selected.
 */
import Agenda from "./calendar-grid-agenda.svelte";
import Day from "./calendar-grid-day.svelte";
import Month from "./calendar-grid-month.svelte";
import Week from "./calendar-grid-week.svelte";

export {
  Agenda,
  Day,
  Month,
  Week,
  //
  Agenda as CalendarGridAgenda,
  Day as CalendarGridDay,
  Month as CalendarGridMonth,
  Week as CalendarGridWeek,
};
export type {
  CalendarGridColor,
  CalendarGridEntry,
  CalendarGridLane,
  CalendarGridTone,
} from "./types.ts";
export {
  DEFAULT_CONCURRENCY,
  MINIMUM_BLOCK_MINUTES,
  placeTimeEntries,
  timeSpanOf,
} from "./time-placement.ts";
export type { CalendarGridConcurrency, PlacedTimeEntry, TimeSpan } from "./time-placement.ts";
export { CALENDAR_COLORS, defaultCalendarColor, isCalendarColor } from "./colors.ts";
export {
  DEFAULT_FIRST_HOUR,
  DEFAULT_LAST_HOUR,
  HOURS_IN_DAY,
  MINUTES_IN_HOUR,
  SINGLE_LANE_KEY,
  dayHours,
  dayLanes,
  hourOf,
  hourSlots,
  inAllDayBand,
  laneOf,
  placeDayEntries,
  wallClockMinutes,
} from "./day-axis.ts";
export type { DayHours, DayPlacement } from "./day-axis.ts";
export {
  type CalendarGridWeekStart,
  type CivilDate,
  type PlacedEntry,
  dayOfWeek,
  daysOfWeek,
  formatCivilDate,
  formatCivilDateLong,
  formatHourOfDay,
  isSameCivilDay,
  parseCivilDate,
  placeEntries,
  weekdayNames,
  weeksOfMonth,
} from "./civil-date.ts";
