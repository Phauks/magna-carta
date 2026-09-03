/*
 * CalendarGrid is a family of three domain-free presentations over the same entry shape: a month,
 * a week and an agenda. The dual export — bare names (Month, Week, Agenda) plus CalendarGrid-
 * prefixed aliases — is the house namespace shape (Card, Tabs, … follow it), so both
 * `import * as CalendarGrid` then <CalendarGrid.Month> and `import { CalendarGridMonth }` work.
 *
 * This is NOT the date picker: `calendar/` is a selection widget over Bits UI, where a day is a
 * value to choose. Here a day is a place entries sit, and nothing is selected.
 */
import Agenda from "./calendar-grid-agenda.svelte";
import Month from "./calendar-grid-month.svelte";
import Week from "./calendar-grid-week.svelte";

export {
  Agenda,
  Month,
  Week,
  //
  Agenda as CalendarGridAgenda,
  Month as CalendarGridMonth,
  Week as CalendarGridWeek,
};
export type { CalendarGridEntry, CalendarGridTone } from "./types.ts";
export {
  type CalendarGridWeekStart,
  type CivilDate,
  type PlacedEntry,
  dayOfWeek,
  daysOfWeek,
  formatCivilDate,
  formatCivilDateLong,
  isSameCivilDay,
  parseCivilDate,
  placeEntries,
  weekdayNames,
  weeksOfMonth,
} from "./civil-date.ts";
