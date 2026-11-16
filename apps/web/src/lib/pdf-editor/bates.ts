/*
 * The Bates numbering a reader sets up before stamping a production.
 *
 * A Bates label is the prefix, the page's number padded with zeros to a fixed width, and the
 * suffix: "SMITH-000041". The first page takes the starting number and each page after it the next
 * one. The engine (`stampBates` in `@magna-carta/pdf`) draws the label; this module holds what the
 * reader chose, checks it before the engine is asked, and says what the result will read as.
 *
 * Stamping adds text to each page and takes nothing away, so it is not a way to hide anything. The
 * stamped document is filed as a new file beside the original, because a production is a copy that
 * goes out, and the firm's own copy stays unnumbered.
 */
import type { BatesFont, BatesPosition } from "@magna-carta/pdf";

export interface BatesSettings {
  readonly prefix: string;
  readonly suffix: string;
  readonly startNumber: number;
  /** The fewest digits the number is written with, padded with leading zeros. */
  readonly digits: number;
  readonly position: BatesPosition;
  readonly typeface: BatesTypeface;
  readonly sizePt: number;
}

/** The three typefaces offered. Each is a standard PDF font every reader of a PDF already has. */
export type BatesTypeface = "sans" | "serif" | "mono";

export const BATES_TYPEFACES: readonly { readonly value: BatesTypeface; readonly label: string }[] =
  [
    { value: "sans", label: "Helvetica" },
    { value: "serif", label: "Times" },
    { value: "mono", label: "Courier" },
  ];

export const BATES_POSITIONS: readonly { readonly value: BatesPosition; readonly label: string }[] =
  [
    { value: "bottomRight", label: "Bottom Right" },
    { value: "bottomCenter", label: "Bottom Center" },
    { value: "bottomLeft", label: "Bottom Left" },
    { value: "topRight", label: "Top Right" },
    { value: "topCenter", label: "Top Center" },
    { value: "topLeft", label: "Top Left" },
  ];

/** The engine's own defaults, which are also what most productions use. */
export const DEFAULT_BATES: BatesSettings = {
  prefix: "",
  suffix: "",
  startNumber: 1,
  digits: 6,
  position: "bottomRight",
  typeface: "sans",
  sizePt: 8,
};

export const BATES_LIMITS = {
  digits: { min: 1, max: 12 },
  sizePt: { min: 6, max: 24 },
  /** A prefix or suffix longer than this would run off the edge of a letter-size page at 8 pt. */
  affixLength: 40,
} as const;

/** The standard PDF font the engine is asked for. Bold reads best at the small sizes Bates uses. */
export function batesFont(typeface: BatesTypeface): BatesFont {
  switch (typeface) {
    case "serif":
      return "times-bold";
    case "mono":
      return "courier-bold";
    default:
      return "helvetica-bold";
  }
}

/** The label one page carries. */
export function batesLabel(
  settings: Pick<BatesSettings, "prefix" | "suffix" | "digits">,
  number: number,
): string {
  return `${settings.prefix}${String(number).padStart(settings.digits, "0")}${settings.suffix}`;
}

/** The labels on the first and last page of a document this many pages long. */
export function batesRange(
  settings: BatesSettings,
  pageCount: number,
): { first: string; last: string; next: number } {
  const last = settings.startNumber + Math.max(pageCount, 1) - 1;
  return {
    first: batesLabel(settings, settings.startNumber),
    last: batesLabel(settings, last),
    next: last + 1,
  };
}

/**
 * Characters the standard PDF fonts can draw: the Windows Latin set the engine encodes labels in,
 * which is printable ASCII, the Latin-1 letters, and the typographer's marks a word processor
 * substitutes (curly quotes, dashes, the euro sign). Anything else, an emoji or a letter from
 * another script, the engine refuses, so it is caught here, where the reader can see which field
 * it is in.
 */
const WINDOWS_LATIN_EXTRAS =
  "\u20AC\u201A\u0192\u201E\u2026\u2020\u2021\u02C6\u2030\u0160\u2039\u0152\u017D\u2018\u2019\u201C\u201D\u2022\u2013\u2014\u02DC\u2122\u0161\u203A\u0153\u017E\u0178";
const DRAWABLE = new RegExp(`^[\\u0020-\\u007E\\u00A0-\\u00FF${WINDOWS_LATIN_EXTRAS}]*$`);

/** Whether the standard PDF fonts can print every character of `text`. The watermark asks too. */
export function printableInStandardFonts(text: string): boolean {
  return DRAWABLE.test(text);
}

/** What is wrong with the settings, field by field. Empty means the engine can be asked. */
export function batesProblems(
  settings: BatesSettings,
): Partial<Record<keyof BatesSettings, string>> {
  const problems: Partial<Record<keyof BatesSettings, string>> = {};
  for (const field of ["prefix", "suffix"] as const) {
    const value = settings[field];
    if (value.length > BATES_LIMITS.affixLength) {
      problems[field] = `Keep it to ${BATES_LIMITS.affixLength} characters.`;
    } else if (!printableInStandardFonts(value)) {
      problems[field] =
        "Use plain letters, numbers and punctuation. Curly quotes and long dashes can't be printed.";
    }
  }
  if (!Number.isInteger(settings.startNumber) || settings.startNumber < 0) {
    problems.startNumber = "Use a whole number, 0 or more.";
  }
  if (
    !Number.isInteger(settings.digits) ||
    settings.digits < BATES_LIMITS.digits.min ||
    settings.digits > BATES_LIMITS.digits.max
  ) {
    problems.digits = `Use ${BATES_LIMITS.digits.min} to ${BATES_LIMITS.digits.max} digits.`;
  }
  if (!(settings.sizePt >= BATES_LIMITS.sizePt.min && settings.sizePt <= BATES_LIMITS.sizePt.max)) {
    problems.sizePt = `Use ${BATES_LIMITS.sizePt.min} to ${BATES_LIMITS.sizePt.max} points.`;
  }
  return problems;
}

/** A label as it may appear in a file name: characters a file name may not carry become a hyphen. */
function fileNameSafe(label: string): string {
  return label.replace(/[\\/:*?"<>|]/g, "-");
}

/** "Smith.pdf" numbered SMITH-000001 to SMITH-000016 -> "Smith (SMITH-000001 to SMITH-000016).pdf". */
export function batesCopyName(originalName: string, first: string, last: string): string {
  const dot = originalName.lastIndexOf(".");
  const hasExtension = dot > 0 && dot < originalName.length - 1;
  const stem = hasExtension ? originalName.slice(0, dot) : originalName;
  const extension = hasExtension ? originalName.slice(dot) : ".pdf";
  const range =
    first === last ? fileNameSafe(first) : `${fileNameSafe(first)} to ${fileNameSafe(last)}`;
  return `${stem} (${range})${extension}`;
}
