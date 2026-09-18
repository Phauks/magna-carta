/*
 * How a recorded instant reads on a surface — the platform's one answer, used everywhere a stored
 * moment is shown to a person.
 *
 * Two rules govern this file and neither is negotiable:
 *
 *   1. A timestamp renders in the VIEWER'S LOCAL time. Instants are stored UTC; a person reading a
 *      history is asking when something happened to them, in the hours their own day is measured
 *      in, so the conversion happens here at render rather than anywhere upstream.
 *   2. NEVER elapsed time. "Just now", "2 hours ago" and their family are banned outright: they
 *      decay while the reader looks at them, they cannot be compared between two rows, and a
 *      record is a record. State the actual instant.
 *
 * Locale and time zone are options with the viewer's own as the default, so a firm-level display
 * setting can drive them later without any surface changing.
 *
 * This is the display of a moment in time. A DATE-ONLY value — a work date, a due date — is a
 * different question with a different answer (it is pinned to UTC so a calendar day never shifts
 * under the viewer's zone), and it lives beside this one in civil-date.ts.
 */

/**
 * An instant, in any of the forms a caller is likely to hold one: a `Date`, the UTC ISO string an
 * API returns, or epoch milliseconds.
 */
export type Instant = Date | string | number;

export interface InstantOptions {
  /** BCP-47 locale. Defaults to the runtime's own, which is what a viewer's browser reports. */
  locale?: string;
  /**
   * IANA time zone. Defaults to the viewer's own zone — that default is the point of the rule, so
   * pass this only where a caller genuinely needs a fixed zone (a deterministic test, a printed
   * sheet that must read the same everywhere).
   */
  timeZone?: string;
  /**
   * How fine the time of day reads. The minute is the default because that is the resolution a
   * record is about; `"second"` is for the handful of surfaces where the seconds are the subject —
   * a running clock, a capture that took twelve seconds — and it is a closed set rather than a
   * `timeStyle` passthrough so a caller cannot reintroduce a fourth way to print a moment.
   */
  precision?: "minute" | "second";
}

/** Parse an instant into a `Date`, or `null` when the value is not a readable instant. */
export function readInstant(at: Instant): Date | null {
  const date = at instanceof Date ? at : new Date(at);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * The instant as a reader sees it: an absolute date and time of day, in local time.
 *
 * An unreadable value renders as the raw text it arrived as. Showing what the data actually says
 * makes a bad instant visible as the defect it is, where a silent blank or a cheerful "Invalid
 * Date" would hide it.
 */
export function formatInstant(at: Instant, options: InstantOptions = {}): string {
  const date = readInstant(at);
  if (date === null) return String(at);
  return new Intl.DateTimeFormat(options.locale, {
    dateStyle: "medium",
    timeStyle: options.precision === "second" ? "medium" : "short",
    timeZone: options.timeZone,
  }).format(date);
}

/** How much of a date is written out. A closed set, so a caller cannot invent a sixth wording. */
export type InstantDateLength = "medium" | "long" | "full";

const DATE_PARTS: Readonly<Record<InstantDateLength, Intl.DateTimeFormatOptions>> = Object.freeze({
  /** "Sep 4, 2026" — a ledger row, a details pane. */
  medium: { year: "numeric", month: "short", day: "numeric" },
  /** "September 4, 2026" — a sentence, a printed sheet. */
  long: { year: "numeric", month: "long", day: "numeric" },
  /** "Friday, September 4, 2026" — a screen that greets somebody with their own day. */
  full: { weekday: "long", year: "numeric", month: "long", day: "numeric" },
});

/**
 * THE DATE HALF of an instant, in the viewer's own zone.
 *
 * Not the same function as `formatDate` in civil-date.ts, and the difference is the point: that one
 * takes a day the firm wrote down and pins it to UTC so it never moves; this one takes a MOMENT and
 * says which day it fell on where the reader is. A cost incurred on the 4th is the 4th everywhere;
 * a file uploaded at 23:40 in Boston was uploaded on a different day in Reno, and both are true.
 */
export function formatInstantDate(
  at: Instant,
  options: InstantOptions & { length?: InstantDateLength } = {},
): string {
  const date = readInstant(at);
  if (date === null) return String(at);
  return new Intl.DateTimeFormat(options.locale, {
    ...DATE_PARTS[options.length ?? "medium"],
    timeZone: options.timeZone,
  }).format(date);
}

/**
 * THE CLOCK HALF of an instant, in the viewer's own zone — "2:40 PM", or "2:40 PM PDT".
 *
 * For a surface where the day is already established and the time is the fact being added: an
 * upload batch's rows under a heading that names the day, a download tray of things that arrived
 * this session. Five surfaces wrote their own before this existed, in three different shapes.
 *
 * `zoneName` is for a stamp that leaves this machine — an exported sheet is read by somebody whose
 * clock is not the reader's, and a bare time of day on it is not a time to them.
 */
export function formatTimeOfDay(
  at: Instant,
  options: InstantOptions & { zoneName?: boolean } = {},
): string {
  const date = readInstant(at);
  if (date === null) return String(at);
  // The parts are built rather than spread from a ternary because `timeStyle` and the individual
  // hour/minute fields are mutually exclusive in Intl — supplying both throws, and a formatter that
  // throws on one option combination is a runtime failure nothing typechecks.
  const parts: Intl.DateTimeFormatOptions = { timeZone: options.timeZone };
  parts.hour = "numeric";
  parts.minute = "2-digit";
  if (options.precision === "second") parts.second = "2-digit";
  if (options.zoneName === true) parts.timeZoneName = "short";
  return new Intl.DateTimeFormat(options.locale, parts).format(date);
}

/**
 * The machine-readable form for a `<time datetime="…">` attribute — the UTC instant, so assistive
 * technology and any copy-out reads the same moment the display does. `undefined` where the value
 * is not a readable instant, which leaves the attribute off rather than writing a lie.
 */
export function instantAttribute(at: Instant): string | undefined {
  const date = readInstant(at);
  return date === null ? undefined : date.toISOString();
}

/**
 * A ZONE'S OWN SHORT NAME on a given day — "PST", "EDT", or the offset ("GMT+5:30") where the zone
 * has no letters of its own.
 *
 * It is here, in the display vocabulary, because it is a word a surface prints and there is exactly
 * one right way to print it; three surfaces each reaching for `formatToParts` is three answers to
 * one question, which is what this file exists to prevent.
 *
 * ON A DAY, AND THAT IS THE WHOLE SUBTLETY. An abbreviation is a fact about a zone AT A MOMENT: the
 * same zone is PST in January and PDT in July, so a control printing one of them all year would be
 * wrong for half of it. The caller passes the day its record falls on; today is the default, for a
 * surface that has no record in front of it yet.
 *
 * NOTHING IS EVER STORED FROM THIS. A record holds an IANA identifier; this is a rendering. An
 * abbreviation is ambiguous — CST is three different zones — and storing one is how a hearing moves
 * by an hour when the clocks change.
 */
export function formatTimeZoneAbbreviation(
  timeZone: string,
  on: Instant = new Date(),
  locale?: string,
): string {
  try {
    const parts = new Intl.DateTimeFormat(locale ?? "en-US", {
      timeZone,
      timeZoneName: "short",
    }).formatToParts(readInstant(on) ?? new Date());
    return parts.find((part) => part.type === "timeZoneName")?.value ?? timeZone;
  } catch {
    // A zone this runtime cannot resolve is shown as what it is, rather than as nothing.
    return timeZone;
  }
}

/**
 * A ZONE, DESCRIBED — every word a surface could print about one, worked out once.
 *
 * The record forms, the record panes, the print sheets and the offices table each printed a zone
 * in a shape of their own: "PST · America / Los Angeles" in one list beside "GMT+5:30 · Asia /
 * Kolkata" in the same list, "America / Los Angeles" at rest in the field that offered them, and a
 * bare identifier on a sheet (owner, 2026-09-18: "time zone formattings seem all different and
 * unstandardized"). A zone is one fact with four faces, and they are all here so no surface has to
 * assemble its own.
 *
 * ON A DAY, like the abbreviation above: the offset and the name are facts about a zone AT A MOMENT
 * — Los Angeles is eight hours behind UTC in January and seven in July, and its name changes with
 * them — so the caller passes the day its record falls on.
 *
 * The `offset` is stated against UTC rather than GMT, in the form every operating system's own
 * zone list uses ("UTC-08:00"), because "relative to the standard" is the one thing a person
 * choosing between three Central zones can check against a court's notice. The `place` is the
 * zone's own last segment, which is the city the identifier names and the word a person actually
 * types. The `abbreviation` is the short form the chips print, where the zone has letters of its
 * own, and the offset where it does not.
 */
export interface TimeZoneDescription {
  /** The IANA identifier, as stored. */
  readonly zone: string;
  /** "UTC-08:00", "UTC+05:30", "UTC+00:00": the offset from UTC on the day, always in this shape. */
  readonly offset: string;
  /** The same offset as minutes east of UTC, for ordering a list west to east. */
  readonly offsetMinutes: number;
  /** "PST", "EDT" — or the offset where the zone has no letters of its own. */
  readonly abbreviation: string;
  /** "Pacific Standard Time", "India Standard Time": the zone's own long name on the day. */
  readonly name: string;
  /** "Pacific Time": the name without its standard-or-daylight half, for finding a zone by. */
  readonly genericName: string;
  /** "Los Angeles", "Kolkata": the city the identifier names. */
  readonly place: string;
}

const MILLISECONDS_IN_DAY = 86_400_000;
const descriptionsByKey = new Map<string, TimeZoneDescription>();

/**
 * Describe a zone on a day. Cached per zone, day and locale: a list of every zone the runtime
 * knows is four hundred entries, and building four formatters for each on every keystroke is what
 * makes a field feel broken. The cache is bounded by the zones a surface actually lists.
 */
export function describeTimeZone(
  timeZone: string,
  on: Instant = new Date(),
  locale?: string,
): TimeZoneDescription {
  const date = readInstant(on) ?? new Date();
  // Keyed on the UTC day as a count of days, which is all that can change the answer.
  const day = Math.floor(date.getTime() / MILLISECONDS_IN_DAY);
  const key = `${locale ?? ""}|${timeZone}|${String(day)}`;
  const cached = descriptionsByKey.get(key);
  if (cached !== undefined) return cached;
  const described = buildTimeZoneDescription(timeZone, date, locale ?? "en-US");
  descriptionsByKey.set(key, described);
  return described;
}

function timeZoneNamePart(
  timeZone: string,
  date: Date,
  locale: string,
  style: "short" | "long" | "longGeneric" | "longOffset",
): string | null {
  try {
    const parts = new Intl.DateTimeFormat(locale, { timeZone, timeZoneName: style }).formatToParts(
      date,
    );
    return parts.find((part) => part.type === "timeZoneName")?.value ?? null;
  } catch {
    return null;
  }
}

/** "GMT-08:00", "GMT+5:30", "GMT" or "UTC" as the runtime prints it, read back as minutes east. */
function offsetMinutesOf(printed: string | null): number | null {
  if (printed === null) return null;
  if (/^(GMT|UTC)$/.test(printed)) return 0;
  const match = /^(?:GMT|UTC)([+-])(\d{1,2})(?::(\d{2}))?$/.exec(printed);
  if (match === null) return null;
  const sign = match[1] === "-" ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3] ?? "0"));
}

function offsetText(minutes: number): string {
  const sign = minutes < 0 ? "-" : "+";
  const magnitude = Math.abs(minutes);
  const hours = String(Math.floor(magnitude / 60)).padStart(2, "0");
  const rest = String(magnitude % 60).padStart(2, "0");
  return `UTC${sign}${hours}:${rest}`;
}

/** The city an identifier names: its last segment, spaces for underscores. "UTC" names itself. */
function placeOf(timeZone: string): string {
  const last = timeZone.split("/").at(-1) ?? timeZone;
  return last.replaceAll("_", " ");
}

function buildTimeZoneDescription(
  timeZone: string,
  date: Date,
  locale: string,
): TimeZoneDescription {
  const offsetMinutes = offsetMinutesOf(timeZoneNamePart(timeZone, date, locale, "longOffset"));
  const place = placeOf(timeZone);
  if (offsetMinutes === null) {
    // A zone this runtime cannot resolve is shown as what it is, rather than as nothing.
    return {
      zone: timeZone,
      offset: "",
      offsetMinutes: 0,
      abbreviation: timeZone,
      name: timeZone,
      genericName: timeZone,
      place,
    };
  }
  const offset = offsetText(offsetMinutes);
  const short = timeZoneNamePart(timeZone, date, locale, "short");
  // A short form the runtime spells as an offset ("GMT+5:30") is not letters of the zone's own,
  // so the standard offset stands in for it — one shape for every zone without a code.
  const abbreviation = short === null || offsetMinutesOf(short) !== null ? offset : short;
  const name = timeZoneNamePart(timeZone, date, locale, "long") ?? place;
  const generic = timeZoneNamePart(timeZone, date, locale, "longGeneric");
  return {
    zone: timeZone,
    offset,
    offsetMinutes,
    abbreviation,
    name: offsetMinutesOf(name) === null ? name : place,
    genericName: generic === null || offsetMinutesOf(generic) !== null ? name : generic,
    place,
  };
}

/**
 * THE ONE LINE A ZONE READS AS wherever it is printed in full: "(UTC-08:00) Pacific Standard Time ·
 * Los Angeles". The same shape for every zone on earth — offset, name, place — which is what lets
 * a list of them be read down, and what a field holding one shows at rest.
 */
export function formatTimeZone(
  timeZone: string,
  on: Instant = new Date(),
  locale?: string,
): string {
  const described = describeTimeZone(timeZone, on, locale);
  if (described.offset === "") return timeZone;
  return `(${described.offset}) ${described.name} · ${described.place}`;
}
