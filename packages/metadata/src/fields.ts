import type { FieldMoment, FieldValue, Finding, FindingField } from "./model.ts";

// The bounds on what a report carries back. Every value is read out of untrusted bytes, so the
// report is held to a size a browser table can show and a person can read: a long value is cut, and
// past the field cap the rest is counted rather than listed.
export const MAX_FIELD_TEXT_LENGTH = 400;
export const MAX_FIELDS_PER_FINDING = 100;

// Text is gathered from a document into a buffer that stops growing well before it would matter:
// the cut to MAX_FIELD_TEXT_LENGTH happens after cleaning, which can shorten the text, so the buffer
// keeps a margin over the cap rather than exactly the cap.
export const TEXT_GATHER_LIMIT = MAX_FIELD_TEXT_LENGTH * 4;

const ELLIPSIS = "…";

const WHITESPACE_RUN = /\s+/g;

// C0 and C1 control characters, which become spaces (tab and line breaks among them: a value is
// shown on one line).
function isControl(codePoint: number): boolean {
  return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
}

// Direction marks, embeddings, overrides and isolates. A value carrying one can reverse how the text
// around it reads (a file name that shows as "exe.txt" and is "txt.exe"), so they are dropped.
function isDirectionControl(codePoint: number): boolean {
  return (
    codePoint === 0x200e ||
    codePoint === 0x200f ||
    (codePoint >= 0x202a && codePoint <= 0x202e) ||
    (codePoint >= 0x2066 && codePoint <= 0x2069)
  );
}

/** A value as it may be shown: no control characters, no direction overrides, one line, capped. */
export function cleanText(raw: string): string {
  const bounded = raw.length > TEXT_GATHER_LIMIT ? raw.slice(0, TEXT_GATHER_LIMIT) : raw;
  let kept = "";
  for (const character of bounded) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (isDirectionControl(codePoint)) continue;
    kept += isControl(codePoint) ? " " : character;
  }
  const cleaned = kept.replace(WHITESPACE_RUN, " ").trim();
  const characters = Array.from(cleaned);
  if (characters.length <= MAX_FIELD_TEXT_LENGTH && bounded.length === raw.length) return cleaned;
  if (characters.length <= MAX_FIELD_TEXT_LENGTH) return `${cleaned}${ELLIPSIS}`;
  return `${characters.slice(0, MAX_FIELD_TEXT_LENGTH).join("").trimEnd()}${ELLIPSIS}`;
}

/** A text value, or undefined when nothing readable is left after cleaning. */
export function textValue(raw: string | undefined): FieldValue | undefined {
  if (raw === undefined) return undefined;
  const text = cleanText(raw);
  return text === "" ? undefined : { form: "text", text };
}

function twoDigits(value: number): string {
  return String(value).padStart(2, "0");
}

function inRange(value: number, low: number, high: number): boolean {
  return Number.isInteger(value) && value >= low && value <= high;
}

// An ISO 8601 date, optionally with a time of day, optionally with a zone. Fractions of a second
// are accepted and dropped from a zoneless reading (the shape it is shown in has no seconds).
const ISO_MOMENT =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:[.,]\d+)?)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i;

/**
 * A moment as the file wrote it. With a zone it is an instant; without one it is a date and time of
 * day with no zone. Anything that is not a real calendar moment is undefined, so a caller falls back
 * to showing the raw text.
 */
export function momentOf(raw: string): FieldMoment | undefined {
  const match = ISO_MOMENT.exec(raw.trim());
  if (match === null) return undefined;
  const [, year, month, day, hour, minute, second, zone] = match;
  const parts = {
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hour: hour === undefined ? undefined : Number(hour),
    minute: minute === undefined ? undefined : Number(minute),
    second: second === undefined ? 0 : Number(second),
  };
  return momentFromParts(parts, zone);
}

interface MomentParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number | undefined;
  readonly minute: number | undefined;
  readonly second: number;
}

/** The same reading from parts already split, for formats that do not write ISO 8601 (EXIF, IPTC). */
export function momentFromParts(
  parts: MomentParts,
  zone: string | undefined,
): FieldMoment | undefined {
  const { year, month, day, hour, minute, second } = parts;
  if (!inRange(year, 1, 9999) || !inRange(month, 1, 12) || !inRange(day, 1, 31)) return undefined;
  const calendarCheck = new Date(Date.UTC(year, month - 1, day));
  if (calendarCheck.getUTCDate() !== day) return undefined; // the 30th of February
  const date = `${String(year).padStart(4, "0")}-${twoDigits(month)}-${twoDigits(day)}`;
  if (hour === undefined || minute === undefined) return { form: "zoneless", date };
  if (!inRange(hour, 0, 23) || !inRange(minute, 0, 59) || !inRange(second, 0, 60)) {
    return undefined;
  }
  const time = `${twoDigits(hour)}:${twoDigits(minute)}`;
  if (zone === undefined || zone === "") return { form: "zoneless", date, time };
  const offset = zone.toUpperCase() === "Z" ? "Z" : zone.replace(/^([+-]\d{2})(\d{2})$/, "$1:$2");
  const instant = new Date(`${date}T${time}:${twoDigits(Math.min(second, 59))}${offset}`);
  if (Number.isNaN(instant.getTime())) return { form: "zoneless", date, time };
  return { form: "instant", instant: instant.toISOString() };
}

/** A moment value where the text is one, and the text itself where it is not. */
export function momentOrText(raw: string | undefined): FieldValue | undefined {
  if (raw === undefined) return undefined;
  return momentOf(raw) ?? textValue(raw);
}

/**
 * The fields one finding is collecting. Past MAX_FIELDS_PER_FINDING a field is counted, not kept,
 * so a document with ten thousand tracked changes reports the first hundred and the number left.
 */
export class FieldCollector {
  private readonly kept: FindingField[] = [];
  private unlisted = 0;

  add(field: FindingField): void {
    if (this.kept.length < MAX_FIELDS_PER_FINDING) this.kept.push(field);
    else this.unlisted++;
  }

  /** A named field, skipped when the value read as nothing. */
  addNamed(name: string, value: FieldValue | undefined): void {
    if (value !== undefined) this.add({ name: cleanText(name), value });
  }

  get size(): number {
    return this.kept.length + this.unlisted;
  }

  /** The finding with these fields on it, or the finding unchanged when there are none. */
  attachTo(finding: Finding): Finding {
    if (this.kept.length === 0) return finding;
    return this.unlisted === 0
      ? { ...finding, fields: this.kept }
      : { ...finding, fields: this.kept, unlistedFieldCount: this.unlisted };
  }
}

/** Decode XML's predefined entities and character references, for formats read without a parser. */
export function decodeXmlEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (whole, entity: string) => {
    const lower = entity.toLowerCase();
    if (lower === "amp") return "&";
    if (lower === "lt") return "<";
    if (lower === "gt") return ">";
    if (lower === "quot") return '"';
    if (lower === "apos") return "'";
    const codePoint = lower.startsWith("#x")
      ? Number.parseInt(lower.slice(2), 16)
      : Number.parseInt(lower.slice(1), 10);
    if (!Number.isFinite(codePoint) || codePoint < 0 || codePoint > 0x10ffff) return whole;
    try {
      return String.fromCodePoint(codePoint);
    } catch {
      return whole;
    }
  });
}
