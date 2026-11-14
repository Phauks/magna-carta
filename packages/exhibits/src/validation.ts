import { isCivilDate } from "@magna-carta/civil-time/civil-date";
import {
  EXHIBIT_OVERFLOW_FORMS,
  EXHIBIT_SEQUENCES,
  ROMAN_ORDINAL_CEILING,
  isRomanSequence,
} from "./scheme.ts";
import type { ExhibitOverflowForm, ExhibitScheme, ExhibitSequence } from "./scheme.ts";
import {
  EXHIBIT_DISPOSITIONS,
  EXHIBIT_SOURCE_KINDS,
  MAX_BASIS_LENGTH,
  MAX_DESCRIPTION_LENGTH,
  MAX_MEMBERS_PER_SET,
  MAX_NOUN_LENGTH,
  MAX_PREFIX_LENGTH,
  MAX_SET_NAME_LENGTH,
  MAX_START_AT,
  MAX_TITLE_LENGTH,
  type ExhibitDisposition,
  type ExhibitSourceKind,
} from "./types.ts";

// Every refusal this subsystem raises, as a code the route maps to a problem type. Codes, never
// messages, drive the mapping, so a message can be reworded without changing the contract.
export type ExhibitValidationCode =
  // Shape refusals. The schema carries most of the same checks; these turn an abort into a refusal
  // a caller can act on.
  | "exhibit-invalid-input"
  | "exhibit-unknown-exhibit"
  | "exhibit-unknown-set"
  | "exhibit-unknown-member"
  // The file is not on this matter, is deleted, or has no clean version to attach.
  | "exhibit-file-unavailable"
  // A member-supplied reference name that is malformed, or one another exhibit on the matter holds.
  | "exhibit-reference-name-invalid"
  | "exhibit-reference-name-taken"
  // The operation needs a draft set and this one has gone out. Reordering, adding, removing,
  // renumbering and renaming are all refused by name rather than by a trigger's abort.
  | "exhibit-set-issued"
  // The operation needs an issued set and this one is still a draft (withdraw, correct, supersede).
  | "exhibit-set-not-issued"
  // The proposed order does not name every member of the set exactly once.
  | "exhibit-order-mismatch"
  // Two writes raced for one position; the loser is refused, never merged.
  | "exhibit-position-conflict"
  // The document is already in the set.
  | "exhibit-already-in-set"
  // More members, or more exhibits on a matter, than a single read returns. Refused, never truncated.
  | "exhibit-bound-exceeded"
  // A scheme whose last label could not be written, such as a roman run past 3999.
  | "exhibit-scheme-out-of-range"
  // A supersession or continuation chain longer than the platform follows, or a set with a successor.
  | "exhibit-chain-too-deep"
  | "exhibit-set-already-superseded"
  // An issued set cannot be issued with nothing in it.
  | "exhibit-set-empty"
  | "exhibit-member-withdrawn";

export class ExhibitValidationError extends Error {
  readonly code: ExhibitValidationCode;

  constructor(code: ExhibitValidationCode, message: string) {
    super(message);
    this.name = "ExhibitValidationError";
    this.code = code;
  }
}

function refuse(code: ExhibitValidationCode, message: string): never {
  throw new ExhibitValidationError(code, message);
}

/** A required piece of text, trimmed, non-empty and within its bound. */
export function assertText(value: unknown, field: string, maximum: number): string {
  if (typeof value !== "string") refuse("exhibit-invalid-input", `${field} must be text`);
  const trimmed = value.trim();
  if (trimmed.length === 0) refuse("exhibit-invalid-input", `${field} must not be empty`);
  if (trimmed.length > maximum) {
    refuse("exhibit-invalid-input", `${field} is longer than ${maximum} characters`);
  }
  return trimmed;
}

/** Optional text: absent or blank becomes null. */
export function optionalText(value: unknown, field: string, maximum: number): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") refuse("exhibit-invalid-input", `${field} must be text`);
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > maximum) {
    refuse("exhibit-invalid-input", `${field} is longer than ${maximum} characters`);
  }
  return trimmed;
}

export const assertTitle = (value: unknown): string => assertText(value, "title", MAX_TITLE_LENGTH);
export const optionalDescription = (value: unknown): string | null =>
  optionalText(value, "description", MAX_DESCRIPTION_LENGTH);
export const assertSetName = (value: unknown): string =>
  assertText(value, "name", MAX_SET_NAME_LENGTH);
export const assertBasis = (value: unknown): string => assertText(value, "basis", MAX_BASIS_LENGTH);

export function assertSourceKind(value: unknown): ExhibitSourceKind {
  const kinds: readonly unknown[] = EXHIBIT_SOURCE_KINDS;
  if (!kinds.includes(value)) refuse("exhibit-invalid-input", `unknown source kind`);
  return value as ExhibitSourceKind;
}

export function assertDisposition(value: unknown): ExhibitDisposition {
  const dispositions: readonly unknown[] = EXHIBIT_DISPOSITIONS;
  if (!dispositions.includes(value)) refuse("exhibit-invalid-input", `unknown disposition`);
  return value as ExhibitDisposition;
}

/** A civil date, YYYY-MM-DD, that is a real day of the calendar. */
export function assertCivilDate(value: unknown, field: string): string {
  if (typeof value !== "string" || !isCivilDate(value)) {
    refuse("exhibit-invalid-input", `${field} must be a calendar date written YYYY-MM-DD`);
  }
  return value;
}

/**
 * A complete scheme from caller input. Every field is checked, and so is the scheme's reach: a set
 * of the largest allowed size must be able to write its last label, so a roman run that would pass
 * 3999 is refused here rather than failing on the day the set grows.
 */
export function assertScheme(input: {
  readonly noun?: unknown;
  readonly prefix?: unknown;
  readonly sequence?: unknown;
  readonly startAt?: unknown;
  readonly overflowForm?: unknown;
}): ExhibitScheme {
  const noun =
    input.noun === undefined || input.noun === null
      ? ""
      : typeof input.noun === "string"
        ? input.noun.trim()
        : refuse("exhibit-invalid-input", "noun must be text");
  if (noun.length > MAX_NOUN_LENGTH) {
    refuse("exhibit-invalid-input", `noun is longer than ${MAX_NOUN_LENGTH} characters`);
  }
  const prefix =
    input.prefix === undefined || input.prefix === null
      ? ""
      : typeof input.prefix === "string"
        ? input.prefix
        : refuse("exhibit-invalid-input", "prefix must be text");
  if (prefix.length > MAX_PREFIX_LENGTH || /\s/.test(prefix)) {
    refuse(
      "exhibit-invalid-input",
      `prefix is at most ${MAX_PREFIX_LENGTH} characters with no spaces`,
    );
  }
  const sequences: readonly unknown[] = EXHIBIT_SEQUENCES;
  if (!sequences.includes(input.sequence)) refuse("exhibit-invalid-input", "unknown sequence");
  const overflowForms: readonly unknown[] = EXHIBIT_OVERFLOW_FORMS;
  if (!overflowForms.includes(input.overflowForm)) {
    refuse("exhibit-invalid-input", "unknown overflow form");
  }
  const startAt = input.startAt;
  if (
    typeof startAt !== "number" ||
    !Number.isInteger(startAt) ||
    startAt < 1 ||
    startAt > MAX_START_AT
  ) {
    refuse("exhibit-invalid-input", `startAt is a whole number from 1 to ${MAX_START_AT}`);
  }
  const sequence = input.sequence as ExhibitSequence;
  if (isRomanSequence(sequence) && startAt + MAX_MEMBERS_PER_SET - 1 > ROMAN_ORDINAL_CEILING) {
    refuse(
      "exhibit-scheme-out-of-range",
      `a roman set starting at ${startAt} could not number ${MAX_MEMBERS_PER_SET} exhibits`,
    );
  }
  return {
    noun,
    prefix,
    sequence,
    startAt,
    overflowForm: input.overflowForm as ExhibitOverflowForm,
  };
}
