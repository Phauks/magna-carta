// The grammatical model the pronoun helpers work over, and the neutral forms an unstated set falls
// back to.
//
// This lives inside the expression folder because it is a LANGUAGE fact: the five positions are what
// a template can ask for, and the neutral set is what the language answers with when the firm's
// record says nothing. The Directory's own pronoun type is the STORAGE side of the same idea and is
// deliberately a separate declaration — this folder imports nothing but itself and
// @magna-carta/money (test/expression-purity.test.ts), because the checker has to stay runnable in a
// browser. The resolution boundary maps one onto the other, exactly as it maps name columns onto
// merge values.

export const PRONOUN_FORMS = [
  "subject",
  "object",
  "possessiveDeterminer",
  "possessivePronoun",
  "reflexive",
] as const;

export type PronounForm = (typeof PRONOUN_FORMS)[number];

// Whether the set takes a singular verb ("she is") or a plural one ("they are"). Nothing about the
// letters of a pronoun says which — "they" agrees plurally and "xe" singularly — so it travels with
// the forms rather than being worked out from them.
export type PronounAgreement = "singular" | "plural";

export interface PronounDeclension {
  readonly subject: string;
  readonly object: string;
  readonly possessiveDeterminer: string;
  readonly possessivePronoun: string;
  readonly reflexive: string;
  readonly agreement: PronounAgreement;
}

// WHAT A DOCUMENT SAYS ABOUT SOMEONE WHOSE PRONOUNS NOBODY RECORDED. The unrecorded case is the
// common case — most Directory entries are opened from a matter intake, not from a conversation
// about pronouns — so it has to be the SAFE case, and safe here means a word that is correct for
// anyone. They/them names nobody's gender, reads as ordinary legal English, and is what a careful
// drafter writes about a person they have not met. The alternatives are all worse in a filed
// document: a blank leaves a hole mid-sentence, a visible marker turns every ordinary letter into a
// document needing repair, an error refuses to assemble over a fact that was never required, and a
// guess from the person's name is the failure this whole field exists to prevent.
//
// The reflexive is "themselves" rather than "themself" to stay consistent with the plural agreement
// this set declares — a document that writes "they are" and then "themself" is inconsistent with
// itself. A person who prefers "themself" records it; the default is only ever the answer for a
// person who told the firm nothing.
export const NEUTRAL_PRONOUNS: PronounDeclension = Object.freeze({
  subject: "they",
  object: "them",
  possessiveDeterminer: "their",
  possessivePronoun: "theirs",
  reflexive: "themselves",
  agreement: "plural",
});

export function isPronounForm(candidate: string): candidate is PronounForm {
  // A linear scan over five frozen strings, never a property lookup keyed by template text.
  for (const form of PRONOUN_FORMS) {
    if (form === candidate) return true;
  }
  return false;
}

// One grammatical position of a declension. A switch rather than an index, so a form name that
// arrived from a template can never reach anything but these five values.
export function pronounFormOf(declension: PronounDeclension, form: PronounForm): string {
  switch (form) {
    case "subject":
      return declension.subject;
    case "object":
      return declension.object;
    case "possessiveDeterminer":
      return declension.possessiveDeterminer;
    case "possessivePronoun":
      return declension.possessivePronoun;
    case "reflexive":
      return declension.reflexive;
  }
}
