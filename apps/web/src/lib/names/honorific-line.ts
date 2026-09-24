/*
 * The honorific LINE — the reading and the rewriting behind the prefix/suffix field.
 *
 * Pure, because everything worth getting right about that control is a judgement over one string:
 * what the line holds, which part of it somebody is typing, what the list should offer while they
 * do, and what the line becomes when they pick something. The component
 * (./honorific-field.svelte) owns the primitive and the markup; this module owns the answers, and
 * is what the tests can reach.
 *
 * WHY A LINE AND NOT A LIST. People carry several honorifics — "III, Esq.", "M.D., Ph.D.", "Jr.,
 * C.P.A." — and the way they are carried is as ONE line of text, comma-separated, exactly as they
 * are written after a name. That is also exactly what is stored, because the column is free text
 * and the string is what goes on the letter. So the list of tokens is a reading of the line rather
 * than the record, and every function here ends by handing a line back.
 *
 * ORDER IS THE PERSON'S, never the list's. Suffixes have conventions (generational before degrees)
 * and they are not universal, so a pick lands at the end of what is already there and nothing is
 * reordered behind somebody's back.
 */

/** The line as a list. A comma is the separator because it is how the line is written anyway. */
export function tokensOf(line: string): string[] {
  return line
    .split(",")
    .map((token) => token.trim())
    .filter((token) => token !== "");
}

/** Whether the line already carries an entry — matched without regard to case, never twice. */
export function isHeld(tokens: readonly string[], entry: string): boolean {
  return tokens.some((token) => token.toLowerCase() === entry.toLowerCase());
}

/**
 * The part of the line somebody is TYPING — what comes after the last comma.
 *
 * ONLY WHILE THEY ARE TYPING, which is the whole reason this takes a second argument rather than
 * reading the string alone. At rest the part after the last comma is a complete honorific that was
 * settled there, and treating it as a search would narrow the list to that one entry — so the
 * second pick would be unreachable until the first was taken back off. That was the defect the
 * owner reported of this control, and this is where it is answered: a settled line is typing
 * nothing, so it narrows nothing.
 */
export function typedPart(query: string, typing: boolean): string {
  return typing ? (query.split(",").at(-1) ?? "").trim() : "";
}

/** The suggestions worth showing for what is being typed. Nothing typed offers everything. */
export function suggestionsMatching(
  suggestions: readonly string[],
  typed: string,
): readonly string[] {
  const needle = typed.toLowerCase();
  if (needle === "") return suggestions;
  return suggestions.filter((entry) => entry.toLowerCase().includes(needle));
}

/**
 * The line after an entry is chosen: appended where it is not held, taken back off where it is.
 *
 * `typed` is what the pick ANSWERS. Where somebody typed "Ho" and picked "Hon.", the half-word is
 * replaced rather than left standing beside the thing it was reaching for; where nothing was typed,
 * the pick is an addition to a settled line.
 */
export function lineWithPick(line: string, typed: string, entry: string): string {
  const held = tokensOf(line);
  if (isHeld(held, entry)) {
    return held.filter((token) => token.toLowerCase() !== entry.toLowerCase()).join(", ");
  }
  const kept = typed === "" ? held : held.slice(0, -1);
  return [...kept, entry].join(", ");
}

/** The line as it is stored: the tokens it holds, separated the way they are written. */
export function settledLine(line: string): string {
  return tokensOf(line).join(", ");
}
