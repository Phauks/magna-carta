/*
 * A setting that repeats: the rule a person answers, the RFC 5545 line it is stored as, and the
 * civil days it falls on inside a window.
 *
 * ONE ROW, EXPANDED AT READ TIME. A weekly status conference is one record with a rule, not
 * fifty-two records. Storing an occurrence per date would multiply a firm's calendar by the length
 * of its longest series before anybody looked at it, and would make "move the series" fifty-two
 * writes. The reads expand across the window they were asked for, which is a year at most (the
 * platform's own cap), so the work is bounded by what is on screen rather than by how far a rule
 * runs.
 *
 * THE RULE IS A TYPED ANSWER, AND RFC 5545 IS ITS STORAGE. A person chooses "every second Tuesday,
 * twelve times"; the column holds `FREQ=WEEKLY;INTERVAL=2;BYDAY=TU;COUNT=12`. The standard is used
 * because it is the one every calendar product reads and writes, and a firm exporting its calendar
 * should not find this product's private dialect in it. What the FORM offers is deliberately
 * narrower than what the standard allows — see `parseRecurrence`, which returns null for a rule it
 * cannot present honestly rather than half-showing it.
 *
 * CIVIL DATES, NEVER INSTANTS. A weekly nine o'clock setting is nine o'clock on both sides of a
 * daylight-saving change, which is true only because the expansion walks CIVIL DAYS and the wall
 * clock rides along untouched. Expanding over instants would move half a firm's Tuesdays by an hour
 * twice a year. This is the same rule the grid keeps, for the same reason.
 *
 * NOTHING HERE GENERATES DEADLINES. A recurring event is not a docketing rule; rules-based
 * docketing computes dates from authority and is its own subsystem.
 *
 * IT LIVES HERE, NOT IN EITHER CONSUMER, because both sides have to agree about it: the record form
 * writes a rule and the calendar service has to refuse one it could not have written. The web app
 * does not depend on `@magna-carta/calendar` (a backend package carrying SQL), so a grammar held in
 * either one would have to be copied into the other — and two readings of "what is a valid rule"
 * disagree the first time one of them is corrected. A recurrence rule is a statement about civil
 * dates and nothing else, which is what this package is for.
 */
import {
  addCalendarDays,
  civilDateFromParts,
  civilDateParts,
  endOfCivilMonth,
  isCivilDate,
  type CivilDate,
} from "./civil-date.ts";

/** How often a setting repeats. A closed set: what the form can ask and read back. */
export type RecurrenceFrequency = "daily" | "weekly" | "monthly" | "yearly";

/** Which day of the week, as RFC 5545 spells them. Sunday first, as the weekday helpers order. */
export const WEEKDAY_CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;
export type WeekdayCode = (typeof WEEKDAY_CODES)[number];

/** How a monthly rule picks its day: the date of the month, or the weekday-of-month it started on. */
export type MonthlyMode = "byDate" | "byWeekday";

/** When a series stops. */
export type RecurrenceEnd =
  | { readonly kind: "never" }
  | { readonly kind: "after"; readonly count: number }
  | { readonly kind: "on"; readonly date: string };

/** The rule a person answered, which is what the form edits and what the expansion walks. */
export interface RecurrenceRule {
  readonly frequency: RecurrenceFrequency;
  /** Every Nth day, week, month or year. One unless somebody said otherwise. */
  readonly interval: number;
  /**
   * The weekdays a WEEKLY rule falls on. Empty means "the day the series starts on", which is what
   * somebody choosing Weekly and nothing else means; every other frequency ignores it.
   */
  readonly weekdays: readonly WeekdayCode[];
  /** How a MONTHLY rule picks its day. Ignored by the other three. */
  readonly monthly: MonthlyMode;
  readonly end: RecurrenceEnd;
}

/** The rule a form opens on: every week, on the day the setting starts, forever. */
export function weeklyRecurrence(): RecurrenceRule {
  return {
    frequency: "weekly",
    interval: 1,
    weekdays: [],
    monthly: "byDate",
    end: { kind: "never" },
  };
}

/** How many occurrences one expansion will ever return, however long the rule runs. */
export const MAX_OCCURRENCES = 400;

/** The longest `COUNT` the form offers, and the largest one a stored rule is believed at. */
export const MAX_COUNT = 730;

/** The largest interval the form offers. Beyond this a person means a different frequency. */
export const MAX_INTERVAL = 52;

// ---- reading and writing the stored line -------------------------------------------------------

const FREQUENCY_CODES: Record<RecurrenceFrequency, string> = {
  daily: "DAILY",
  weekly: "WEEKLY",
  monthly: "MONTHLY",
  yearly: "YEARLY",
};

/**
 * The rule as the column holds it. Parts are written in the order RFC 5545 lists them, and a part
 * that says nothing is left out — so the common rule is the short line a person could read.
 */
export function formatRecurrence(rule: RecurrenceRule): string {
  const parts = [`FREQ=${FREQUENCY_CODES[rule.frequency]}`];
  if (rule.interval > 1) parts.push(`INTERVAL=${rule.interval}`);
  if (rule.frequency === "weekly" && rule.weekdays.length > 0) {
    parts.push(`BYDAY=${[...rule.weekdays].toSorted(byWeekdayOrder).join(",")}`);
  }
  if (rule.frequency === "monthly" && rule.monthly === "byWeekday") parts.push("BYSETPOS=BYDAY");
  if (rule.end.kind === "after") parts.push(`COUNT=${rule.end.count}`);
  if (rule.end.kind === "on") parts.push(`UNTIL=${rule.end.date.replaceAll("-", "")}`);
  return parts.join(";");
}

/**
 * The rule a stored line describes, or null where this product cannot present it honestly.
 *
 * NULL IS A REAL ANSWER and the surfaces treat it as one: a rule written by another calendar with
 * parts the form cannot show — `BYMONTHDAY`, `BYSETPOS` with a real position, a second-level
 * frequency — is not half-rendered as something it is not. The event still reads and still paints;
 * it simply does not offer to edit a rule it would silently rewrite.
 */
export function parseRecurrence(line: string | null): RecurrenceRule | null {
  if (line === null || line.trim() === "") return null;
  const parts = new Map<string, string>();
  for (const piece of line.trim().split(";")) {
    const at = piece.indexOf("=");
    if (at === -1) return null;
    parts.set(piece.slice(0, at).toUpperCase(), piece.slice(at + 1).toUpperCase());
  }
  const frequency = frequencyOf(parts.get("FREQ"));
  if (frequency === null) return null;
  // Anything this product does not write, it does not claim to understand.
  for (const key of parts.keys()) {
    if (!["FREQ", "INTERVAL", "BYDAY", "BYSETPOS", "COUNT", "UNTIL"].includes(key)) return null;
  }
  const interval = intervalOf(parts.get("INTERVAL"));
  if (interval === null) return null;
  const monthlyPosition = parts.get("BYSETPOS");
  if (monthlyPosition !== undefined && monthlyPosition !== "BYDAY") return null;
  const weekdays = weekdaysOf(parts.get("BYDAY"));
  if (weekdays === null) return null;
  if (frequency !== "weekly" && weekdays.length > 0) return null;
  const end = endOf(parts.get("COUNT"), parts.get("UNTIL"));
  if (end === null) return null;
  return {
    frequency,
    interval,
    weekdays,
    monthly: monthlyPosition === "BYDAY" ? "byWeekday" : "byDate",
    end,
  };
}

function frequencyOf(code: string | undefined): RecurrenceFrequency | null {
  for (const [name, spelling] of Object.entries(FREQUENCY_CODES)) {
    if (spelling === code) return name as RecurrenceFrequency;
  }
  return null;
}

function intervalOf(text: string | undefined): number | null {
  if (text === undefined) return 1;
  const value = Number(text);
  if (!Number.isInteger(value) || value < 1 || value > MAX_INTERVAL) return null;
  return value;
}

function weekdaysOf(text: string | undefined): WeekdayCode[] | null {
  if (text === undefined || text === "") return [];
  const codes: WeekdayCode[] = [];
  for (const piece of text.split(",")) {
    const code = WEEKDAY_CODES.find((candidate) => candidate === piece);
    // A positional weekday ("2TU") is a rule this form cannot ask for, so it is not claimed.
    if (code === undefined) return null;
    if (!codes.includes(code)) codes.push(code);
  }
  return codes.toSorted(byWeekdayOrder);
}

function endOf(count: string | undefined, until: string | undefined): RecurrenceEnd | null {
  // Both is not a rule: RFC 5545 forbids it, and guessing which a firm meant is worse than refusing.
  if (count !== undefined && until !== undefined) return null;
  if (count !== undefined) {
    const value = Number(count);
    if (!Number.isInteger(value) || value < 1 || value > MAX_COUNT) return null;
    return { kind: "after", count: value };
  }
  if (until !== undefined) {
    const date = `${until.slice(0, 4)}-${until.slice(4, 6)}-${until.slice(6, 8)}`;
    // The form writes a civil date; an instant-shaped UNTIL from elsewhere is not claimed.
    if (until.length !== 8 || !isCivilDate(date)) return null;
    return { kind: "on", date };
  }
  return { kind: "never" };
}

function byWeekdayOrder(left: WeekdayCode, right: WeekdayCode): number {
  return WEEKDAY_CODES.indexOf(left) - WEEKDAY_CODES.indexOf(right);
}

// ---- the days a rule falls on ------------------------------------------------------------------

/*
 * The day arithmetic is @magna-carta/civil-time's, not this module's. A civil date is zoneless and
 * the ways to get that wrong are known and written down there — `Date.UTC(50, 0, 1)` is 1950, a
 * string slice is invisible to every scan, and a named zone drags a daylight-saving transition into
 * plain day counting. Recurrence needs nothing those functions do not already answer.
 */

/**
 * Which weekday a civil date falls on, as RFC 5545 spells it.
 *
 * The day-of-week is read through the civil-time module's own round trip rather than by building a
 * `Date` here, so a two-digit year cannot become 1950 on the way past.
 */
export function weekdayOf(civilDate: string): WeekdayCode {
  const daysFromKnownSunday = daysBetween(EPOCH_SUNDAY, civilDate);
  return WEEKDAY_CODES[((daysFromKnownSunday % 7) + 7) % 7] ?? "SU";
}

/** Which occurrence of its weekday in its month a date is: the 3rd Tuesday is 3. */
export function weekdayPositionOf(civilDate: string): number {
  return Math.floor((civilDateParts(civilDate).day - 1) / 7) + 1;
}

/** A Sunday, so a weekday is a count of days from a day whose name is known. 2024-01-07 was one. */
const EPOCH_SUNDAY = "2024-01-07";

/** Whole days from one civil date to another, counted through the civil-time module's own walk. */
function daysBetween(from: CivilDate, to: CivilDate): number {
  const fromParts = civilDateParts(from);
  const toParts = civilDateParts(to);
  return Math.round(
    (Date.UTC(toParts.year, toParts.month - 1, toParts.day) -
      Date.UTC(fromParts.year, fromParts.month - 1, fromParts.day)) /
      86_400_000,
  );
}

/**
 * The civil days a rule falls on, from the series' first day, within a window.
 *
 * The walk starts at the series' own start and steps forward — it never jumps to the window, because
 * a `COUNT` is counted from the beginning and a rule's Nth week is only Nth if you started counting
 * where the series did. Days before the window are counted and discarded; the walk stops at the
 * window's end, at the rule's own end, or at `MAX_OCCURRENCES`, whichever comes first.
 *
 * A rule whose start does not itself satisfy it (a weekly Tuesday rule on a series starting Friday)
 * still counts that first day: the day somebody chose is an occurrence, which is what every calendar
 * product does and what a person means by "starting this Friday, then every Tuesday".
 */
export function occurrencesOf(
  rule: RecurrenceRule,
  startsOn: string,
  window: { from: string; to: string },
): string[] {
  if (!isCivilDate(startsOn)) return [];
  const found: string[] = [];
  let emitted = 0;
  for (const day of walk(rule, startsOn)) {
    if (rule.end.kind === "after" && emitted >= rule.end.count) break;
    if (rule.end.kind === "on" && day > rule.end.date) break;
    if (day > window.to) break;
    emitted += 1;
    if (day >= window.from) found.push(day);
    if (emitted >= MAX_OCCURRENCES || found.length >= MAX_OCCURRENCES) break;
  }
  return found;
}

/**
 * Every day the rule falls on from the start, in order, without end. The callers bound it — this is
 * a generator so a thousand-year rule costs only the days somebody asked to see.
 */
function* walk(rule: RecurrenceRule, startsOn: string): Generator<string> {
  yield startsOn;
  if (rule.frequency === "weekly") {
    yield* weeklyDays(rule, startsOn);
    return;
  }
  let current = startsOn;
  for (;;) {
    current =
      rule.frequency === "daily"
        ? addCalendarDays(current, rule.interval)
        : nextMonthlyOrYearly(rule, startsOn, current);
    if (current === "") return;
    yield current;
  }
}

/** The days of a weekly rule after its first: each chosen weekday, week by week. */
function* weeklyDays(rule: RecurrenceRule, startsOn: string): Generator<string> {
  const wanted = rule.weekdays.length > 0 ? rule.weekdays : [weekdayOf(startsOn)];
  // The week the series starts in, from its own first day, so an interval counts whole weeks.
  const weekStart = addCalendarDays(startsOn, -WEEKDAY_CODES.indexOf(weekdayOf(startsOn)));
  for (let week = 0; ; week += 1) {
    const base = addCalendarDays(weekStart, week * rule.interval * 7);
    for (const code of wanted) {
      const day = addCalendarDays(base, WEEKDAY_CODES.indexOf(code));
      // The start is already yielded, and days before it are not part of the series.
      if (day > startsOn) yield day;
    }
  }
}

/**
 * The next day of a monthly or yearly rule.
 *
 * BY DATE is the plain reading: the 15th of every month. A month that HAS no such date — the 31st
 * in February — is SKIPPED rather than pulled back to the 28th, because a firm that said the 31st
 * did not mean the end of the month, and inventing a date it did not choose is worse than a month
 * with no occurrence in it.
 *
 * BY WEEKDAY is "the third Tuesday": the same weekday, in the same position, in the later month. A
 * month with only four Tuesdays has no fifth, and that month is skipped for the same reason.
 */
function nextMonthlyOrYearly(rule: RecurrenceRule, startsOn: string, current: string): string {
  const step = rule.frequency === "yearly" ? rule.interval * 12 : rule.interval;
  const origin = civilDateParts(startsOn);
  const from = civilDateParts(current);
  // Months are counted from the SERIES' start, so a skipped month never shifts the ones after it.
  const elapsed = (from.year - origin.year) * 12 + (from.month - origin.month);
  for (let ahead = elapsed + step; ahead <= elapsed + step + MAX_OCCURRENCES; ahead += step) {
    const month = origin.month - 1 + ahead;
    const year = origin.year + Math.floor(month / 12);
    const monthIndex = ((month % 12) + 12) % 12;
    const day =
      rule.monthly === "byWeekday" && rule.frequency === "monthly"
        ? weekdayDayOf(year, monthIndex + 1, weekdayOf(startsOn), weekdayPositionOf(startsOn))
        : dayOfMonthOr(year, monthIndex + 1, origin.day);
    if (day !== null) return civilDateFromParts({ year, month: monthIndex + 1, day });
  }
  return "";
}

/** The day of the month, or null where that month does not have one — February has no 31st. */
function dayOfMonthOr(year: number, month: number, day: number): number | null {
  return day > lastDayOf(year, month) ? null : day;
}

/** How many days a month holds, through the civil-time module's own month arithmetic. */
function lastDayOf(year: number, month: number): number {
  return civilDateParts(endOfCivilMonth(year, month)).day;
}

/** The date of the Nth given weekday in a month, or null where the month has no Nth. */
function weekdayDayOf(
  year: number,
  month: number,
  weekday: WeekdayCode,
  position: number,
): number | null {
  const firstOfMonth = civilDateFromParts({ year, month, day: 1 });
  const firstWeekday = WEEKDAY_CODES.indexOf(weekdayOf(firstOfMonth));
  const offset = (WEEKDAY_CODES.indexOf(weekday) - firstWeekday + 7) % 7;
  const day = 1 + offset + (position - 1) * 7;
  return day > lastDayOf(year, month) ? null : day;
}

// ---- one occurrence of a series, and a series split at one ------------------------------------

/**
 * Whether a civil date is one of the days a series falls on. The question an edit to "this
 * occurrence" has to answer before it writes anything: an exception standing in for a day the
 * series never visits would be a second event pretending to be the first.
 */
export function isOccurrenceOf(rule: RecurrenceRule, startsOn: string, civilDate: string): boolean {
  if (!isCivilDate(civilDate) || civilDate < startsOn) return false;
  return occurrencesOf(rule, startsOn, { from: civilDate, to: civilDate }).includes(civilDate);
}

/**
 * The last day a series falls on, or null where it never ends or runs past what one walk reads.
 *
 * Used to say "last one Mar 4, 2027" under the form, because a count of twelve is an answer whose
 * consequence is a date nobody can see from the number alone.
 */
export function lastOccurrenceOf(rule: RecurrenceRule, startsOn: string): string | null {
  if (!isCivilDate(startsOn)) return null;
  if (rule.end.kind === "never") return null;
  if (rule.end.kind === "after" && rule.end.count > MAX_OCCURRENCES) return null;
  const through =
    rule.end.kind === "on"
      ? rule.end.date
      : civilDateFromParts({ year: civilDateParts(startsOn).year + 200, month: 12, day: 31 });
  const days = occurrencesOf(rule, startsOn, { from: startsOn, to: through });
  return days.at(-1) ?? null;
}

/** Whole civil days from one date to another; negative where `to` comes first. */
export function civilDaysBetween(from: string, to: string): number {
  return daysBetween(from, to);
}

/**
 * The same date moved by however far `from` moved to `to`. What "change every event in the series"
 * does with a date somebody moved on ONE occurrence: the series' own start moves by the same number
 * of days, so moving this Tuesday's conference to Wednesday moves every one of them a day.
 */
export function movedLikeOccurrence(civilDate: string, from: string, to: string): string {
  return addCalendarDays(civilDate, daysBetween(from, to));
}

/**
 * A series cut at one of its occurrences: the rule the EARLIER part keeps, and the rule the part
 * from that occurrence onward starts with. "This and all later events" is exactly this cut, then the
 * change applied to the later part only, so what already happened is never rewritten.
 *
 * The earlier part ends the day before the cut. A count is shared out rather than restarted: twelve
 * conferences cut after the fifth leave seven to the later part, because the firm asked for twelve.
 * Null for the earlier part where the cut IS the series' first day: there is nothing before it, and
 * the whole series is what changes.
 */
export function splitSeriesAt(
  rule: RecurrenceRule,
  startsOn: string,
  occurrenceOn: string,
): { readonly before: RecurrenceRule | null; readonly after: RecurrenceRule } {
  if (occurrenceOn <= startsOn) return { before: null, after: rule };
  const dayBefore = addCalendarDays(occurrenceOn, -1);
  const before: RecurrenceRule = { ...rule, end: { kind: "on", date: dayBefore } };
  if (rule.end.kind !== "after") return { before, after: rule };
  const already = occurrencesOf(rule, startsOn, { from: startsOn, to: dayBefore }).length;
  const remaining = Math.max(1, rule.end.count - already);
  return {
    before: { ...rule, end: { kind: "after", count: already } },
    after: { ...rule, end: { kind: "after", count: remaining } },
  };
}
