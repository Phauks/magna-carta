/*
 * The practice areas a firm starts from.
 *
 * WHY THIS LIST EXISTS AT ALL. A matter's practice area is one of the firm's own MATTER TYPES:
 * per-firm rows, created and renamed and deactivated by the firm, and referenced by identifier on
 * every matter. That is the right model and it has one gap — nothing seeds it. A firm's first
 * matter is therefore opened against an empty vocabulary, and the field that should say what kind
 * of work this is says "no matter types are set up" instead. This module is the starting point that
 * closes that gap: the areas most firms recognize, offered beside whatever the firm has already
 * built, so the first matter can be typed without a detour through settings.
 *
 * IT IS A STARTING POINT, NOT AN ENUM, AND THE DIFFERENCE IS THE WHOLE DESIGN. Nothing here is
 * stored on a matter. Choosing one of these names ADOPTS it — the firm's own matter-type row is
 * created from it, and from that moment the name, its code and its continued existence belong to
 * the firm exactly as if somebody had typed it. A firm that renames "Criminal Defence" or deletes
 * "Bankruptcy" is not fighting this list, because this list no longer has anything to say about
 * it: an area the firm has adopted is never offered from here again.
 *
 * SPELLING. The names print as a firm would write them on a letterhead. They are deliberately the
 * broad areas rather than sub-specialties — a firm that wants "Chapter 7" and "Chapter 13" as
 * separate types adds them, and nothing here should try to anticipate that.
 */

/** One area of practice, as it prints and as a numbering scheme would abbreviate it. */
export interface PracticeArea {
  /** The name, as it prints and as the firm's matter type would be named. */
  readonly name: string;
  /**
   * The short code a matter-numbering scheme can use for this area. Kept short and unambiguous
   * across the list, because a number that reads `2026-LIT-0147` is read aloud down a phone.
   */
  readonly code: string;
}

/**
 * The starting vocabulary. Broad areas of practice, in the order they read rather than by any
 * ranking: a firm scanning this list is looking for its own work, not for the most common answer.
 */
export const STARTING_PRACTICE_AREAS: readonly PracticeArea[] = [
  { name: "Litigation", code: "LIT" },
  { name: "Family Law", code: "FAM" },
  { name: "Criminal Defence", code: "CRIM" },
  { name: "Estate Planning", code: "EST" },
  { name: "Probate and Trust Administration", code: "PROB" },
  { name: "Real Estate", code: "RE" },
  { name: "Corporate and Business", code: "CORP" },
  { name: "Immigration", code: "IMM" },
  { name: "Employment and Labour", code: "EMP" },
  { name: "Personal Injury", code: "PI" },
  { name: "Bankruptcy and Insolvency", code: "BK" },
  { name: "Intellectual Property", code: "IP" },
  { name: "Tax", code: "TAX" },
  { name: "Elder Law", code: "ELD" },
  { name: "Civil Rights", code: "CIV" },
  { name: "Construction", code: "CON" },
  { name: "Environmental", code: "ENV" },
  { name: "Insurance Defence", code: "INS" },
  { name: "Municipal and Administrative", code: "MUN" },
  { name: "Appeals", code: "APP" },
];

/** Two names are the same area when they differ only by case or by surrounding space. */
function sameName(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

/**
 * The starting areas the firm has NOT adopted yet.
 *
 * An area the firm already holds — under any casing — is the firm's own row and is offered from the
 * firm's own list, never twice. This is what keeps the picker from showing "Litigation" above
 * "Litigation" the moment somebody adopts it.
 */
export function unadoptedPracticeAreas(firmTypeNames: readonly string[]): readonly PracticeArea[] {
  return STARTING_PRACTICE_AREAS.filter(
    (area) => !firmTypeNames.some((name) => sameName(name, area.name)),
  );
}

/**
 * The starting area a typed name matches, or null.
 *
 * Typing "litigation" into the field and pressing the add row should adopt the starting area rather
 * than minting a second, code-less row that reads identically. So the add path asks this first, and
 * only invents a type when the name is genuinely new.
 */
export function matchingPracticeArea(name: string): PracticeArea | null {
  return STARTING_PRACTICE_AREAS.find((area) => sameName(area.name, name)) ?? null;
}
