/*
 * What a question typed into Search asks for, read by rule.
 *
 * A reader types "hargrove unpaid invoices since june" and means three things at once: some words
 * to look for, a place to look, and a span of days. This module takes the question apart into
 * those, and leaves the rest as the words. It reads only what it is sure of, and the page shows
 * every reading as a chip the reader can take away, so a wrong guess costs one press and never
 * hides a result silently.
 *
 * THREE THINGS ARE READ, AND NOTHING ELSE.
 *
 *   - A place, where the question names exactly one: "invoices", "notes", "calls", "files".
 *     Two places named, or none, leave every place searched and the words as typed.
 *   - The reader's own matters: "my matters", "my cases", "mine".
 *   - Days: "today", "last week", "this month", "since june", "before 2025", "in march 2026",
 *     "between may 1 and june 30", "last 30 days". A month or a year is read as days only
 *     after a word that makes it one ("since", "in", "before") or beside a year, because "may"
 *     and "march" are also words people search for.
 *
 * QUOTED WORDS ARE NEVER READ. Text inside quotation marks is a phrase the reader wants found as
 * typed, so it stays in the words untouched.
 *
 * Nothing here decides what anyone may see. Every reading becomes an ordinary parameter of the
 * search address, which the server holds inside what the reader may see, exactly as it would had
 * the reader chosen it by hand.
 */
import {
  addCalendarDays,
  civilDateFromParts,
  civilDateParts,
  endOfCivilMonth,
  isCivilDate,
  startOfCivilMonth,
} from "@magna-carta/civil-time/civil-date";
import { MATTERS_PLACE, PEOPLE_PLACE } from "./search-address.ts";

/** A span of days, both ends included. Either end may be open. */
export interface ReadDays {
  readonly from?: string;
  readonly to?: string;
}

export interface QuestionReading {
  /** What is left to search for once the readings are taken out. */
  readonly words: string;
  /** The one place the question named, or null for every place. */
  readonly place: string | null;
  /** Whether the question asked for the reader's own matters. */
  readonly mine: boolean;
  /** The days the question named, or null for any day. */
  readonly days: ReadDays | null;
}

/** Whether a reading took anything out of the question. */
export function readAnything(reading: QuestionReading): boolean {
  return reading.place !== null || reading.mine || reading.days !== null;
}

// The words that name a place, as a reader says them. Each is matched as a whole word, and a
// two-word name is matched before the one-word names inside it.
const PLACE_WORDS: readonly (readonly [readonly string[], string])[] = [
  [["time", "entries"], "time"],
  [["time", "entry"], "time"],
  [["custody", "packets"], "custody"],
  [["custody", "packet"], "custody"],
  [["invoices"], "billing"],
  [["invoice"], "billing"],
  [["bills"], "billing"],
  [["billing"], "billing"],
  [["notes"], "notes"],
  [["note"], "notes"],
  [["timesheets"], "time"],
  [["hours"], "time"],
  [["costs"], "costs"],
  [["expenses"], "costs"],
  [["expense"], "costs"],
  [["calls"], "communications"],
  [["call"], "communications"],
  [["texts"], "communications"],
  [["messages"], "communications"],
  [["messaging"], "communications"],
  [["files"], "files"],
  [["documents"], "files"],
  [["docs"], "files"],
  [["folders"], "files"],
  [["parties"], "parties"],
  [["packets"], "custody"],
  [["custody"], "custody"],
  [["matters"], MATTERS_PLACE],
  [["cases"], MATTERS_PLACE],
  [["people"], PEOPLE_PLACE],
  [["contacts"], PEOPLE_PLACE],
];

const MINE_WORDS: readonly (readonly string[])[] = [
  ["my", "matters"],
  ["my", "cases"],
  ["my", "own", "matters"],
  ["mine"],
];

// Words that only join a question together. Taken out ONLY when something else was read, because
// "notes about the easement" asks for notes holding "easement", and every word typed must be in a
// record for it to answer. A question nothing was read from is searched exactly as typed.
const JOINING_WORDS = new Set([
  "a",
  "about",
  "all",
  "an",
  "and",
  "any",
  "are",
  "at",
  "by",
  "find",
  "for",
  "from",
  "in",
  "is",
  "me",
  "mentioning",
  "of",
  "on",
  "show",
  "that",
  "the",
  "to",
  "was",
  "were",
  "which",
  "with",
]);

const MONTHS: Readonly<Record<string, number>> = {
  january: 1,
  jan: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sept: 9,
  sep: 9,
  october: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12,
};

const UNITS: Readonly<Record<string, "day" | "week" | "month" | "year">> = {
  day: "day",
  days: "day",
  week: "week",
  weeks: "week",
  month: "month",
  months: "month",
  year: "year",
  years: "year",
};

interface Token {
  /** As typed, punctuation and all. */
  readonly text: string;
  /** Lowercased, with the punctuation at its ends taken off, for matching. */
  readonly norm: string;
  /** Inside quotation marks: never read. */
  readonly quoted: boolean;
}

function tokenize(question: string): Token[] {
  const tokens: Token[] = [];
  // A quoted run is one token, kept with its marks so the words stay a phrase.
  const pattern = /"[^"]*"?|\S+/g;
  for (const match of question.matchAll(pattern)) {
    const text = match[0];
    const quoted = text.startsWith('"');
    tokens.push({
      text,
      norm: quoted ? "" : text.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""),
      quoted,
    });
  }
  return tokens;
}

/** A span of days, as the inside of the reader works with it. */
interface Span {
  readonly start: string;
  readonly end: string;
}

function yearOf(norm: string): number | null {
  return /^(19|20)\d{2}$/.test(norm) ? Number(norm) : null;
}

function dayOf(norm: string): number | null {
  const day = /^(\d{1,2})(st|nd|rd|th)?$/.exec(norm);
  if (day === null) return null;
  const value = Number(day[1]);
  return value >= 1 && value <= 31 ? value : null;
}

// The most recent year in which a month and day had already come by `today`: "june" in November
// is this June, and "december" in November is last December.
function recentYear(today: string, month: number, day: number): number {
  const parts = civilDateParts(today);
  return month < parts.month || (month === parts.month && day <= parts.day)
    ? parts.year
    : parts.year - 1;
}

/**
 * One date expression starting at `index`: a written day ("2026-06-01", "6/1/2026", "june 1,
 * 2026", "june 1"), a month ("june", "june 2026") or a year ("2025"). `bare` is false where the
 * word before it already said it is a date, which is the only place a lone month or year is read.
 */
function readDate(
  tokens: readonly Token[],
  index: number,
  today: string,
  bare: boolean,
): { span: Span; used: number } | null {
  const first = tokens[index];
  if (first === undefined || first.quoted) return null;
  const norm = first.norm;

  if (isCivilDate(norm)) return { span: { start: norm, end: norm }, used: 1 };

  const slashed = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/.exec(norm);
  if (slashed !== null) {
    const month = Number(slashed[1]);
    const day = Number(slashed[2]);
    const written = slashed[3];
    const year =
      written === undefined
        ? recentYear(today, month, day)
        : written.length === 2
          ? 2000 + Number(written)
          : Number(written);
    const date = civilDateFromParts({ year, month, day });
    if (!isCivilDate(date) || civilDateParts(date).day !== day) return null;
    return { span: { start: date, end: date }, used: 1 };
  }

  const month = MONTHS[norm];
  if (month !== undefined) {
    const next = tokens[index + 1];
    const day = next === undefined || next.quoted ? null : dayOf(next.norm);
    if (day !== null) {
      const after = tokens[index + 2];
      const written = after === undefined || after.quoted ? null : yearOf(after.norm);
      const year = written ?? recentYear(today, month, day);
      const date = civilDateFromParts({ year, month, day });
      if (!isCivilDate(date) || civilDateParts(date).day !== day) return null;
      return { span: { start: date, end: date }, used: written === null ? 2 : 3 };
    }
    const written = next === undefined || next.quoted ? null : yearOf(next.norm);
    if (written !== null) {
      return {
        span: { start: startOfCivilMonth(written, month), end: endOfCivilMonth(written, month) },
        used: 2,
      };
    }
    // A month alone is a date only where a word before it said so: "may" is also a word.
    if (bare) return null;
    const year = recentYear(today, month, 1);
    return {
      span: { start: startOfCivilMonth(year, month), end: endOfCivilMonth(year, month) },
      used: 1,
    };
  }

  const year = yearOf(norm);
  if (year !== null && !bare) {
    return { span: { start: `${year}-01-01`, end: `${year}-12-31` }, used: 1 };
  }
  return null;
}

// Monday is the first day of a week a reader names, as the ISO calendar has it. A firm's own
// calendar may begin its weeks on Sunday; a search for "this week" missing one Sunday is the
// smaller error than a search that reads the firm's settings to answer a question about words.
function startOfWeek(today: string): string {
  const { year, month, day } = civilDateParts(today);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return addCalendarDays(today, -((weekday + 6) % 7));
}

/** A named span with no date written in it: "today", "last month", "past 30 days". */
function readNamedSpan(
  tokens: readonly Token[],
  index: number,
  today: string,
): { span: Span; used: number } | null {
  const word = tokens[index]?.norm;
  const next = tokens[index + 1]?.norm;
  const after = tokens[index + 2]?.norm;
  if (word === undefined || tokens[index]?.quoted === true) return null;
  const { year, month } = civilDateParts(today);

  if (word === "today") return { span: { start: today, end: today }, used: 1 };
  if (word === "yesterday") {
    const day = addCalendarDays(today, -1);
    return { span: { start: day, end: day }, used: 1 };
  }
  if ((word === "this" || word === "last") && next !== undefined) {
    const back = word === "last";
    if (next === "week") {
      const start = addCalendarDays(startOfWeek(today), back ? -7 : 0);
      return { span: { start, end: back ? addCalendarDays(start, 6) : today }, used: 2 };
    }
    if (next === "month") {
      const target = back ? (month === 1 ? [year - 1, 12] : [year, month - 1]) : [year, month];
      const [targetYear, targetMonth] = target as [number, number];
      return {
        span: {
          start: startOfCivilMonth(targetYear, targetMonth),
          end: back ? endOfCivilMonth(targetYear, targetMonth) : today,
        },
        used: 2,
      };
    }
    if (next === "year") {
      const targetYear = back ? year - 1 : year;
      return {
        span: { start: `${targetYear}-01-01`, end: back ? `${targetYear}-12-31` : today },
        used: 2,
      };
    }
  }
  if ((word === "last" || word === "past") && next !== undefined && after !== undefined) {
    const count = /^\d{1,3}$/.test(next) ? Number(next) : null;
    const unit = UNITS[after];
    if (count !== null && count > 0 && unit !== undefined) {
      const days = { day: 1, week: 7, month: 30, year: 365 }[unit] * count;
      return { span: { start: addCalendarDays(today, -(days - 1)), end: today }, used: 3 };
    }
  }
  return null;
}

/** Days named at `index`, with whatever word in front of them says how they are meant. */
function readDays(
  tokens: readonly Token[],
  index: number,
  today: string,
): { days: ReadDays; used: number } | null {
  const word = tokens[index]?.norm;
  if (word === undefined || tokens[index]?.quoted === true) return null;

  const named = readNamedSpan(tokens, index, today);
  if (named !== null)
    return { days: { from: named.span.start, to: named.span.end }, used: named.used };

  if (word === "between" || word === "from") {
    const first = readDate(tokens, index + 1, today, false);
    if (first !== null) {
      const joiner = tokens[index + 1 + first.used]?.norm;
      if (joiner === "and" || joiner === "to" || joiner === "until" || joiner === "through") {
        const second = readDate(tokens, index + 2 + first.used, today, false);
        if (second !== null) {
          return {
            days: { from: first.span.start, to: second.span.end },
            used: 2 + first.used + second.used,
          };
        }
      }
      if (word === "from") {
        return { days: { from: first.span.start }, used: 1 + first.used };
      }
    }
    return null;
  }
  if (word === "since") {
    const date = readDate(tokens, index + 1, today, false);
    return date === null ? null : { days: { from: date.span.start }, used: 1 + date.used };
  }
  if (word === "after") {
    const date = readDate(tokens, index + 1, today, false);
    return date === null
      ? null
      : { days: { from: addCalendarDays(date.span.end, 1) }, used: 1 + date.used };
  }
  if (word === "before") {
    const date = readDate(tokens, index + 1, today, false);
    return date === null
      ? null
      : { days: { to: addCalendarDays(date.span.start, -1) }, used: 1 + date.used };
  }
  if (word === "until" || word === "through") {
    const date = readDate(tokens, index + 1, today, false);
    return date === null ? null : { days: { to: date.span.end }, used: 1 + date.used };
  }
  if (word === "in" || word === "during" || word === "on") {
    const date = readDate(tokens, index + 1, today, false);
    return date === null
      ? null
      : { days: { from: date.span.start, to: date.span.end }, used: 1 + date.used };
  }
  // A date with a day or a year in it reads as a date with no word in front.
  const bare = readDate(tokens, index, today, true);
  return bare === null
    ? null
    : { days: { from: bare.span.start, to: bare.span.end }, used: bare.used };
}

function matchesAt(tokens: readonly Token[], index: number, words: readonly string[]): boolean {
  return words.every((word, offset) => {
    const token = tokens[index + offset];
    return token !== undefined && !token.quoted && token.norm === word;
  });
}

/**
 * The question taken apart. `today` is the reader's own civil date, so "today" and "last week" are
 * the reader's and not the server's.
 */
export function readQuestion(question: string, today: string): QuestionReading {
  const tokens = tokenize(question);
  const taken = new Set<number>();
  const places = new Set<string>();
  const placeAt: number[][] = [];
  let mine = false;
  let days: ReadDays | null = null;

  for (let index = 0; index < tokens.length; index += 1) {
    if (taken.has(index)) continue;

    const ownWords = MINE_WORDS.find((words) => matchesAt(tokens, index, words));
    if (ownWords !== undefined) {
      mine = true;
      for (let offset = 0; offset < ownWords.length; offset += 1) taken.add(index + offset);
      index += ownWords.length - 1;
      continue;
    }

    if (days === null) {
      const read = readDays(tokens, index, today);
      if (read !== null) {
        days = read.days;
        for (let offset = 0; offset < read.used; offset += 1) taken.add(index + offset);
        index += read.used - 1;
        continue;
      }
    }

    const place = PLACE_WORDS.find(([words]) => matchesAt(tokens, index, words));
    if (place !== undefined) {
      places.add(place[1]);
      const at = place[0].map((_, offset) => index + offset);
      placeAt.push(at);
      index += place[0].length - 1;
    }
  }

  // One place named is a place. Two are a question about both, which every place answers, and the
  // words that named them stay words.
  const place = places.size === 1 ? ([...places][0] ?? null) : null;
  if (place !== null) for (const at of placeAt) for (const index of at) taken.add(index);

  const readSomething = place !== null || mine || days !== null;
  const words = tokens
    .filter((token, index) => {
      if (taken.has(index)) return false;
      if (readSomething && !token.quoted && JOINING_WORDS.has(token.norm)) return false;
      return true;
    })
    .map((token) => token.text)
    .join(" ");

  return { words, place, mine, days };
}

// ---- what the page shows of a reading ------------------------------------------------------------

/** One reading the page shows under the field, which the reader can take away. */
export interface UnderstoodChip {
  /** Which reading it is. */
  readonly key: "place" | "mine" | "days";
  /** What kind of reading: Place, Matters, Date. */
  readonly label: string;
  /** What was read: Billing, My Matters, Since Jun 1, 2026. */
  readonly value: string;
}

export interface UnderstoodInput {
  /** The question as typed, or null where nothing was read out of it. */
  readonly asked: string | null;
  readonly place: string;
  readonly mine: boolean;
  readonly days: ReadDays | null;
  /** The reader's today, which a place or the reader's matters do not depend on. */
  readonly today: string;
  /** A place's name as the page writes it. */
  readonly placeName: (place: string) => string;
  /** A day as the page writes it. */
  readonly formatDay: (day: string) => string;
}

/** How a span of days reads on its chip. */
export function daysValue(days: ReadDays, formatDay: (day: string) => string): string {
  if (days.from !== undefined && days.to !== undefined) {
    return days.from === days.to
      ? formatDay(days.from)
      : `${formatDay(days.from)} to ${formatDay(days.to)}`;
  }
  if (days.from !== undefined) return `Since ${formatDay(days.from)}`;
  return `Through ${formatDay(days.to ?? "")}`;
}

/**
 * The chips under the field. A place and the reader's own matters are chips only where the typed
 * question named them and the address still carries them, because the reader can also choose
 * either by hand, and a choice made by hand is shown where it was made. Days have no other control,
 * so an address that carries days always shows them, however it was reached.
 */
export function understoodChips(input: UnderstoodInput): readonly UnderstoodChip[] {
  const reading = input.asked === null ? null : readQuestion(input.asked, input.today);
  const chips: UnderstoodChip[] = [];
  if (reading !== null && reading.place !== null && reading.place === input.place) {
    chips.push({ key: "place", label: "Place", value: input.placeName(input.place) });
  }
  if (reading !== null && reading.mine && input.mine) {
    chips.push({ key: "mine", label: "Matters", value: "My Matters" });
  }
  if (input.days !== null) {
    chips.push({ key: "days", label: "Date", value: daysValue(input.days, input.formatDay) });
  }
  return chips;
}
