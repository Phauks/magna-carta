/*
 * The filter-and-add row's vocabulary: what it says, and how a caller recognises that it was chosen.
 *
 * A vocabulary the firm owns — its document types, its payees, its activity codes — is never
 * complete, and the moment somebody needs a value that is missing is the moment they are typing it.
 * Sending them to a settings screen to add it there loses the work in progress and the sentence they
 * were halfway through. So the missing value is added from inside the list that failed to offer it.
 *
 * Bits has no "this row is an action" concept: every row in a listbox is an option with a value, and
 * choosing one sets that value. The add row is therefore a real option carrying a RESERVED value,
 * and the caller answers `isAddOption` in its value handler before treating the pick as a selection.
 * That keeps the row keyboard-reachable, announced, and highlighted exactly like every other row —
 * which is the whole point of it living in the list rather than beside it — at the cost of one
 * question in the caller's handler.
 *
 * The reserved value is deliberately not a plausible identifier: the colon makes it something no
 * firm-entered value or generated identifier in this product produces, so nothing can collide with it.
 */

/**
 * The value the add row carries. Callers compare against it with `isAddOption` rather than reading
 * it directly; it is exported for the rare caller that places the row itself.
 */
export const ADD_OPTION_VALUE = "mc-combobox:add-option";

/**
 * Whether the value a combobox just reported is the add row rather than a chosen entry.
 *
 * Takes the raw argument a value handler receives, single or multiple, so a caller never has to
 * unwrap the union before asking.
 */
export function isAddOption(value: string | readonly string[]): boolean {
  return typeof value === "string" ? value === ADD_OPTION_VALUE : value.includes(ADD_OPTION_VALUE);
}

/**
 * A multiple selection with the add row stripped out, so a caller can write the remaining real
 * selections back without the reserved value leaking into stored data.
 */
export function withoutAddOption(value: readonly string[]): string[] {
  return value.filter((entry) => entry !== ADD_OPTION_VALUE);
}

/**
 * What the add row says.
 *
 * With something typed it names the value it will add, because that is the question the person is
 * actually asking — "will this add what I just wrote?". With nothing typed it names the field
 * instead, so the row still reads as a sentence rather than as an empty pair of quotes: "Add payee".
 *
 * The field's name arrives written as a label — title case, a noun phrase — and reads mid-sentence
 * here, so its words are lowercased unless a word is an initialism, which stays as written ("Add ABA
 * number", not "Add aba number").
 */
export function addOptionLabel(fieldName: string, query: string): string {
  const typed = query.trim();
  if (typed !== "") return `Add "${typed}"`;
  const named = midSentence(fieldName.trim());
  return named === "" ? "Add" : `Add ${named}`;
}

/** A label's words as they read inside a sentence; an initialism keeps its capitals. */
function midSentence(fieldName: string): string {
  return fieldName
    .split(/\s+/)
    .map((word) => (isInitialism(word) ? word : word.toLowerCase()))
    .join(" ");
}

function isInitialism(word: string): boolean {
  const letters = word.replace(/[^A-Za-z]/g, "");
  return letters.length > 1 && letters === letters.toUpperCase();
}
