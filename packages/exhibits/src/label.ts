// The label of a position in an exhibit set, as a pure function of the position and the scheme.
//
// While a set is a draft its labels are NOT stored. Every read computes them here, so a reorder, an
// insertion or a removal cannot leave a stored label disagreeing with the order: there is one
// function and nothing to sweep. When the set is issued, the issue batch writes what this function
// returned into exhibit_set_member.label, and from then on the column is the authority.
//
// Reads no clock, no database and no setting. Imports nothing but the scheme's own types.

import {
  ROMAN_ORDINAL_CEILING,
  type ExhibitOverflowForm,
  type ExhibitScheme,
  type ExhibitSequence,
} from "./scheme.ts";

const ALPHABET_LENGTH = 26;
const UPPER_A = 65;

/**
 * The ordinal a 1-based position takes under the scheme. Position 1 is the scheme's `startAt`.
 */
export function ordinalFor(position: number, scheme: Pick<ExhibitScheme, "startAt">): number {
  if (!Number.isInteger(position) || position < 1) {
    throw new RangeError(`An exhibit position is a whole number from 1; got ${position}.`);
  }
  return scheme.startAt + position - 1;
}

/**
 * The label printed for a 1-based position: the prefix and the running part, such as "C", "P-12"
 * or "xiv". The noun is not part of it — `captionFor` adds it — because the label is what a set
 * holds unique and freezes at issue, and the noun is how a sentence introduces it.
 */
export function labelFor(position: number, scheme: ExhibitScheme): string {
  return scheme.prefix + runningPartFor(ordinalFor(position, scheme), scheme);
}

/** The label with its noun, as a citation prints it: "Exhibit C". */
export function captionFor(label: string, scheme: Pick<ExhibitScheme, "noun">): string {
  return scheme.noun.length === 0 ? label : `${scheme.noun} ${label}`;
}

/** The running part alone for an ordinal: "C" for 3, "AA" for 27, "xiv" for 14. */
export function runningPartFor(
  ordinal: number,
  scheme: Pick<ExhibitScheme, "sequence" | "overflowForm">,
): string {
  if (!Number.isInteger(ordinal) || ordinal < 1) {
    throw new RangeError(`An exhibit ordinal is a whole number from 1; got ${ordinal}.`);
  }
  return SEQUENCE_GENERATORS[scheme.sequence](ordinal, scheme.overflowForm);
}

type SequenceGenerator = (ordinal: number, overflowForm: ExhibitOverflowForm) => string;

// A closed registry: a sequence the scheme names and this table does not is a type error, so a new
// sequence cannot ship without its generator.
const SEQUENCE_GENERATORS: Readonly<Record<ExhibitSequence, SequenceGenerator>> = {
  upperLetter: (ordinal, overflowForm) => letters(ordinal, overflowForm),
  lowerLetter: (ordinal, overflowForm) => letters(ordinal, overflowForm).toLowerCase(),
  arabic: (ordinal) => String(ordinal),
  upperRoman: (ordinal) => roman(ordinal),
  lowerRoman: (ordinal) => roman(ordinal).toLowerCase(),
};

function letters(ordinal: number, overflowForm: ExhibitOverflowForm): string {
  if (overflowForm === "doubled") {
    // 1..26 are A..Z; 27..52 are AA..ZZ; 53..78 are AAA..ZZZ. The letter cycles, and each lap
    // writes it once more.
    const letter = String.fromCharCode(UPPER_A + ((ordinal - 1) % ALPHABET_LENGTH));
    const repeats = Math.floor((ordinal - 1) / ALPHABET_LENGTH) + 1;
    return letter.repeat(repeats);
  }
  // Bijective base twenty-six: 26 is Z, 27 is AA, 28 is AB, 52 is AZ, 53 is BA, 702 is ZZ.
  let remaining = ordinal;
  let written = "";
  while (remaining > 0) {
    const digit = (remaining - 1) % ALPHABET_LENGTH;
    written = String.fromCharCode(UPPER_A + digit) + written;
    remaining = Math.floor((remaining - 1) / ALPHABET_LENGTH);
  }
  return written;
}

const ROMAN_NUMERALS: readonly (readonly [number, string])[] = [
  [1000, "M"],
  [900, "CM"],
  [500, "D"],
  [400, "CD"],
  [100, "C"],
  [90, "XC"],
  [50, "L"],
  [40, "XL"],
  [10, "X"],
  [9, "IX"],
  [5, "V"],
  [4, "IV"],
  [1, "I"],
];

function roman(ordinal: number): string {
  if (ordinal > ROMAN_ORDINAL_CEILING) {
    throw new RangeError(
      `A roman numeral is written up to ${ROMAN_ORDINAL_CEILING}; ordinal ${ordinal} has none.`,
    );
  }
  let remaining = ordinal;
  let written = "";
  for (const [value, numeral] of ROMAN_NUMERALS) {
    while (remaining >= value) {
      written += numeral;
      remaining -= value;
    }
  }
  return written;
}
