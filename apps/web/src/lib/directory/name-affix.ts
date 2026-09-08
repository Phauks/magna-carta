/*
 * What goes in front of a name and what goes after it — the two lists the product offers, and the
 * one rule for holding several of the second.
 *
 * BOTH ARE OFFERED AND NEITHER IS CLOSED. A courtesy title and a post-nominal are conventions, not
 * enumerations: the firm will meet a rank, an order and a qualification nobody put on a list, and a
 * field that refuses one records the person's name wrongly. So these are what the field OFFERS —
 * the ones a legal practice writes every week, spelled one way so the firm's letters do not vary —
 * and anything typed is added from inside the list that failed to offer it.
 *
 * A PERSON MAY HOLD SEVERAL SUFFIXES AND EXACTLY ONE PREFIX. "Jr." and "Esq." are two different
 * facts about one person and a field holding one of them loses the other; a person addressed as
 * both Dr. and Ms. is addressed as one of them in any given letter, and which is a matter of
 * context rather than of the record. The suffixes are stored in the one `name_suffix` column,
 * comma-separated, which is how they are written on an envelope and how `normalizeName` already
 * reads them.
 */

/** What the prefix field offers, in the order a list of titles is read. */
export const NAME_PREFIXES: readonly string[] = [
  "Mr.",
  "Ms.",
  "Mrs.",
  "Miss",
  "Mx.",
  "Dr.",
  "Prof.",
  "Rev.",
  "Fr.",
  "Rabbi",
  "Hon.",
  "Judge",
  "Justice",
  "Sen.",
  "Rep.",
  "Gov.",
  "Sir",
  "Dame",
  "Capt.",
  "Col.",
  "Maj.",
  "Lt.",
  "Sgt.",
];

/**
 * What the suffix field offers: the generational suffixes first, then the qualifications a firm
 * meets on the other side of a matter as often as on its own.
 */
export const NAME_SUFFIXES: readonly string[] = [
  "Jr.",
  "Sr.",
  "II",
  "III",
  "IV",
  "V",
  "Esq.",
  "J.D.",
  "LL.M.",
  "M.D.",
  "D.O.",
  "D.D.S.",
  "Ph.D.",
  "R.N.",
  "P.E.",
  "CPA",
  "CFA",
  "Ret.",
];

/** The separator the stored column uses, and the one an envelope uses. */
const SUFFIX_SEPARATOR = ", ";

/** The suffixes a stored `name_suffix` holds, in the order they were recorded. */
export function suffixesFrom(stored: string | null | undefined): string[] {
  return (stored ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "");
}

/** What to store for a set of suffixes, or null where there are none. */
export function storedSuffix(suffixes: readonly string[]): string | null {
  const kept = suffixes.map((suffix) => suffix.trim()).filter((suffix) => suffix !== "");
  return kept.length === 0 ? null : kept.join(SUFFIX_SEPARATOR);
}

/**
 * The same suffix already on the record, however it was capitalized or punctuated.
 *
 * "JR" typed under a recorded "Jr." is the same fact, and adding it twice puts "Jr., JR" on the
 * firm's correspondence. Case and punctuation are what vary; the letters are what identify it.
 */
export function isSameAffix(left: string, right: string): boolean {
  const bare = (value: string) => value.toLowerCase().replaceAll(/[^\p{Letter}\p{Number}]/gu, "");
  return bare(left) === bare(right);
}
