// The numbering scheme of one exhibit set, as plain values a member chose.
//
// A scheme is never derived from a court, a jurisdiction or a matter type. Two departments of one
// courthouse direct incompatible numbering, so a rule keyed on the court would be confidently wrong;
// a firm picks the values, or copies them from a starter (presets.ts), and the set keeps them.
//
// This module imports nothing. The label function in label.ts rests on it, and both are proven
// without a database.

/** How the running part of a label is written. */
export const EXHIBIT_SEQUENCES = [
  "upperLetter", // A, B, C
  "lowerLetter", // a, b, c
  "arabic", // 1, 2, 3
  "upperRoman", // I, II, III
  "lowerRoman", // i, ii, iii
] as const;
export type ExhibitSequence = (typeof EXHIBIT_SEQUENCES)[number];

/**
 * What a letter sequence does after its twenty-sixth label.
 *
 * `doubled` repeats the letter: Z, AA, BB, CC, ... ZZ, AAA. `bijective` counts like spreadsheet
 * columns: Z, AA, AB, AC, ... AZ, BA. A sequence that is not a letter sequence ignores it.
 */
export const EXHIBIT_OVERFLOW_FORMS = ["doubled", "bijective"] as const;
export type ExhibitOverflowForm = (typeof EXHIBIT_OVERFLOW_FORMS)[number];

export interface ExhibitScheme {
  /** The word a citation prints before the label: "Exhibit", "Attachment", "Tab". */
  readonly noun: string;
  /** Printed directly before the running part, such as "P-" or "D". Empty for none. */
  readonly prefix: string;
  readonly sequence: ExhibitSequence;
  /** The ordinal the first position takes: 1 is "A" or "1"; 500 starts a defendant's run at 500. */
  readonly startAt: number;
  readonly overflowForm: ExhibitOverflowForm;
}

/** The highest ordinal a roman sequence can write; there is no standard numeral past it. */
export const ROMAN_ORDINAL_CEILING = 3999;

export function isLetterSequence(sequence: ExhibitSequence): boolean {
  return sequence === "upperLetter" || sequence === "lowerLetter";
}

export function isRomanSequence(sequence: ExhibitSequence): boolean {
  return sequence === "upperRoman" || sequence === "lowerRoman";
}
