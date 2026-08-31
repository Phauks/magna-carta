/*
 * Splitting a telephone number into the parts it is dialled with.
 *
 * WHY THIS IS NOT A LIBRARY. Full number validation — is this a real mobile prefix in this region,
 * how should it be formatted for a reader there — needs a metadata set that changes monthly and is
 * measured in hundreds of kilobytes. This module deliberately does less: it splits a number into the
 * country calling code, the national number and the extension, which is everything a stored record
 * and a dialler need, and it does it from one small rule that does not go stale. If per-region
 * validation is wanted later it goes behind this same shape.
 *
 * WHAT IS NEVER LOST. The number as entered is stored verbatim and is never rewritten. When this
 * module cannot split an input it says so by returning nulls, and the row keeps the value the person
 * typed. A number that could not be parsed is recorded honestly rather than guessed at or refused —
 * a firm's file is full of numbers written in ways no parser expects, and refusing them would send
 * the number into a free-text note where nothing can reach it.
 */

// Country calling codes are one, two or three digits, and which it is follows from the first digit.
// Zones 1 (North American Numbering Plan) and 7 (Russia and Kazakhstan) are one digit; a fixed set
// is two; everything else is three. This is the whole of the E.164 assignment rule, and it is stable
// in a way per-region number formats are not.
const SINGLE_DIGIT_CALLING_CODES = new Set(["1", "7"]);

const TWO_DIGIT_CALLING_CODES = new Set([
  "20",
  "27",
  "30",
  "31",
  "32",
  "33",
  "34",
  "36",
  "39",
  "40",
  "41",
  "43",
  "44",
  "45",
  "46",
  "47",
  "48",
  "49",
  "51",
  "52",
  "53",
  "54",
  "55",
  "56",
  "57",
  "58",
  "60",
  "61",
  "62",
  "63",
  "64",
  "65",
  "66",
  "81",
  "82",
  "84",
  "86",
  "90",
  "91",
  "92",
  "93",
  "94",
  "95",
  "98",
]);

// What separates a number from its extension in the ways people actually write it.
const EXTENSION_SEPARATOR = /(?:\s|^)(?:ext|extn|extension|x)\.?\s*([0-9]+)\s*$/i;

/** A telephone number split into the parts it is stored and dialled with. */
export interface StructuredPhoneNumber {
  /** Digits only, no leading plus. Null when the input carried no country calling code. */
  readonly countryCallingCode: string | null;
  /** Digits only. Null when the input could not be split at all. */
  readonly nationalNumber: string | null;
  /** Digits only. Null when no extension was written. */
  readonly extension: string | null;
}

function digitsOnly(value: string): string {
  return value.replaceAll(/[^0-9]/g, "");
}

/**
 * Split a number as entered into its country calling code, national number and extension.
 *
 * An input in international form (a leading `+`, or the `00` prefix used across much of the world)
 * splits fully. An input in national form — the way a number is written on a letterhead in its own
 * country — yields a national number and a null calling code, because nothing in the digits says
 * which country it belongs to and inventing one is worse than recording that it is unknown.
 */
export function structurePhoneNumber(numberAsEntered: string): StructuredPhoneNumber {
  const trimmed = numberAsEntered.trim();
  if (trimmed === "") return { countryCallingCode: null, nationalNumber: null, extension: null };

  const extensionMatch = EXTENSION_SEPARATOR.exec(trimmed);
  const extension = extensionMatch?.[1] ?? null;
  const withoutExtension =
    extensionMatch === null ? trimmed : trimmed.slice(0, extensionMatch.index);

  // Both ways a number says "this is the international form". `00` is the international prefix in
  // most of the world; `011` is the North American one and is deliberately NOT treated as such,
  // because a number beginning 011 is far more likely to be a national number somewhere else.
  const international = withoutExtension.trimStart().startsWith("+")
    ? digitsOnly(withoutExtension)
    : /^\s*00[0-9]/.test(withoutExtension)
      ? digitsOnly(withoutExtension).slice(2)
      : null;

  if (international === null) {
    const national = digitsOnly(withoutExtension);
    return {
      countryCallingCode: null,
      nationalNumber: national === "" ? null : national,
      extension,
    };
  }

  const callingCodeLength = SINGLE_DIGIT_CALLING_CODES.has(international.slice(0, 1))
    ? 1
    : TWO_DIGIT_CALLING_CODES.has(international.slice(0, 2))
      ? 2
      : 3;
  const countryCallingCode = international.slice(0, callingCodeLength);
  const nationalNumber = international.slice(callingCodeLength);
  // A country calling code with nothing after it is not a number; report the whole thing unsplit
  // rather than storing a calling code that names no line.
  if (countryCallingCode.length < callingCodeLength || nationalNumber === "") {
    return {
      countryCallingCode: null,
      nationalNumber: international === "" ? null : international,
      extension,
    };
  }
  return { countryCallingCode, nationalNumber, extension };
}

/**
 * The number in its dialable international form, or null where the split did not produce one.
 *
 * NOT a stored column. The two stored columns ARE the canonical number, and a third holding them
 * concatenated would be a derived value that has to be kept in step with them forever. This composes
 * it for a caller that wants one string — a dialler, a message header, a screen.
 */
export function internationalPhoneNumber(structured: StructuredPhoneNumber): string | null {
  if (structured.countryCallingCode === null || structured.nationalNumber === null) return null;
  return `+${structured.countryCallingCode}${structured.nationalNumber}`;
}
