/*
 * The honorifics a person's name can carry — what goes before it, and what goes after.
 *
 * SUGGESTIONS, NOT A VOCABULARY. This is the load-bearing distinction, and it is the opposite of
 * how the directory's other lists work. A name role, an identifier type, an edge type: each is a
 * closed catalog the domain fixed, stored as a code, and a value outside it is a bug. A prefix is
 * not that. `person.prefix` and `person.suffix` are free text and stay free text, because the set of
 * things people are called has no edge — a firm will meet Rev., Imam, Chief, Baroness, Ret., a
 * post-nominal from a jurisdiction nobody here has heard of, and a form somebody's own family uses.
 * A closed list would refuse a person their own name.
 *
 * So these lists exist to spare the typing, never to constrain the answer: every surface that offers
 * them offers them beside a "type your own" row, and whatever is typed is what is stored. Nothing
 * validates against these arrays, and nothing should start.
 *
 * ORDERED BY HOW OFTEN A FIRM MEETS THEM, not alphabetically — the point of a suggestion list is
 * that the common answer is reachable without reading. The judicial and legal entries sit high
 * because this is a legal practice: Hon. and Esq. are ordinary here and exotic elsewhere.
 *
 * Written with the stops a firm actually types ("Dr." rather than "Dr"), because whatever is picked
 * is what appears on the letter, and correcting punctuation afterwards is the work this saves.
 */

/** What goes before a name. Suggestions only — the stored column is free text. */
export const NAME_PREFIXES: readonly string[] = [
  "Mr.",
  "Ms.",
  "Mrs.",
  "Mx.",
  "Miss",
  "Dr.",
  // The judicial and professional forms a legal practice writes constantly.
  "Hon.",
  "Judge",
  "Justice",
  "Prof.",
  "Rev.",
  "Fr.",
  "Rabbi",
  "Imam",
  // Elected and appointed office.
  "Sen.",
  "Rep.",
  "Gov.",
  "Sheriff",
  // Service ranks, in the order a firm meets them on a file.
  "Capt.",
  "Col.",
  "Maj.",
  "Lt.",
  "Sgt.",
  "Officer",
  // Honours.
  "Sir",
  "Dame",
  "Lord",
  "Lady",
];

/** What goes after a name. Suggestions only — the stored column is free text. */
export const NAME_SUFFIXES: readonly string[] = [
  // Generational, which is the reason a suffix is on a legal record at all: it is what tells a
  // father's matter from a son's.
  "Jr.",
  "Sr.",
  "II",
  "III",
  "IV",
  "V",
  // The one this platform writes most.
  "Esq.",
  // Degrees and licences, in the order a firm meets them.
  "J.D.",
  "LL.M.",
  "M.D.",
  "D.O.",
  "D.D.S.",
  "Ph.D.",
  "R.N.",
  "P.E.",
  "C.P.A.",
  "C.F.A.",
  "M.B.A.",
  // Standing.
  "Ret.",
  "Emeritus",
];

/**
 * The suggestions for one part of a name. Takes the part rather than exposing two exports to every
 * caller, so a control that renders either one is written once and told which it is.
 */
export function honorificSuggestions(part: "prefix" | "suffix"): readonly string[] {
  return part === "prefix" ? NAME_PREFIXES : NAME_SUFFIXES;
}
