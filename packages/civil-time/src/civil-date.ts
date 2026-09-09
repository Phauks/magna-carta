/*
 * WHAT A CIVIL DATE IS — the calendar day the firm wrote down, and the whole of the arithmetic the
 * platform performs on one.
 *
 * A civil date is `YYYY-MM-DD` and nothing else. It carries no time, no zone, and no offset: a cost
 * incurred on the 14th was incurred on the 14th in Reno and in Boston, and the moment that day began
 * is a different question that `time-zone.ts` answers when somebody asks it.
 *
 * This module exists because the shape had been written out forty times. The pattern alone appeared
 * in more than thirty files as a bare literal, and the two places that ALSO checked the day is a day
 * on the calendar (packages/notes and packages/tasks) carried the same fourteen lines of round trip
 * word for word. Both of those are the kind of copy that reads fine until one of them is corrected:
 * a validator that accepts 2026-02-30 in one subsystem and refuses it in another is a defect nobody
 * finds until a row exists that cannot be rendered.
 *
 * WHAT IS DELIBERATELY NOT HERE. No business-day rule, no holiday calendar, no service-method offset,
 * and no derivation of one deadline from another. That boundary is the calendar package's and this
 * package inherits it: a computed date that is wrong gets trusted precisely because it was computed.
 * `addCalendarDays` is plain day counting and is the whole of the arithmetic on offer.
 *
 * HOW A CIVIL DATE READS to a person is a different question with a different home — the design
 * system's formatters (packages/design-system/src/lib/formatters/civil-date.ts), which pin the day to
 * UTC so it never shifts under the reader's zone. Shape lives here; display lives there; neither
 * borrows the other's job.
 */
import { CANONICAL_INSTANT_PATTERN, type CanonicalInstant } from "./instant.ts";
import { CivilTimeArgumentError, requireCivilDate, requireInstant } from "./refuse.ts";

/** A civil date: the calendar day a record names, as `YYYY-MM-DD`. */
export type CivilDate = string;

/**
 * The one civil-date shape in the platform, and the one every zod schema and hand-written guard
 * spells through.
 *
 * NO FLAGS, and `u` in particular. These patterns are handed to zod at route boundaries and the
 * OpenAPI emitter writes the regex INCLUDING ITS FLAGS into the JSON Schema `pattern`, so a `u`
 * here ships `"^\\d{4}-\\d{2}-\\d{2}$/u"` to every client generator — a pattern that matches
 * nothing. The flag also buys nothing: `\d` is ASCII either way.
 */
export const CIVIL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** The parts of a civil date, as numbers. Only meaningful for a value `isCivilDate` accepts. */
export interface CivilDateParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

/**
 * Split a civil date into its numeric parts.
 *
 * Refuses anything that is not the shape rather than parsing it. This used to assume the shape and
 * hand back `{ year: 2026, month: 9, day: NaN }` for a stored instant — silently, because every
 * field is still a number — and the NaN then travelled into whatever was built on it. refuse.ts
 * says why the check is here at runtime rather than in the type.
 */
export function civilDateParts(civilDate: CivilDate): CivilDateParts {
  const [year, month, day] = requireCivilDate(civilDate, "civilDateParts", "the civil date")
    .split("-")
    .map(Number) as [number, number, number];
  return { year, month, day };
}

/** Build a civil date from numeric parts, zero-padded. */
export function civilDateFromParts({ year, month, day }: CivilDateParts): CivilDate {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * The UTC `Date` a set of civil parts names — the one construction every piece of arithmetic here
 * goes through.
 *
 * `Date.UTC` is not called directly anywhere in this module, and this function is the reason:
 * `Date.UTC(50, 0, 1)` is 1950, not the year 50. That two-digit mapping is a legacy of the original
 * constructor and it silently rewrites any year under 100 — which turns a round-trip check into a
 * check that rejects perfectly ordinary dates, and turns day arithmetic near the year 99 into
 * nonsense. `setUTCFullYear` sets the year it is given.
 */
function utcDateFor({ year, month, day }: CivilDateParts): Date {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

/**
 * Whether a value is a civil date THAT EXISTS.
 *
 * Two checks, because the pattern alone is not enough: `/^\d{4}-\d{2}-\d{2}$/` accepts 2026-02-30 and
 * 2026-13-01 perfectly happily. A round trip through the calendar catches the rollover — the runtime
 * turns the 30th of February into the 2nd of March, and a date that comes back as a different day was
 * never a day.
 *
 * The round trip is done in UTC on purpose. The inputs have no zone, so a UTC construction is pure
 * calendar arithmetic; using a named zone here would let a daylight-saving transition into a question
 * that has nothing to do with clocks.
 */
export function isCivilDate(value: unknown): value is CivilDate {
  if (typeof value !== "string" || !CIVIL_DATE_PATTERN.test(value)) return false;
  // Year 0000 is excluded by name. It round-trips in V8 as the astronomical year zero, engines
  // differ on it, and it is no date any record here is about — the ledger's own validator carried
  // this rule alone for a long time and it belongs to the shape, not to one subsystem.
  if (value.startsWith("0000")) return false;
  const parts = civilDateParts(value);
  return civilDateOf(utcDateFor(parts)) === value;
}

/**
 * The civil date an instant has IN UTC.
 *
 * This is the platform's stated meaning of an undated "today" — the day the server's clock is on,
 * with no zone read into it. It replaces `new Date().toISOString().slice(0, 10)`, which said the same
 * thing in twenty places and said it as a string operation, so nothing could find it and nothing
 * could correct it.
 *
 * Where a reader's OWN day is what is wanted — is this task overdue for the person looking at it —
 * that is a zoned question and `zonedReading` in time-zone.ts is the function for it. The two are not
 * interchangeable and the difference is a day. To DISPLAY the day a moment fell on, neither of these
 * is the answer: that is `formatInstantDate` in the design system, which reads in the viewer's zone.
 *
 * Takes a stored instant as a string too, because that is the form most callers hold one in and the
 * alternative was `someInstant.slice(0, 10)` — which is what four surfaces shipped a UTC-day bug as.
 */
export function civilDateOf(instant: Date | number | CanonicalInstant): CivilDate {
  // A canonical instant is ALREADY this string with a time on the end, so the day is the first ten
  // characters and there is nothing to parse. The overload exists so that the twenty-odd places
  // that legitimately want the UTC day of a stored instant can say so by name instead of slicing —
  // a slice is invisible to every scan, and the four display bugs that shipped were written as one.
  // The shape is checked rather than assumed, so a value that is not an instant fails here saying
  // what it is instead of returning ten characters of something else.
  if (typeof instant === "string") {
    if (!CANONICAL_INSTANT_PATTERN.test(instant)) {
      throw new CivilTimeArgumentError(
        `civilDateOf: the instant "${instant}" is not a stored instant (the exact form ` +
          "toISOString emits). A day already in hand needs no conversion; anything else is parsed " +
          "where it arrives, so the failure names the field.",
      );
    }
    return instant.slice(0, 10);
  }
  return new Date(requireInstant(instant, "civilDateOf", "the instant")).toISOString().slice(0, 10);
}

/**
 * The day of a value that is EITHER a stored instant or a civil date already.
 *
 * For the federated timeline, whose sources declare their time column as one or the other
 * (`TimeColumnShape` in @magna-carta/calendar) and whose sort key is therefore genuinely
 * dual-shaped. A caller that knows which it holds should say so with `civilDateOf`; this is for the
 * one that legitimately does not.
 *
 * Named rather than left as `value.slice(0, 10)` — which is what it replaced, and which is
 * indistinguishable at a glance from the bug that takes the UTC day of an instant and shows it to a
 * reader. Being unable to tell those apart is the whole reason this function has a name.
 */
export function civilDayOf(instantOrDay: CanonicalInstant | CivilDate): CivilDate {
  if (CIVIL_DATE_PATTERN.test(instantOrDay)) return instantOrDay;
  return civilDateOf(instantOrDay);
}

/**
 * Today in UTC. `now` is injectable so a test states the day it means rather than depending on when
 * the suite runs.
 */
export function todayInUtc(now: Date | number = Date.now()): CivilDate {
  return civilDateOf(now);
}

/**
 * A whole number of CALENDAR days added to a civil date.
 *
 * Not a business-day rule, not a docketing rule, and not aware of any jurisdiction: it will land a
 * date on a Sunday or on Christmas Day, and that is the honest behaviour. A person moves such a date
 * in a second; a template cannot know to.
 *
 * Computed in UTC for the reason `isCivilDate` is: both ends are zoneless, so a UTC round trip is day
 * counting and a named zone would drag a daylight-saving transition into it.
 */
export function addCalendarDays(civilDate: CivilDate, days: number): CivilDate {
  const { year, month, day } = civilDateParts(
    requireCivilDate(civilDate, "addCalendarDays", "the civil date"),
  );
  return civilDateOf(utcDateFor({ year, month, day: day + days }));
}

/**
 * The last day of a month, as a civil date. `month` is 1-based, as it is written.
 *
 * Day 0 of the following month is the last day of this one — the one place in this module where the
 * runtime's own rollover is used deliberately rather than guarded against.
 */
export function endOfCivilMonth(year: number, month: number): CivilDate {
  return civilDateOf(utcDateFor({ year, month: month + 1, day: 0 }));
}
