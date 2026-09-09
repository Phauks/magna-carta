/*
 * A person's name, as parts and as the one line those parts read as.
 *
 * The platform holds a person's name in five columns — prefix, given, middle, family, suffix — in
 * every place it names one, and it holds the rendered line beside them because that is what a
 * screen prints, a letter is addressed to, and a roster sorts. This module owns the rule that turns
 * one into the other, so the two can never disagree about a person whose middle name is blank or
 * whose suffix carries two honorifics.
 *
 * ONE RULE, NOT A FORMAT PER SURFACE. The parts join in reading order, separated by single spaces,
 * with empty parts dropped rather than leaving a double space. Nothing here reorders a suffix,
 * abbreviates a given name, or inserts a comma before "Jr." — a name is what its owner says it is,
 * and a renderer that improves one is a renderer that gets somebody's name wrong on a pleading.
 */

/** The five parts, each absent as null or an empty string — the shape both stores use. */
export interface PersonNameParts {
  readonly prefix?: string | null;
  readonly given?: string | null;
  readonly middle?: string | null;
  readonly family?: string | null;
  readonly suffix?: string | null;
}

/**
 * The line the parts read as, or "" where the record holds no part at all. A caller with a stored
 * display name to fall back on decides that itself — an empty answer here means "these parts say
 * nothing", never "use this empty string".
 */
export function renderPersonName(parts: PersonNameParts): string {
  return [parts.prefix, parts.given, parts.middle, parts.family, parts.suffix]
    .map((part) => part?.trim() ?? "")
    .filter((part) => part !== "")
    .join(" ");
}

/** Whether these parts say anything at all — the question a fallback is chosen on. */
export function hasPersonNameParts(parts: PersonNameParts): boolean {
  return renderPersonName(parts) !== "";
}

/**
 * A best-effort reading of a name that was only ever stored as one line.
 *
 * THIS GUESSES, AND NOTHING MAY STORE ITS ANSWER WITHOUT A PERSON CONFIRMING IT. A single string
 * cannot be split back into parts — "Mary Anne van der Berg III" has no rule that recovers it — so
 * this exists for exactly one purpose: seeding a FORM whose owner is looking at it and can correct
 * it before saving. Filling a database column from it would be inventing a fact about somebody's
 * name, which is the thing the parts were added to stop.
 *
 * The rule is the least clever one that is right most of the time: the first word is the given
 * name, the last is the family name, and anything between them is the middle. One word is a given
 * name and nothing else, because a lone word is far more often somebody's first name than their
 * surname. Prefixes and suffixes are deliberately not detected — recognising "Dr." would mean a
 * list, and a list would be wrong for the names it does not carry, which are the ones that matter.
 */
export function splitNameForReview(line: string): PersonNameParts {
  const words = line
    .trim()
    .split(/\s+/)
    .filter((word) => word !== "");
  if (words.length === 0) return {};
  if (words.length === 1) return { given: words[0] };
  return {
    given: words[0],
    middle: words.slice(1, -1).join(" ") || null,
    family: words.at(-1),
  };
}
