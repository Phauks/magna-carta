// A person's pronouns, as the person states them.
//
// THE FIRM RECORDS WHAT IT WAS TOLD; NOTHING HERE INFERS. There is no derivation from a given name,
// from a courtesy title, from an honorific, or from any other column, and there must never be one:
// a guessed pronoun misgenders a real person in a document that gets filed, served, and read by
// people who were not in the room. An unstated pronoun set is an unstated fact, and the renderer's
// answer to an unstated fact is the neutral one, not a guess.
//
// PRONOUNS ARE NOT A GENDER FIELD, and neither is computed from the other. This module stores five
// grammatical forms and how they agree with a verb; it holds no notion of what a person is.
//
// THE WHOLE DECLENSION IS THE UNIT. A label — "she/her" — names two of the five forms and settles
// nothing about the other three for a set the platform has never seen, so resolving a label into
// forms means a lookup table, and a lookup table is a closed enum wearing a different hat: the sets
// it lacks are precisely the ones whose owners are used to being rendered wrong. Storing the forms
// means a template can render every grammatical position for any set at all, including one invented
// tomorrow, with no code change and no release.

export const PRONOUN_VERB_NUMBERS = ["singular", "plural"] as const;

// Which verb form the set takes: "she is" is singular agreement, "they are" plural. Recorded rather
// than derived, because nothing in the forms says it — "they" agrees plurally, "xe" singularly, and
// no rule over the letters separates them.
export type PronounVerbNumber = (typeof PRONOUN_VERB_NUMBERS)[number];

// The five grammatical positions a document can put a pronoun in. Named in full — a template author
// reads these names in the field inspector, and "possessiveDeterminer" against "possessivePronoun"
// is the difference between "their signature" and "the signature is theirs".
export interface PronounSet {
  readonly subject: string; // she signed
  readonly object: string; // we served her
  readonly possessiveDeterminer: string; // her signature
  readonly possessivePronoun: string; // the signature is hers
  readonly reflexive: string; // she represented herself
  readonly verbNumber: PronounVerbNumber;
}

// The columns a pronoun set occupies on a directory_person row. All six move together; the table's
// own CHECK refuses a row where some are recorded and some are not.
export interface PronounColumns {
  readonly pronoun_subject: string | null;
  readonly pronoun_object: string | null;
  readonly pronoun_possessive_determiner: string | null;
  readonly pronoun_possessive_pronoun: string | null;
  readonly pronoun_reflexive: string | null;
  readonly pronoun_verb_number: string | null;
}

function present(value: string | null | undefined): string | undefined {
  if (value === null || value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

// A stored row's pronouns, or null when the person has stated none.
//
// TOTAL AND ALL-OR-NOTHING BY CONSTRUCTION. A row that somehow carries a partial set — restored from
// a backup taken before the table CHECK existed, or written by a future path that forgets — reads as
// NO set rather than as a half set, so the renderer falls back to the neutral forms instead of
// mixing one person's "she" with another set's "them" inside one sentence. That failure is invisible
// on the page and is the one this whole field exists to prevent, so the read refuses to produce it
// even where the write path should already have.
export function pronounSetFromColumns(row: Partial<PronounColumns>): PronounSet | null {
  const subject = present(row.pronoun_subject);
  const object = present(row.pronoun_object);
  const possessiveDeterminer = present(row.pronoun_possessive_determiner);
  const possessivePronoun = present(row.pronoun_possessive_pronoun);
  const reflexive = present(row.pronoun_reflexive);
  const verbNumber = present(row.pronoun_verb_number);
  if (
    subject === undefined ||
    object === undefined ||
    possessiveDeterminer === undefined ||
    possessivePronoun === undefined ||
    reflexive === undefined ||
    !isPronounVerbNumber(verbNumber)
  ) {
    return null;
  }
  return { subject, object, possessiveDeterminer, possessivePronoun, reflexive, verbNumber };
}

export function isPronounVerbNumber(candidate: string | undefined): candidate is PronounVerbNumber {
  return candidate === "singular" || candidate === "plural";
}

// How a person's pronouns are written when they are shown rather than used — a card, a list row, a
// signature block. The convention is the subject and object forms joined by a slash, which is how
// people write their own; it is a RENDERING of the stored set, never a second stored fact that could
// disagree with the forms a document actually prints.
export function pronounLabel(pronouns: PronounSet): string {
  return `${pronouns.subject}/${pronouns.object}`;
}

// A caller-supplied set, validated into storable columns. Every form must be non-blank: a set is
// accepted whole or refused whole, so no path can write the partial row the table CHECK would
// reject with a constraint error the caller cannot read.
export class IncompletePronounSetError extends Error {
  constructor(missing: readonly string[]) {
    super(
      `a pronoun set is recorded whole or not at all; these forms were blank: ${missing.join(", ")}`,
    );
    this.name = "IncompletePronounSetError";
  }
}

export function validatePronounSet(input: PronounSet): PronounSet {
  const missing: string[] = [];
  const take = (label: string, value: string): string => {
    const kept = present(value);
    if (kept === undefined) missing.push(label);
    return kept ?? "";
  };
  const validated: PronounSet = {
    subject: take("subject", input.subject),
    object: take("object", input.object),
    possessiveDeterminer: take("possessiveDeterminer", input.possessiveDeterminer),
    possessivePronoun: take("possessivePronoun", input.possessivePronoun),
    reflexive: take("reflexive", input.reflexive),
    verbNumber: input.verbNumber,
  };
  if (!isPronounVerbNumber(input.verbNumber)) missing.push("verbNumber");
  if (missing.length > 0) throw new IncompletePronounSetError(missing);
  return validated;
}
