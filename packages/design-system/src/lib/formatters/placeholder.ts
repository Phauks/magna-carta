/*
 * What a field's ghost text says.
 *
 * Every placeholder in the product is the FIELD'S NAME — Amount, Description, Reason, Payee, Matter,
 * Time Worked, Internal Memo — and never a description of the field, an example, or an instruction
 * to the person filling it in. Ghost text disappears exactly when someone starts typing, which is
 * the moment an instruction would be needed, so a placeholder that carries information loses it at
 * the worst possible time. Anything a person must be told belongs in an inline hint under the field,
 * where it stays.
 *
 * So the placeholder derives from the label rather than being authored a second time: passing the
 * field's own label through here makes the two impossible to drift apart, and makes "the placeholder
 * is not the field's name" a thing a sweep can detect rather than a thing a reviewer has to notice.
 */

/**
 * A field name is a short noun phrase. Past this many words it is a sentence wearing a label's
 * clothes, whatever it starts with.
 */
const MAXIMUM_FIELD_NAME_WORDS = 5;

/**
 * Verbs an instruction opens with. A single word from this set is fine on its own — a search box's
 * field name IS "Search" — so it only reads as an instruction when something follows it.
 */
const INSTRUCTION_OPENERS = new Set([
  "add",
  "begin",
  "choose",
  "click",
  "drag",
  "enter",
  "find",
  "give",
  "paste",
  "pick",
  "press",
  "provide",
  "search",
  "select",
  "set",
  "specify",
  "start",
  "tap",
  "type",
  "upload",
  "use",
  "write",
]);

/** Punctuation that ends a sentence. A field's name ends with none of it. */
const SENTENCE_ENDINGS = /[.!?…]$/;

/** A trailing colon, or the asterisk a required field's label sometimes carries. Neither is a name. */
const LABEL_DECORATION = /[\s:*]+$/;

function normalize(text: string): string {
  return text.replace(LABEL_DECORATION, "").trim().replace(/\s+/g, " ");
}

/**
 * The ghost text for a field, from that field's own label.
 *
 * The label arrives as it is written beside the control, so a trailing colon and a required-field
 * asterisk come off and internal whitespace collapses. Nothing else changes: a name that is already
 * a noun phrase is already the answer, and rewording it would be inventing a second name for the
 * same field.
 */
export function placeholderOf(fieldName: string): string {
  return normalize(fieldName);
}

/**
 * Whether a string reads as a field's name rather than as a description or an instruction — what a
 * sweep over the product's placeholders asserts.
 *
 * It answers the shape of the text, not its meaning: a name is a short noun phrase that does not
 * end a sentence, does not offer an example, and does not open with a verb aimed at the reader.
 */
export function readsAsFieldName(text: string): boolean {
  const name = normalize(text);
  if (name === "") return false;
  if (SENTENCE_ENDINGS.test(name)) return false;
  if (name.includes("...")) return false;
  if (/\be\.?g\b/i.test(name)) return false;

  const words = name.split(" ");
  if (words.length > MAXIMUM_FIELD_NAME_WORDS) return false;
  return !(words.length > 1 && INSTRUCTION_OPENERS.has(words[0]?.toLowerCase() ?? ""));
}
