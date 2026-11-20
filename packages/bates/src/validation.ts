import {
  BATES_PURPOSES,
  MAX_BATES_NUMBER,
  MAX_DIGITS,
  MAX_PAGES_PER_RANGE,
  MAX_PREFIX_LENGTH,
  MIN_DIGITS,
  type BatesPurpose,
} from "./types.ts";

// Every refusal this package raises, as a code the route maps to a problem type. Codes, never
// messages, drive the mapping.
export type BatesValidationCode =
  | "bates-invalid-input"
  // The file or exhibit set named is not on this matter.
  | "bates-unknown-file"
  | "bates-unknown-set"
  | "bates-unknown-range"
  // Some number in the asked-for range is already stamped under this prefix.
  | "bates-range-taken"
  // The range's stamped copy is already recorded.
  | "bates-range-already-saved";

export class BatesValidationError extends Error {
  readonly code: BatesValidationCode;

  constructor(code: BatesValidationCode, message: string) {
    super(message);
    this.name = "BatesValidationError";
    this.code = code;
  }
}

function refuse(message: string): never {
  throw new BatesValidationError("bates-invalid-input", message);
}

// Anything that prints on a page: no control characters and no line breaks. Spaces and punctuation
// stay, because "SMITH-" and "DEF 0" are both real prefixes. Empty is allowed: numbers alone.
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u;

export function assertPrefix(value: unknown): string {
  if (typeof value !== "string") refuse("prefix must be text");
  if (value.length > MAX_PREFIX_LENGTH) {
    refuse(`prefix must be at most ${String(MAX_PREFIX_LENGTH)} characters`);
  }
  if (CONTROL_CHARACTER.test(value))
    refuse("prefix must not hold a line break or control character");
  return value;
}

function assertInteger(value: unknown, field: string, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isInteger(value))
    refuse(`${field} must be a whole number`);
  if (value < minimum || value > maximum) {
    refuse(`${field} must be between ${String(minimum)} and ${String(maximum)}`);
  }
  return value;
}

export function assertDigits(value: unknown): number {
  return assertInteger(value, "digits", MIN_DIGITS, MAX_DIGITS);
}

export function assertPageCount(value: unknown): number {
  return assertInteger(value, "pageCount", 1, MAX_PAGES_PER_RANGE);
}

export function assertFirstNumber(value: unknown): number {
  return assertInteger(value, "firstNumber", 0, MAX_BATES_NUMBER);
}

export function assertPurpose(value: unknown): BatesPurpose {
  if (typeof value !== "string" || !(BATES_PURPOSES as readonly string[]).includes(value)) {
    refuse(`purpose must be one of ${BATES_PURPOSES.join(", ")}`);
  }
  return value as BatesPurpose;
}

/** The last number a range reaches, refused when it would pass the twelve-digit ceiling. */
export function lastNumberOf(firstNumber: number, pageCount: number): number {
  const last = firstNumber + pageCount - 1;
  if (last > MAX_BATES_NUMBER) refuse("the range would pass the highest Bates number");
  return last;
}
