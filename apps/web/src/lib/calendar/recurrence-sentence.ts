/*
 * A repeat rule as a sentence somebody reads.
 *
 * The rule's GRAMMAR is @magna-carta/civil-time's (`recurrence.ts`) and is shared with the server,
 * which refuses a line it could not have written. What it MEANS in English is presentation, so it
 * lives here beside the other written forms this screen needs (`room-location.ts` holds the same
 * kind of thing for a room). One home, because the form's own summary and the record pane's
 * "Repeats ..." line have to say the same words: a form that reads "every 2 weeks" beside a record
 * that reads "fortnightly" is two rules as far as the reader is concerned.
 *
 * A RULE THIS PRODUCT CANNOT READ STILL GETS A SENTENCE. `parseRecurrence` returns null for a line
 * another calendar wrote with parts the form cannot offer, and the honest thing to say about one is
 * that it repeats on a rule recorded elsewhere -- not nothing, which would render a repeating event
 * as a one-off, and not a guess.
 */
import { civilDateParts, isCivilDate } from "@magna-carta/civil-time/civil-date";
import { formatCivilDateLong, parseCivilDate } from "@magna-carta/design-system/calendar-grid";
import {
  lastOccurrenceOf,
  parseRecurrence,
  WEEKDAY_CODES,
  weekdayOf,
  weekdayPositionOf,
  type RecurrenceRule,
  type WeekdayCode,
} from "@magna-carta/civil-time/recurrence";

/** What a weekday is called, in the order the codes are declared. */
const WEEKDAY_NAMES: Record<WeekdayCode, string> = {
  SU: "Sunday",
  MO: "Monday",
  TU: "Tuesday",
  WE: "Wednesday",
  TH: "Thursday",
  FR: "Friday",
  SA: "Saturday",
};

/** How an interval reads when it is not one. "every 2 weeks" is worse English than "fortnightly". */
const INTERVAL_WORDS: Record<number, string> = { 2: "second", 3: "third" };

/** Which occurrence of a weekday in its month, as a person says it. */
const POSITION_WORDS: Record<number, string> = {
  1: "first",
  2: "second",
  3: "third",
  4: "fourth",
  5: "fifth",
};

/**
 * What the rule says, as a phrase that follows the word "Repeats".
 *
 * `startsOn` is needed because two of the four frequencies are stated RELATIVE to the day the series
 * begins: a weekly rule with no weekdays chosen falls on the start's own weekday, and a monthly
 * by-weekday rule means "the third Tuesday" only once you know which weekday the third of those is.
 * Without a start day those read as "weekly" and "monthly", which is true but is not what the person
 * answered.
 */
export function writtenRecurrence(rule: RecurrenceRule, startsOn: string | null): string {
  return [cadenceOf(rule, startsOn), endingOf(rule)].filter((part) => part !== "").join(", ");
}

/** The stored line as the same sentence, or null where the event does not repeat at all. */
export function recurrenceSentence(line: string | null, startsOn: string | null): string | null {
  if (line === null || line.trim() === "") return null;
  const rule = parseRecurrence(line);
  if (rule === null) return "on a rule recorded in another calendar";
  return writtenRecurrence(rule, startsOn);
}

/**
 * The day a series stops, as the line under the form's Ends answer. A count of twelve is an answer
 * whose consequence is a date nobody can see from the number alone, and an end date that falls
 * between two occurrences is not itself the last one, so both are said as the day the last one is.
 */
export function lastOccurrenceSentence(rule: RecurrenceRule, startsOn: string | null): string {
  if (rule.end.kind === "never") return "No end date.";
  if (startsOn === null || !isCivilDate(startsOn)) return "";
  const last = lastOccurrenceOf(rule, startsOn);
  if (last === null) return "";
  try {
    return `Last one ${formatCivilDateLong(parseCivilDate(last))}.`;
  } catch {
    return `Last one ${last}.`;
  }
}

function cadenceOf(rule: RecurrenceRule, startsOn: string | null): string {
  const every = everyOf(rule.interval);
  switch (rule.frequency) {
    case "daily":
      return rule.interval === 1 ? "every day" : `${every} ${plural(rule.interval, "day")}`;
    case "weekly":
      return `${every} ${plural(rule.interval, "week")}${weeklyDaysOf(rule, startsOn)}`;
    case "monthly":
      return `${every} ${plural(rule.interval, "month")}${monthlyDayOf(rule, startsOn)}`;
    case "yearly":
      return `${every} ${plural(rule.interval, "year")}`;
  }
}

/** "every", "every second", "every 5" -- words while a person has one, a numeral after that. */
function everyOf(interval: number): string {
  const word = INTERVAL_WORDS[interval];
  if (interval === 1) return "every";
  return word === undefined ? `every ${interval}` : `every ${word}`;
}

/** The unit, singular where a word carried the count ("every second week", "every 5 weeks"). */
function plural(interval: number, unit: string): string {
  return interval === 1 || INTERVAL_WORDS[interval] !== undefined ? unit : `${unit}s`;
}

function weeklyDaysOf(rule: RecurrenceRule, startsOn: string | null): string {
  const chosen = rule.weekdays.length > 0 ? rule.weekdays : startingWeekday(startsOn);
  if (chosen.length === 0) return "";
  return ` on ${listed(chosen.map((code) => WEEKDAY_NAMES[code]))}`;
}

/** The start's own weekday, which is what choosing Weekly and nothing else means. */
function startingWeekday(startsOn: string | null): WeekdayCode[] {
  return startsOn === null ? [] : [weekdayOf(startsOn)];
}

function monthlyDayOf(rule: RecurrenceRule, startsOn: string | null): string {
  if (startsOn === null) return "";
  if (rule.monthly === "byWeekday") {
    const position = POSITION_WORDS[weekdayPositionOf(startsOn)];
    if (position === undefined) return "";
    return ` on the ${position} ${WEEKDAY_NAMES[weekdayOf(startsOn)]}`;
  }
  if (!isCivilDate(startsOn)) return "";
  return ` on the ${ordinal(civilDateParts(startsOn).day)}`;
}

/** 1st, 2nd, 3rd, 4th -- with the teens, which do not follow their last digit. */
function ordinal(day: number): string {
  const teen = day % 100 >= 11 && day % 100 <= 13;
  const suffix = teen ? "th" : (["th", "st", "nd", "rd"][day % 10] ?? "th");
  return `${day}${suffix}`;
}

function endingOf(rule: RecurrenceRule): string {
  switch (rule.end.kind) {
    case "never":
      return "";
    case "after":
      return `${rule.end.count} times`;
    case "on":
      return `until ${rule.end.date}`;
  }
}

/** "Monday and Wednesday"; "Monday, Wednesday and Friday". The serial comma is not this firm's. */
function listed(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** The weekday chips a weekly rule offers, in the week's own order. */
export const WEEKDAY_CHOICES: readonly { code: WeekdayCode; name: string; short: string }[] =
  WEEKDAY_CODES.map((code) => ({
    code,
    name: WEEKDAY_NAMES[code],
    short: WEEKDAY_NAMES[code].slice(0, 3),
  }));
