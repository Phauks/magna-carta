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

// Constructing an Intl.DateTimeFormat is the expensive part of every reading below, and the same
// handful of zones is read many times over in one request — a firm keeps deadlines in the zones of
// the courts it appears in, not in three hundred of them. The formatter is stateless once built, so
// caching it per zone is safe. The cache is per isolate and bounded by the zones a firm actually
// uses.
const formatterByTimeZone = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatterByTimeZone.get(timeZone);
  if (cached !== undefined) return cached;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  formatterByTimeZone.set(timeZone, formatter);
  return formatter;
}

// The wall-clock reading an instant has in a zone, as a civil date and a time. The one primitive
// everything else here is built on.
export interface ZonedReading {
  readonly civilDate: string; // YYYY-MM-DD
  readonly wallClockTime: string; // HH:MM
}

function partsAt(
  instantMilliseconds: number,
  timeZone: string,
): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  const parts = formatterFor(timeZone).formatToParts(new Date(instantMilliseconds));
  const read = (type: string): number => Number(parts.find((part) => part.type === type)?.value);
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    // Intl renders midnight as hour 24 in some runtimes; normalize so the arithmetic below is total.
    hour: read("hour") % 24,
    minute: read("minute"),
    second: read("second"),
  };
}

const pad = (value: number, width: number): string => String(value).padStart(width, "0");

export function zonedReading(instantMilliseconds: number, timeZone: string): ZonedReading {
  const parts = partsAt(instantMilliseconds, timeZone);
  return {
    civilDate: `${pad(parts.year, 4)}-${pad(parts.month, 2)}-${pad(parts.day, 2)}`,
    wallClockTime: `${pad(parts.hour, 2)}:${pad(parts.minute, 2)}`,
  };
}

// The offset, in minutes, that `timeZone` was at for a given instant. Derived by asking the runtime
// what wall-clock reading that instant has in the zone and differencing it against the same reading
// in UTC — which is the one way to get an offset that is correct across a daylight-saving boundary
// without shipping a zone database.
function offsetMinutesAt(instantMilliseconds: number, timeZone: string): number {
  const parts = partsAt(instantMilliseconds, timeZone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return Math.round((asUtc - instantMilliseconds) / 60_000);
}

const MILLISECONDS_PER_DAY = 86_400_000;

// A civil date plus a wall-clock time, read in a zone, as a UTC instant in milliseconds.
//
// CANDIDATES, THEN A ROUND TRIP — not a fixed number of passes. The offset depends on the instant and
// the instant depends on the offset, so the wall clock is combined with each offset the zone is at
// near that date (sampled a day either side, which straddles any transition since a transition shifts
// the clock by at most a couple of hours and there is never more than one in 48 hours). Each candidate
// is then RENDERED BACK: a candidate that reads as the wall clock asked for is a real occurrence of
// it, and one that does not is an artefact of pairing the clock with the wrong offset.
//
// That makes the two daylight-saving boundaries fall out rather than needing to be detected:
//
//   - Ordinary time — one candidate, it round-trips, done.
//   - The autumn REPEAT, when a wall clock happens twice — two candidates round-trip, and the FIRST
//     occurrence (the earlier instant) is taken, because resolving to the second would quietly extend
//     a deadline by an hour.
//   - The hour AFTER a fall-back, when the clock is unambiguous but the two offsets are both in play —
//     exactly one candidate round-trips, and it is the right one. Comparing passes and taking the
//     earlier instead resolved 02:14 PST to 01:14 PST: an hour before a time that exists perfectly
//     well, on a table whose whole job is saying when something is due.
//   - The spring GAP, a wall clock that never happened — NO candidate round-trips, and the LATEST is
//     taken, which is the instant the clock reached. Nothing is unrepresentable, and a time typed into
//     the gap never resolves to BEFORE the time somebody wrote down. (`assertWallClockTime` does not
//     refuse a skipped time: a hearing typed into the gap is somebody's typo about a real hearing, and
//     moving it forward keeps it on the right side of every deadline it is compared against.)
export function instantForCivilDateTime(
  civilDate: string,
  wallClockTime: string | null,
  timeZone: string,
): number {
  const [year, month, day] = civilDate.split("-").map(Number) as [number, number, number];
  const [hour, minute] =
    wallClockTime === null ? [0, 0] : (wallClockTime.split(":").map(Number) as [number, number]);
  const naive = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  const requested = `${pad(hour, 2)}:${pad(minute, 2)}`;

  const candidates = new Set<number>();
  for (const probe of [naive - MILLISECONDS_PER_DAY, naive, naive + MILLISECONDS_PER_DAY]) {
    candidates.add(naive - offsetMinutesAt(probe, timeZone) * 60_000);
  }

  let firstOccurrence: number | undefined;
  let latest: number | undefined;
  for (const candidate of candidates) {
    if (latest === undefined || candidate > latest) latest = candidate;
    if (zonedReading(candidate, timeZone).wallClockTime !== requested) continue;
    if (firstOccurrence === undefined || candidate < firstOccurrence) firstOccurrence = candidate;
  }
  // `latest` cannot be undefined: the candidate set always holds at least the naive pairing.
  return firstOccurrence ?? latest ?? naive;
}

// The instant a civil day ENDS in its own zone — the last millisecond of it. What a date with no
// recorded time means: a deadline due "on the 14th" with no time is not due at midnight, and
// rendering it that way would report a whole working day of deadlines as already missed.
//
// Expressed as "one millisecond before the next day began" rather than as a wall clock of 23:59, so
// it stays right in the zones whose daylight-saving transition happens AT midnight (America/Santiago
// and America/Havana have both done it): there, the next day begins at 01:00 local and the end of
// this one is 23:59:59.999 local, which is what the arithmetic above resolves the missing midnight to.
export function endOfCivilDayInstant(civilDate: string, timeZone: string): number {
  const [year, month, day] = civilDate.split("-").map(Number) as [number, number, number];
  const nextDay = new Date(Date.UTC(year, month - 1, day + 1));
  const nextCivilDate = nextDay.toISOString().slice(0, 10);
  return instantForCivilDateTime(nextCivilDate, "00:00", timeZone) - 1;
}
