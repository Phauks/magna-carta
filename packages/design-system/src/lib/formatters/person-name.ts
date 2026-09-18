/*
 * Whose act a record carries.
 *
 * The rule is one sentence and it has cost real corrections: it is ALWAYS the person's name.
 *
 * Two things follow, and both are enforced by the shape of this function rather than by care at the
 * call site:
 *
 *   1. **Never "You".** There is no viewer argument here, so no call site can branch on whether the
 *      person reading is the person who acted. A history that says "You" is unreadable to everyone
 *      else who opens it, and it stops being true the moment it is quoted. A runtime once recorded
 *      a deleter as "You" and the deleted list then displayed it; a stored first-person stand-in is
 *      therefore treated as the data loss it is rather than rendered as somebody's name.
 *   2. **A name is history, not a join.** The argument is the name the RECORD carries, captured when
 *      the act happened — never a lookup against who is a member today. A person who has left the
 *      firm still did the work, and their entries still say so; "No longer a member" in the place a
 *      name belongs is data loss, not a status.
 */

/**
 * What stands where a record genuinely carries no name. It states the gap rather than filling it:
 * an empty cell reads as a rendering fault, and a guess reads as a fact.
 */
export const UNRECORDED_PERSON = "Not recorded";

/**
 * First-person stand-ins, which are never a person's name. A record holding one of these lost the
 * name it was supposed to keep, and showing the gap is more honest than showing the stand-in.
 */
const FIRST_PERSON_STAND_INS = new Set(["you", "me", "myself", "yourself", "self"]);

export interface PersonNameOptions {
  /** What renders where the record carries no name. Override it to suit a surface's voice. */
  whenUnrecorded?: string;
}

/**
 * The name a record recorded, ready to render.
 *
 * @param recorded The name captured on the record itself, not resolved from current membership.
 */
export function personName(
  recorded: string | null | undefined,
  options: PersonNameOptions = {},
): string {
  const unrecorded = options.whenUnrecorded ?? UNRECORDED_PERSON;
  if (recorded === null || recorded === undefined) return unrecorded;
  const name = recorded.trim().replace(/\s+/g, " ");
  if (name === "") return unrecorded;
  return FIRST_PERSON_STAND_INS.has(name.toLowerCase()) ? unrecorded : name;
}

/**
 * A person's initials, as an avatar's fallback draws them: the first letter of the first word and
 * of the last, upper-cased; one letter for a one-word name; nothing for no name at all. Two letters
 * at most, because a monogram is read at a glance and "JRRT" is not.
 */
export function personInitials(name: string): string {
  const words = name.split(/\s+/).filter((word) => word !== "");
  if (words.length === 0) return "";
  const first = words[0]?.[0] ?? "";
  const last = words.length > 1 ? (words.at(-1)?.[0] ?? "") : "";
  return (first + last).toUpperCase();
}
