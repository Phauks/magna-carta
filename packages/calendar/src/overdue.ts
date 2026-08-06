import {
  endOfCivilDayInstant,
  instantForCivilDateTime,
  isResolvableTimeZone,
  zonedReading,
} from "./time-zone.ts";

// Overdue is a COMPARISON, not a column. Nothing in this package writes it, no sweep maintains it,
// and no state transition records it.
//
// Three reasons, and the third decides it. A stored flag needs a per-firm sweep to maintain, which
// is machinery for a fact that is a subtraction. A stored flag can be WRONG — stale by up to the
// sweep interval — where a comparison cannot. And a platform that writes "missed" onto a firm's
// record has made an assertion about that firm's conduct it is not in a position to make: the
// deadline may have been extended by a stipulation nobody has typed in yet, satisfied by a filing
// recorded under another matter, or vacated by an order that arrived this morning. The platform
// reports what it can see. It does not adjudicate.

export interface DeadlineDueFacts {
  readonly dueOn: string; // civil date, YYYY-MM-DD
  readonly dueAtTime: string | null; // wall clock, HH:MM; null means "by the end of that day"
  readonly timeZone: string; // IANA identifier — the COURT'S zone, not the office's
  readonly state: string;
}

// The absolute instant a deadline falls due, in its own zone. A deadline with no recorded time is
// due at the END of its day rather than at its midnight: a filing deadline whose hour nobody wrote
// down is not missed at one minute past midnight, and reporting it that way would flag a whole day's
// worth of live deadlines as overdue every night.
export function dueInstantMilliseconds(deadline: DeadlineDueFacts): number {
  return deadline.dueAtTime === null
    ? endOfCivilDayInstant(deadline.dueOn, deadline.timeZone)
    : instantForCivilDateTime(deadline.dueOn, deadline.dueAtTime, deadline.timeZone);
}

// Overdue: still open, and its due instant has passed. A satisfied, vacated, or superseded deadline
// is never overdue however old it is — the firm dealt with it, and a list that kept reporting it
// would be a list nobody reads.
export function isOverdue(deadline: DeadlineDueFacts, now: string): boolean {
  if (deadline.state !== "open") return false;
  const nowMilliseconds = Date.parse(now);
  if (Number.isNaN(nowMilliseconds)) return false;
  return dueInstantMilliseconds(deadline) < nowMilliseconds;
}

// ---- the same comparison, expressed as a bound a query can carry ----
//
// A list filtered to "overdue" has to narrow IN SQL. Post-filtering the rows a page returns
// under-fills the page, makes the next cursor mean something different from page to page, and turns
// the page size into an existence oracle for the rows it removed — the same reasoning that puts the
// visibility predicate in the WHERE clause rather than in the Worker.
//
// But SQLite has no zone database, so `due_on <= <today in UTC>` is only an APPROXIMATION of the
// predicate above: at 11:00Z a deadline due today in America/Los_Angeles with no recorded time is not
// due for another twenty hours, and that approximation reports it as already missed — precisely the
// failure `endOfCivilDayInstant` exists to prevent one row at a time.
//
// So the bound is composed PER ZONE instead, and it is EXACT rather than a superset — the same answer
// `isOverdue` gives, expressed as ordinary text comparison on the two columns the row already carries.
// The two kinds of row take different bounds because they mean different things:
//
//   no recorded time -> due at the END of its day, so overdue exactly when its date is strictly
//                       before the zone's CURRENT civil date (the day it names has finished)
//   a recorded time  -> overdue exactly when its (date, time) is at or below the latest already-past
//                       wall clock in that zone, because the instant a wall clock resolves to never
//                       decreases as the clock advances
export interface OverdueCutoff {
  readonly timeZone: string;
  // The zone's civil date at `now`. An untimed deadline is overdue exactly when its date is before it.
  readonly currentCivilDate: string; // YYYY-MM-DD
  // The latest wall clock in this zone whose instant is already past. A timed deadline is overdue
  // exactly when its (date, time) is at or below this pair. It is NOT always the current reading:
  // inside a repeated autumn hour it runs ahead of the clock (at 01:15 for the second time, a
  // deadline set for 01:30 fell due forty-five minutes ago), and at the top of a minute it falls one
  // minute behind.
  readonly timedCivilDate: string; // YYYY-MM-DD
  readonly timedWallClockTime: string; // HH:MM
}

// How far past `now`'s own reading the search for the cutoff looks. A daylight-saving transition
// shifts a clock by at most two hours, and during the hour a fall-back REPEATS, the latest already-
// past wall clock is up to that far ahead of what the clock currently reads: at 01:15 for the second
// time, a deadline set for 01:30 fell due forty-five minutes ago even though the clock says 01:15.
// Three hours is that bound with room to spare, and the search is a binary one, so the width costs
// one extra probe rather than one extra minute.
const CUTOFF_SEARCH_MINUTES = 180;

// The bound for one zone. Binary search rather than arithmetic for the timed half, because the wall
// clock is NOT monotonic in the instant across a transition, while the instant IS non-decreasing in
// the wall clock — which is exactly the direction a binary search needs, and the property that makes
// the SQL comparison exact rather than approximate.
export function overdueCutoffFor(timeZone: string, now: string): OverdueCutoff | undefined {
  const nowMilliseconds = Date.parse(now);
  if (Number.isNaN(nowMilliseconds)) return undefined;
  // A zone the runtime cannot resolve yields no bound rather than an exception. It is refused at the
  // write, so a row carrying one predates that check; leaving it out of the narrowing keeps it off an
  // overdue list rather than putting a date the platform cannot read onto one.
  if (!isResolvableTimeZone(timeZone)) return undefined;
  const reading = zonedReading(nowMilliseconds, timeZone);
  const base = Date.UTC(
    Number(reading.civilDate.slice(0, 4)),
    Number(reading.civilDate.slice(5, 7)) - 1,
    Number(reading.civilDate.slice(8, 10)),
    Number(reading.wallClockTime.slice(0, 2)),
    Number(reading.wallClockTime.slice(3, 5)),
  );
  const hasPassed = (offsetMinutes: number): boolean => {
    const candidate = readingAt(base, offsetMinutes);
    return (
      instantForCivilDateTime(candidate.civilDate, candidate.wallClockTime, timeZone) <
      nowMilliseconds
    );
  };
  // `hasPassed` is true for every offset below the cutoff and false above it — the instant a wall
  // clock resolves to never decreases as the clock advances — so one binary search over the window
  // finds it in eight probes. The window opens BELOW zero as well as above: inside a spring gap the
  // clock's own current reading resolves forward to the transition, which is not yet past.
  let low = -CUTOFF_SEARCH_MINUTES;
  let high = CUTOFF_SEARCH_MINUTES;
  if (!hasPassed(low)) return undefined;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (hasPassed(middle)) low = middle;
    else high = middle - 1;
  }
  const cutoff = readingAt(base, low);
  return {
    timeZone,
    currentCivilDate: reading.civilDate,
    timedCivilDate: cutoff.civilDate,
    timedWallClockTime: cutoff.wallClockTime,
  };
}

// A civil date-and-time `offsetMinutes` away from a base reading, walked as wall clock rather than as
// an instant — the search above moves along the CLOCK, not along the timeline.
function readingAt(
  baseAsUtc: number,
  offsetMinutes: number,
): { civilDate: string; wallClockTime: string } {
  const moved = new Date(baseAsUtc + offsetMinutes * 60_000).toISOString();
  return { civilDate: moved.slice(0, 10), wallClockTime: moved.slice(11, 16) };
}
