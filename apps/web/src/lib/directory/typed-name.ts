/*
 * What a name typed into a picker becomes when the record it names has to be made.
 *
 * A person who typed "Rosalind Chase" into a client field and pressed the add row has already said
 * the name once; asking them to type it again into the New Person window, split into its parts, is
 * the same work twice. So the typed text seeds the window: the last word is the family name and
 * everything before it the given name, which is right for most Western-order names and is a SEED,
 * never a record — every part stays editable, and a one-word name seeds only the given name so the
 * window still asks for the family name rather than inventing one.
 *
 * An organization is seeded whole: its legal name is one string.
 */

export interface TypedPersonName {
  readonly given: string;
  readonly family: string;
}

export function personNameFromTyped(typed: string): TypedPersonName {
  const words = typed
    .trim()
    .split(/\s+/u)
    .filter((word) => word !== "");
  if (words.length === 0) return { given: "", family: "" };
  if (words.length === 1) return { given: words[0] ?? "", family: "" };
  return { given: words.slice(0, -1).join(" "), family: words.at(-1) ?? "" };
}
