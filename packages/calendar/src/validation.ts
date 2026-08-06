import {
  CIVIL_DATE_PATTERN,
  MAX_CALENDAR_WINDOW_DAYS,
  MAX_DEADLINE_HORIZON_DAYS,
  WALL_CLOCK_TIME_PATTERN,
} from "./types.ts";
import { isResolvableTimeZone } from "./time-zone.ts";

// Every refusal this subsystem raises, as a code the route maps to a problem type. Codes — never
// messages — drive the mapping, so a message can be reworded without changing the contract.
export type CalendarValidationCode =
  // Shape refusals on a recorded row. The schema carries the same checks, so these exist to turn a
  // database abort into a named refusal a caller can act on rather than to be the only guard.
  | "calendar-empty-title"
  | "calendar-invalid-date"
  | "calendar-invalid-time"
  // An end before its start, or an end time on an event with no start time. "All day, until half
  // past four" is not a shape anybody can draw or act on.
  | "calendar-invalid-range"
  // A zone that no runtime can resolve. Validated at the WRITE, never at the read: a row that cannot
  // be rendered must not be storable, because the alternative is a hearing nobody can display and
  // nobody can correct without a migration.
  | "calendar-unknown-time-zone"
  // A participant whose kind names a column that is empty.
  | "calendar-invalid-participant"
  // A deadline sourced from the statutory catalog before any verified catalog exists. It stays a
  // distinct refusal from an ordinary shape failure because it is fixed differently — by a verified,
  // jurisdiction-keyed catalog being encoded, not by the caller rewriting the request.
  | "calendar-deadline-catalog-unavailable"
  // A deadline that cannot take the action asked of it: satisfying one already satisfied, vacating
  // or superseding without a reason, or acting on one already vacated or superseded.
  | "calendar-deadline-not-open"
  | "calendar-deadline-reason-required"
  // A satisfying or trigger event that belongs to a different matter. Naming one would put a
  // deadline's discharge on a case nobody could find it from.
  | "calendar-event-matter-mismatch"
  // A platform-origin catalog row whose name or code somebody tried to redefine. A firm deactivates
  // a platform type; it never changes what the type means for everybody else.
  | "calendar-platform-type-immutable"
  | "calendar-event-type-name-taken"
  | "calendar-event-type-code-taken"
  // The requested window or horizon is wider than a single read is allowed to be. A REFUSAL and
  // never a silent clamp: a caller that asked for three years and quietly received one cannot tell
  // that from a firm with nothing recorded in years two and three.
  | "calendar-window-too-wide"
  // Ordinary lookups.
  | "calendar-unknown-event"
  | "calendar-unknown-event-type"
  | "calendar-unknown-deadline"
  // A kind filter naming a source the registry does not carry. Refused rather than ignored: a
  // silently-dropped filter returns MORE than the caller asked for, which on a calendar spanning
  // every matter is the wrong direction to fail in.
  | "calendar-unknown-source";

export class CalendarValidationError extends Error {
  constructor(
    readonly code: CalendarValidationCode,
    message: string,
  ) {
    super(message);
    this.name = "CalendarValidationError";
  }
}

function refuse(code: CalendarValidationCode, message: string): never {
  throw new CalendarValidationError(code, message);
}

export function assertNonEmptyTitle(title: string): void {
  if (title.trim().length === 0) refuse("calendar-empty-title", "a title is required");
}

export function assertCivilDate(value: string, field: string): void {
  if (!CIVIL_DATE_PATTERN.test(value)) {
    refuse("calendar-invalid-date", `${field} must be a civil date of the form YYYY-MM-DD`);
  }
  // The pattern alone accepts 2026-02-30. A round trip through the calendar catches a rollover,
  // which matters here more than anywhere: a hearing recorded on a date that does not exist is one
  // nobody will be at.
  const [year, month, day] = value.split("-").map(Number) as [number, number, number];
  const roundTrip = new Date(Date.UTC(year, month - 1, day));
  if (
    roundTrip.getUTCFullYear() !== year ||
    roundTrip.getUTCMonth() !== month - 1 ||
    roundTrip.getUTCDate() !== day
  ) {
    refuse("calendar-invalid-date", `${field} is not a date on the calendar: ${value}`);
  }
}

export function assertWallClockTime(value: string | null | undefined, field: string): void {
  if (value === null || value === undefined) return;
  if (!WALL_CLOCK_TIME_PATTERN.test(value)) {
    refuse("calendar-invalid-time", `${field} must be a wall-clock time of the form HH:MM`);
  }
}

// A zone is an IANA identifier and never a fixed offset: an offset is wrong for half the year in
// every zone that observes daylight saving, which is the entire reason a zone is stored instead.
export function assertTimeZone(timeZone: string): void {
  if (!isResolvableTimeZone(timeZone)) {
    refuse(
      "calendar-unknown-time-zone",
      `${timeZone} is not a time zone this runtime can resolve; supply an IANA identifier such as America/Los_Angeles`,
    );
  }
}

// Whole days between two civil dates, inclusive of both ends — the unit both caps are expressed in.
export function inclusiveDayCount(fromDate: string, toDate: string): number {
  const from = Date.parse(`${fromDate}T00:00:00.000Z`);
  const to = Date.parse(`${toDate}T00:00:00.000Z`);
  return Math.floor((to - from) / 86_400_000) + 1;
}

export function assertCalendarWindow(fromDate: string, toDate: string): void {
  assertCivilDate(fromDate, "from");
  assertCivilDate(toDate, "to");
  if (toDate < fromDate) {
    refuse("calendar-invalid-range", "the window's end falls before its start");
  }
  const days = inclusiveDayCount(fromDate, toDate);
  if (days > MAX_CALENDAR_WINDOW_DAYS) {
    refuse(
      "calendar-window-too-wide",
      `a calendar window covers at most ${MAX_CALENDAR_WINDOW_DAYS} days; this one covers ${days}. Ask for a narrower window rather than a truncated answer.`,
    );
  }
}

export function assertDeadlineHorizon(fromDate: string, throughDate: string): void {
  assertCivilDate(fromDate, "from");
  assertCivilDate(throughDate, "through");
  if (throughDate < fromDate) {
    refuse("calendar-invalid-range", "the horizon's end falls before its start");
  }
  const days = inclusiveDayCount(fromDate, throughDate);
  if (days > MAX_DEADLINE_HORIZON_DAYS) {
    refuse(
      "calendar-window-too-wide",
      `a deadline horizon covers at most ${MAX_DEADLINE_HORIZON_DAYS} days; this one covers ${days}. Ask for a narrower horizon rather than a truncated answer.`,
    );
  }
}
