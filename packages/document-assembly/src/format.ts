import { civilDateParts } from "@magna-carta/civil-time/civil-date";
import { zonedReading } from "@magna-carta/civil-time/time-zone";
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
  // The default is FIRST, and `full` prints the recorded display name unchanged — which is what this
  // rendering was before names carried parts, so no registered template's output moved when they
  // arrived. The rest are opt-in at the placeholder.
  name: ["full", "formal", "lastFirst", "initials", "family", "given", "upper"],
  date: ["short", "long", "legal", "iso"],
  money: ["currency", "currencyWords", "plain"],
  rate: ["plain", "currencyWords"],
  number: ["plain"],
  boolean: ["yesNo", "plain"],
  reference: ["plain"],
  // An image has no rendering to choose between: the placeholder is REPLACED BY a drawing rather than
  // by a string, and the box it draws in comes from the asset. An empty row makes every format name
  // illegal by the same check that governs the rest, so `{{location.letterheadLogo:upper}}` is refused
  // at registration rather than quietly ignored.
  image: [],
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
// Names
// ---------------------------------------------------------------------------------------------

// A RENDERING THAT NEEDS A PART THE RECORD LACKS IS AN ABSENCE, NEVER A FALLBACK.
//
// `{{client.displayName:lastFirst}}` on a record that stores only "Rowan Ashcroft", with no family name
// separated out, does NOT render "Rowan Ashcroft". It resolves to nothing, and the reason says which
// part is missing so the repair — open the record, split the name — is in the message. Falling back
// would produce a document that looks finished and is wrong in a way nobody catches by reading it,
// which is the same failure the ambiguity rule refuses one level up.

type NameValue = Extract<MergeValue, { kind: "name" }>;

function presentPart(part: string | undefined): string | undefined {
  return part === undefined || part === "" ? undefined : part;
}

// The parts a format needs, and the sentence that explains a record which cannot supply them. Written as
// a total switch so a format added to the table above without a rendering stops this file compiling.
function renderName(value: NameValue, format: string): string | { readonly reason: string } {
  const prefix = presentPart(value.prefix);
  const given = presentPart(value.given);
  const middle = presentPart(value.middle);
  const family = presentPart(value.family);
  const suffix = presentPart(value.suffix);

  const organisationRefusal = (rendering: string): { readonly reason: string } => ({
    reason: `This party is an organisation, which has no personal name to write ${rendering}. Use the default rendering, which prints the organisation's name as recorded.`,
  });
  const missingPartRefusal = (part: string, rendering: string): { readonly reason: string } => ({
    reason: `This Directory record has no ${part} recorded separately, so it cannot be written ${rendering}. Open the record and split the name into its parts to use this rendering.`,
  });

  switch (format) {
    // The recorded display name, unchanged. This is what the key rendered before it carried parts, and
    // it is the one rendering every record can always answer.
    case "full":
      return value.display;
    case "upper":
      return value.display.toUpperCase();
    case "formal": {
      // An organisation's formal name is the name it records; there is nothing to assemble.
      if (value.isOrganisation === true) return value.display;
      if (given === undefined || family === undefined) {
        return missingPartRefusal("given name and family name", "in its formal long form");
      }
      const middleInitial = middle === undefined ? undefined : `${middle.charAt(0)}.`;
      return [prefix, given, middleInitial, family, suffix]
        .filter((part) => part !== undefined)
        .join(" ");
    }
    case "lastFirst":
      if (value.isOrganisation === true) return organisationRefusal("surname first");
      if (family === undefined) return missingPartRefusal("family name", "surname first");
      if (given === undefined) return missingPartRefusal("given name", "surname first");
      return `${family}, ${given}`;
    case "initials": {
      if (value.isOrganisation === true) return organisationRefusal("as initials");
      if (given === undefined || family === undefined) {
        return missingPartRefusal("given name and family name", "as initials");
      }
      return [given, middle, family]
        .filter((part) => part !== undefined)
        .map((part) => `${part.charAt(0).toUpperCase()}.`)
        .join("");
    }
    case "family":
      if (value.isOrganisation === true) return organisationRefusal("as a family name");
      if (family === undefined) return missingPartRefusal("family name", "as a family name alone");
      return family;
    case "given":
      if (value.isOrganisation === true) return organisationRefusal("as a given name");
      if (given === undefined) return missingPartRefusal("given name", "as a given name alone");
      return given;
    default:
      // Not reachable through a registered template: `isLegalFormat` refuses a format the type's row
      // does not carry, at registration, with a location. Reached only by a caller that formatted a
      // value without checking, and the honest answer there is the default rendering.
      return value.display;
  }
}

// Why a value could not be rendered under the format asked for, when the reason is a fact about the
// record rather than an ordinary missing value. Returns undefined when there is nothing to say beyond
// what the marker already says — an ordinary absence carries no reason, so that the ones that need
// reading are not buried.
export function renderingAbsenceReason(value: MergeValue, format: string): string | undefined {
  if (value.kind !== "name") return undefined;
  const rendered = renderName(value, format);
  return typeof rendered === "string" ? undefined : rendered.reason;
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
  // The projection is `zonedReading` — the platform's one answer to "which day was this instant in
  // that place", shared with the calendar's deadline arithmetic and the task overdue comparison, so
  // a document and a due date cannot disagree about which day a filing landed on.
  const { year, month, day } = civilDateParts(zonedReading(instant.getTime(), timeZone).civilDate);
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
    case "name": {
      const rendered = renderName(value, format);
      // A refusal is undefined here and a REASON at the absence site: the caller records the absence,
      // and `renderingAbsenceReason` is what turns the marker into a sentence naming the missing part.
      return typeof rendered === "string" ? rendered : undefined;
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
    // The scale is the field's own minor-unit exponent, so rendering is the same decimal-point move
    // money gets: 1250 at scale 2 prints "12.50", and the alternative — dividing by ten squared —
    // would hand a binary float to a document that is supposed to state an exact figure.
    case "number":
      return plainDecimal(value.value, value.scale);
    case "boolean":
      return format === "plain" ? String(value.value) : value.value ? "Yes" : "No";
    // An image is not rendered as text at all. Returning undefined rather than a placeholder string is
    // what routes it to the drawing path in assemble.ts, and what makes a caller that forgot that path
    // produce a visible absence rather than the word "[object Object]" in a filed document.
    case "image":
      return undefined;
  }
}
