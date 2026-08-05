// Resolving a civil date plus an optional wall-clock time, in a named zone, to a UTC instant.
//
// This is the only arithmetic in the package that touches a calendar, and it is deliberately the
// only kind there is: it answers "when, in absolute terms, is nine in the morning on this date in
// this place". It NEVER derives a date from another date. There is no business-day arithmetic here,
// no holiday calendar, no service-method offset, and no chained recalculation — those are what a
// verified jurisdiction-keyed rule catalog would supply, and a wrong deadline computed from a rule
// is worse than no computed deadline at all, because it will be trusted precisely because it was
// computed.

// A zone the runtime can actually resolve. Checked by construction rather than against a shipped
// list: the list of IANA zones changes under us (zones are added, renamed, and merged), and the only
// question that matters is whether THIS runtime can render a date in it.
export function isResolvableTimeZone(timeZone: string): boolean {
  if (typeof timeZone !== "string" || timeZone.length === 0) return false;
  // A fixed offset is rejected even where a runtime accepts it: an offset is wrong for half the year
  // in every zone that observes daylight saving, and storing one is how a hearing moves by an hour
  // when the clocks change.
  if (/^[+-]\d{2}:?\d{2}$/.test(timeZone)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

// The offset, in minutes, that `timeZone` was at for a given instant. Derived by asking the runtime
// what wall-clock reading that instant has in the zone and differencing it against the same reading
// in UTC — which is the one way to get an offset that is correct across a daylight-saving boundary
// without shipping a zone database.
function offsetMinutesAt(instantMilliseconds: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instantMilliseconds));
  const read = (type: string): number => Number(parts.find((part) => part.type === type)?.value);
  // Intl renders midnight as hour 24 in some runtimes; normalize so the arithmetic below is total.
  const hour = read("hour") % 24;
  const asUtc = Date.UTC(
    read("year"),
    read("month") - 1,
    read("day"),
    hour,
    read("minute"),
    read("second"),
  );
  return Math.round((asUtc - instantMilliseconds) / 60_000);
}

// A civil date plus a wall-clock time, read in a zone, as a UTC instant in milliseconds.
//
// Two passes rather than one: the offset depends on the instant, and the instant depends on the
// offset. Guessing UTC first and then re-deriving with the offset that guess landed in converges for
// every real zone, because zone offsets change by at most a couple of hours and never oscillate
// within that distance.
//
// The two genuinely ambiguous cases are the daylight-saving boundaries, and both resolve the way a
// person reading a docket expects: a wall-clock time that occurs twice (the autumn repeat) resolves
// to the FIRST occurrence, the earlier instant, so a deadline is not quietly extended by an hour; a
// wall-clock time that never occurs at all (the spring skip) resolves to the instant the clock
// reached instead, so nothing is ever unrepresentable.
export function instantForCivilDateTime(
  civilDate: string,
  wallClockTime: string | null,
  timeZone: string,
): number {
  const [year, month, day] = civilDate.split("-").map(Number) as [number, number, number];
  const [hour, minute] =
    wallClockTime === null ? [0, 0] : (wallClockTime.split(":").map(Number) as [number, number]);
  const naive = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  const firstPass = naive - offsetMinutesAt(naive, timeZone) * 60_000;
  const secondPass = naive - offsetMinutesAt(firstPass, timeZone) * 60_000;
  // On a repeated wall-clock hour the two passes disagree; the earlier instant is the first
  // occurrence, which is the reading a deadline has to take.
  return Math.min(firstPass, secondPass);
}

// The instant a civil day ENDS in its own zone — the last millisecond of it. What a date with no
// recorded time means: a deadline due "on the 14th" with no time is not due at midnight, and
// rendering it that way would report a whole working day of deadlines as already missed.
export function endOfCivilDayInstant(civilDate: string, timeZone: string): number {
  const [year, month, day] = civilDate.split("-").map(Number) as [number, number, number];
  const nextDay = new Date(Date.UTC(year, month - 1, day + 1));
  const nextCivilDate = nextDay.toISOString().slice(0, 10);
  return instantForCivilDateTime(nextCivilDate, "00:00", timeZone) - 1;
}
