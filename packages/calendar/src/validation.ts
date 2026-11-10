import { CIVIL_DATE_PATTERN, isCivilDate } from "@magna-carta/civil-time/civil-date";
import { isResolvableTimeZone } from "@magna-carta/civil-time/time-zone";
import { isWallClockTime } from "@magna-carta/civil-time/wall-clock";
import { MAX_CALENDAR_WINDOW_DAYS, MAX_DEADLINE_HORIZON_DAYS } from "./types.ts";

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
  // A repeat rule this platform could not have written. Read with the same grammar the record form
  // writes (@magna-carta/civil-time/recurrence), so a rule the form can produce is one this accepts
  // — and a rule from elsewhere that the form could not present is refused rather than stored as a
  // series nobody can see the end of.
  | "calendar-invalid-recurrence"
  // A change to one day of a series asked of an event that is not a series this platform can read,
  // of a day the series never falls on, or of a day somebody already changed — in which case the
  // event standing in for that day is what gets edited.
  | "calendar-not-a-series"
  | "calendar-not-an-occurrence"
  | "calendar-occurrence-already-changed"
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
  // A catalog type from the wrong scope: the two scopes share one catalog and its category column is
  // the only thing separating them, so a firm meeting typed "Hearing" would read as procedural
  // history everywhere the category is what a surface groups by.
  | "calendar-event-type-category-mismatch"
  // The requested window or horizon is wider than a single read is allowed to be. A REFUSAL and
  // never a silent clamp: a caller that asked for three years and quietly received one cannot tell
  // that from a firm with nothing recorded in years two and three.
  | "calendar-window-too-wide"
  // The window is legal but the resource is too densely booked inside it for the answer to be
  // accurate. Distinct from the width refusal above and fixed the same way — ask for less — but the
  // reason differs: availability reports which bookings overlap which, and that pairing is computed
  // over the rows one read returned. Truncating would not shorten the answer, it would drop
  // conflicts, and a dropped conflict reads as a free room.
  | "calendar-availability-window-too-dense"
  // A booking against a resource that has been deactivated. Existing bookings keep resolving; new
  // ones are refused, which is what soft-deactivation means.
  | "calendar-resource-inactive"
  // A resource name the firm already uses. Two rooms called the same thing are one room nobody can
  // book on purpose.
  | "calendar-resource-name-taken"
  // A continuance asked of an event that cannot take one: it is already cancelled, or it already
  // has a successor. The partial unique index would refuse the second anyway; the service refuses
  // first with a name.
  | "calendar-event-not-continuable"
  // A second related link between the same pair of events, in either direction. Refused by the
  // service rather than the schema, because directionality makes a schema-level uniqueness
  // statement more subtle than the fact deserves.
  | "calendar-duplicate-link"
  // A continuance link addressed through the general link routes. Only the continuance operation
  // mints one, and nothing deletes one: the chain is history.
  | "calendar-continuance-link-immutable"
  // A continuance chain deeper than the walk's bound — corrupt data, not a hearing anybody
  // continued a hundred times.
  | "calendar-continuance-chain-too-deep"
  // Ordinary lookups.
  | "calendar-unknown-event"
  | "calendar-unknown-event-type"
  | "calendar-unknown-deadline"
  | "calendar-unknown-firm-event"
  | "calendar-unknown-resource"
  | "calendar-unknown-booking"
  | "calendar-unknown-link"
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

// The shape check is `isCivilDate`, which also rules out a day that does not exist — 2026-02-30
// matches the pattern perfectly well, and a hearing recorded on it is one nobody will be at. The
// refusal is split in two so each says which of the two things is wrong.
export function assertCivilDate(value: string, field: string): void {
  if (!CIVIL_DATE_PATTERN.test(value)) {
    refuse("calendar-invalid-date", `${field} must be a civil date of the form YYYY-MM-DD`);
  }
  if (!isCivilDate(value)) {
    refuse("calendar-invalid-date", `${field} is not a date on the calendar: ${value}`);
  }
}

export function assertWallClockTime(value: string | null | undefined, field: string): void {
  if (value === null || value === undefined) return;
  if (!isWallClockTime(value)) {
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
