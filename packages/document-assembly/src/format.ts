import { currencyFromCode, money } from "@magna-carta/money/money";
import { format as formatMoney } from "@magna-carta/money/format";
import type { MergeValue, MergeValueType } from "./types.ts";

// Formatting is declarative: which renderings are legal is a property of the value's TYPE, and which one
// applies is the dictionary entry's default unless the placeholder overrides it as `{{key:format}}`.
//
// The rule every formatter here obeys: formatting moves a decimal point, it never multiplies. What a
// stored integer means is its kind plus its scale — a 500 is five hundred on a number field and five
// dollars on a currency field — so a formatter that reached for arithmetic would be silently changing
// amounts rather than rendering them.

const LEGAL_FORMATS: Readonly<Record<MergeValueType, readonly string[]>> = {
  text: ["plain", "upper", "titleCase"],
  date: ["short", "long", "legal", "iso"],
  money: ["currency", "currencyWords", "plain"],
  rate: ["plain", "currencyWords"],
  number: ["plain"],
  boolean: ["yesNo", "plain"],
  reference: ["plain"],
  // A list is never written into a document. A repeating block walks it, and `count` and `isEmpty` ask
  // about it; there is no rendering of the collection itself, which is why this row is empty rather
  // than absent — an empty row makes every format name illegal by the same check that governs the rest.
  list: [],
};

export function legalFormatsFor(valueType: MergeValueType): readonly string[] {
  return LEGAL_FORMATS[valueType];
}

// ---------------------------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------------------------

// Title case over words, leaving anything that is already mixed case alone — an "O'Brien" or a "McCall"
// entered correctly by a paralegal must not be rewritten to "O'brien". Nothing here attempts grammar.
// Exported because the expression language's `titleCase` helper is the SAME rendering an author gets
// from `{{key:titleCase}}`; two implementations of one rule would drift, and a document would then
// capitalize a name differently depending on which form the author reached for.
export function titleCase(text: string): string {
  return text.replace(/[A-Za-z][A-Za-z'’-]*/g, (word) =>
    word === word.toLowerCase() || word === word.toUpperCase()
      ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
      : word,
  );
}

// ---------------------------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------------------------

const MONTH_NAMES: readonly string[] = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

interface CalendarDate {
  readonly year: number;
  readonly month: number; // 1-12
  readonly day: number; // 1-31
}

// Project an instant into a time zone's calendar date. A document renders dates in the MATTER'S OFFICE'S
// time zone, not the server's and not the acting member's, so a filing date is the date it was in the
// office that filed it.
function calendarDateInZone(isoInstant: string, timeZone: string): CalendarDate | undefined {
  const instant = new Date(isoInstant);
  if (Number.isNaN(instant.getTime())) return undefined;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const read = (type: string): number => Number(parts.find((part) => part.type === type)?.value);
  const year = read("year");
  const month = read("month");
  const day = read("day");
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return undefined;
  return { year, month, day };
}

function parseCalendarDate(isoDate: string): CalendarDate | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (match === null) return undefined;
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

function ordinal(day: number): string {
  const remainderHundred = day % 100;
  if (remainderHundred >= 11 && remainderHundred <= 13) return `${day}th`;
  const remainderTen = day % 10;
  if (remainderTen === 1) return `${day}st`;
  if (remainderTen === 2) return `${day}nd`;
  if (remainderTen === 3) return `${day}rd`;
  return `${day}th`;
}

function renderDate(date: CalendarDate, format: string): string {
  const monthName = MONTH_NAMES[date.month - 1] ?? String(date.month);
  switch (format) {
    case "short":
      return `${date.month}/${date.day}/${date.year}`;
    case "legal":
      return `the ${ordinal(date.day)} day of ${monthName}, ${date.year}`;
    case "iso":
      return `${String(date.year).padStart(4, "0")}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`;
    default:
      return `${monthName} ${date.day}, ${date.year}`;
  }
}

// ---------------------------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------------------------

const ONES: readonly string[] = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
];

const TENS: readonly string[] = [
  "",
  "",
  "twenty",
  "thirty",
  "forty",
  "fifty",
  "sixty",
  "seventy",
  "eighty",
  "ninety",
];

const SCALES: readonly string[] = ["", " thousand", " million", " billion", " trillion"];

function wordsUnderThousand(value: number): string {
  if (value < 20) return ONES[value] ?? String(value);
  if (value < 100) {
    const tens = TENS[Math.floor(value / 10)] ?? "";
    const ones = value % 10;
    return ones === 0 ? tens : `${tens}-${ONES[ones]}`;
  }
  const hundreds = `${ONES[Math.floor(value / 100)]} hundred`;
  const remainder = value % 100;
  return remainder === 0 ? hundreds : `${hundreds} ${wordsUnderThousand(remainder)}`;
}

function wordsForWholeNumber(value: number): string {
  if (value === 0) return "zero";
  const groups: number[] = [];
  let remaining = value;
  while (remaining > 0) {
    groups.push(remaining % 1000);
    remaining = Math.floor(remaining / 1000);
  }
  const rendered: string[] = [];
  for (let index = groups.length - 1; index >= 0; index -= 1) {
    const group = groups[index] ?? 0;
    if (group === 0) continue;
    rendered.push(`${wordsUnderThousand(group)}${SCALES[index] ?? ""}`);
  }
  return rendered.join(" ");
}

// The form a settlement statement needs: "one thousand two hundred thirty-four dollars and 56/100".
// The cents stay a fraction rather than becoming words, which is the convention on a negotiable
// instrument and removes any question about how "fifty-six hundredths" was meant to be read.
function currencyWords(amountMinor: number, currencyCode: string): string {
  const negative = amountMinor < 0;
  const absolute = Math.abs(amountMinor);
  const whole = Math.trunc(absolute / 100);
  const cents = absolute % 100;
  const unit = currencyCode === "USD" ? "dollars" : currencyCode;
  const words = `${wordsForWholeNumber(whole)} ${unit} and ${String(cents).padStart(2, "0")}/100`;
  return negative ? `negative ${words}` : words;
}

// The exact decimal string for a minor-unit integer at scale 2 — a decimal-point move, done on the
// integer's digits, never a division that could round.
function plainDecimal(minorUnits: number, scale: number): string {
  const negative = minorUnits < 0;
  const digits = String(Math.abs(minorUnits)).padStart(scale + 1, "0");
  const whole = digits.slice(0, digits.length - scale);
  const fraction = digits.slice(digits.length - scale);
  const rendered = scale === 0 ? whole : `${whole}.${fraction}`;
  return negative ? `-${rendered}` : rendered;
}

// The scale a `rate_e4` carries: a rate is stored multiplied by ten thousand.
const RATE_SCALE = 4;
const MONEY_SCALE = 2;

// ---------------------------------------------------------------------------------------------
// The formatter entry point
// ---------------------------------------------------------------------------------------------

export interface FormatOptions {
  readonly timeZone: string;
}

// Render one resolved value under one format. Returns undefined when the value cannot be rendered at
// all (an unparseable stored date, an unregistered currency), which the caller treats as an absence
// rather than emitting a partial string into a document.
export function formatMergeValue(
  value: MergeValue,
  format: string,
  options: FormatOptions,
): string | undefined {
  switch (value.kind) {
    case "text": {
      if (format === "upper") return value.text.toUpperCase();
      if (format === "titleCase") return titleCase(value.text);
      return value.text;
    }
    case "date": {
      const date = parseCalendarDate(value.isoDate);
      return date === undefined ? undefined : renderDate(date, format);
    }
    case "instant": {
      const date = calendarDateInZone(value.isoInstant, options.timeZone);
      return date === undefined ? undefined : renderDate(date, format);
    }
    case "money": {
      if (format === "plain") return plainDecimal(value.amountMinor, MONEY_SCALE);
      if (format === "currencyWords") return currencyWords(value.amountMinor, value.currencyCode);
      try {
        return formatMoney(money(value.amountMinor, currencyFromCode(value.currencyCode)));
      } catch {
        return undefined;
      }
    }
    case "rate": {
      if (format === "currencyWords") {
        return currencyWords(Math.trunc(value.rateE4 / 100), value.currencyCode);
      }
      return plainDecimal(value.rateE4, RATE_SCALE);
    }
    case "number":
      return String(value.value);
    case "boolean":
      return format === "plain" ? String(value.value) : value.value ? "Yes" : "No";
  }
}
