/*
 * WHAT A TYPED DATE MEANS. The date field takes a date the way a person says it — "Nov 13",
 * "11/13", "today", "fri", "last fri", "+3" — and this module is the one reading of that text.
 * It is pure: the caller passes today, so the answer never depends on when a test runs.
 *
 * The rules, in the order they are tried:
 * - "today", "tomorrow", "yesterday" (and their short forms).
 * - A weekday ("fri", "friday"): the next one on or after today. "next fri" is the first one after
 *   today; "last fri" the most recent one before it.
 * - "+3" or "-2": that many days from today; a trailing "w" counts weeks.
 * - ISO "2026-11-13".
 * - Numbers in the United States order, month first: "11/13", "11/13/26", "11-13-2026",
 *   "11.13.2026", and the bare digits "1113", "111326", "11132026". A missing year is this year;
 *   a two-digit year is the nearest century that is not more than twenty years ahead.
 * - A month by name with a day, either order, an optional year: "Nov 13", "13 November 2026".
 * - A day alone ("13"): that day of this month.
 * A leading weekday is ignored when the rest names a date, so the field's own display
 * ("Fri, Nov 13, 2026") reads back as itself.
 *
 * Anything else, and any date that does not exist (Feb 30), is null: the field refuses it rather
 * than guessing.
 */

import { CalendarDate, getDayOfWeek } from "@internationalized/date";

const MONTHS: Readonly<Record<string, number>> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

/* Weekdays counted from Sunday = 0, the order `getDayOfWeek` uses under the en-US locale. */
const WEEKDAYS: Readonly<Record<string, number>> = {
  sun: 0,
  sunday: 0,
  mon: 1,
  monday: 1,
  tue: 2,
  tues: 2,
  tuesday: 2,
  wed: 3,
  weds: 3,
  wednesday: 3,
  thu: 4,
  thur: 4,
  thurs: 4,
  thursday: 4,
  fri: 5,
  friday: 5,
  sat: 6,
  saturday: 6,
};

const RELATIVE_WORDS: Readonly<Record<string, number>> = {
  today: 0,
  tod: 0,
  now: 0,
  tomorrow: 1,
  tmrw: 1,
  tom: 1,
  yesterday: -1,
  yest: -1,
};

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** A real day, or null. CalendarDate itself would quietly clamp Feb 30 to Feb 28. */
function realDate(year: number, month: number, day: number): CalendarDate | null {
  if (!Number.isInteger(year) || year < 1 || year > 9999) return null;
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  if (!Number.isInteger(day) || day < 1 || day > daysInMonth(year, month)) return null;
  return new CalendarDate(year, month, day);
}

function fullYear(written: string, today: CalendarDate): number {
  const number = Number(written);
  if (written.length > 2) return number;
  const thisCentury = Math.floor(today.year / 100) * 100 + number;
  return thisCentury <= today.year + 20 ? thisCentury : thisCentury - 100;
}

function weekdayOf(date: CalendarDate): number {
  return getDayOfWeek(date, "en-US");
}

function byWeekday(target: number, modifier: string, today: CalendarDate): CalendarDate {
  const now = weekdayOf(today);
  if (modifier === "last") {
    const back = (now - target + 7) % 7 || 7;
    return today.subtract({ days: back });
  }
  const ahead = (target - now + 7) % 7;
  if (modifier === "next") return today.add({ days: ahead || 7 });
  return today.add({ days: ahead });
}

function byMonthName(tokens: readonly string[], today: CalendarDate): CalendarDate | null {
  const monthIndex = tokens.findIndex((token) => token in MONTHS);
  if (monthIndex === -1) return null;
  const month = MONTHS[tokens[monthIndex]!]!;
  const numbers = tokens.filter((_, index) => index !== monthIndex);
  if (numbers.length === 0 || numbers.length > 2) return null;
  if (!numbers.every((token) => /^\d+$/.test(token))) return null;
  // The day is the first one-or-two-digit number; a year is four digits, or two after the day.
  const [first, second] = numbers as [string, string | undefined];
  if (first.length > 2) return null;
  const day = Number(first);
  const year = second === undefined ? today.year : fullYear(second, today);
  if (second !== undefined && second.length !== 2 && second.length !== 4) return null;
  return realDate(year, month, day);
}

function byNumbers(text: string, today: CalendarDate): CalendarDate | null {
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (iso) return realDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const separated = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2}|\d{4}))?$/.exec(text);
  if (separated) {
    const year = separated[3] === undefined ? today.year : fullYear(separated[3], today);
    return realDate(year, Number(separated[1]), Number(separated[2]));
  }

  if (/^\d+$/.test(text)) {
    if (text.length <= 2) return realDate(today.year, today.month, Number(text));
    if (text.length === 4)
      return realDate(today.year, Number(text.slice(0, 2)), Number(text.slice(2)));
    if (text.length === 6 || text.length === 8) {
      return realDate(
        fullYear(text.slice(4), today),
        Number(text.slice(0, 2)),
        Number(text.slice(2, 4)),
      );
    }
  }
  return null;
}

/** The day `text` names, read against `today`, or null when it names none. */
export function parseTypedDate(text: string, today: CalendarDate): CalendarDate | null {
  const normalized = text.trim().toLowerCase();
  if (normalized === "") return null;

  const relative = RELATIVE_WORDS[normalized];
  if (relative !== undefined) return today.add({ days: relative });

  const offset = /^([+-])\s*(\d{1,4})\s*([dw])?$/.exec(normalized);
  if (offset) {
    const amount = Number(offset[2]) * (offset[3] === "w" ? 7 : 1);
    return today.add({ days: offset[1] === "-" ? -amount : amount });
  }

  const tokens = normalized
    .replace(/(\d)(st|nd|rd|th)\b/g, "$1")
    .split(/[\s,]+/)
    .map((token) => token.replace(/\.$/, ""))
    .filter((token) => token !== "");

  const weekdayPhrase = /^(?:(last|next|this)\s+)?([a-z]+)$/.exec(tokens.join(" "));
  if (weekdayPhrase && (weekdayPhrase[2] as string) in WEEKDAYS) {
    return byWeekday(WEEKDAYS[weekdayPhrase[2]!]!, weekdayPhrase[1] ?? "this", today);
  }

  // A leading weekday beside a full date is the field's own display read back; it adds nothing.
  const rest = tokens.length > 1 && (tokens[0] as string) in WEEKDAYS ? tokens.slice(1) : tokens;

  return byMonthName(rest, today) ?? (rest.length === 1 ? byNumbers(rest[0]!, today) : null);
}
