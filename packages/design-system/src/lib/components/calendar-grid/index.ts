/*
 * CalendarGrid is a family of four domain-free presentations over the same entry shape: a month, a
 * week, a day and an agenda. The Day is the one with a time axis — the other three put a civil DAY
 * in a column and an entry in the day it is on; the Day puts an HOUR in a row and a calendar in a
 * column, which is how a firm reads a day its people spend in four places at once.
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
