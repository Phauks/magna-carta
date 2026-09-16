/*
 * What a record still needs, as an answer that knows WHICH field it is about.
 *
 * A FORM THAT REFUSES SHOULD POINT. The commit's refusal has always been a sentence at the weak end
 * of the bar — "A date is needed." — which tells a reader what is wrong and leaves them to find the
 * field it is about. On a short form that is a glance; on the record form, which asks about a
 * matter, a title, a type, two dates, two times, a zone, a repeat, a location, a court reference, a
 * link, a description and a list of people, it is a hunt (owner, 2026-09-16: "We need better visual
 * language to showcase what is still required when the item cannot be saved").
 *
 * SO A SHORTFALL CARRIES ITS FIELD, and the field it names is marked. The bar keeps its one
 * sentence, unchanged and still first — a reader who is looking at the commit is told there why it
 * will not press — and the field carries the same sentence beneath it with `aria-invalid` on the
 * control, which is what a screen reader needs and what the design system's own LabelledField has
 * always done for a validated form. One shortfall, two places, one wording: the sentence is written
 * once here and rendered twice, so the bar and the field can never disagree.
 *
 * NOTHING IS MARKED BEFORE IT IS ANSWERED. A form that opens with every required field already
 * scarlet has told the reader they are wrong for not having typed yet. A field is marked only once
 * the form has been SUBMITTED and refused, which is the moment the reader asked for the record and
 * the platform said no — `submitted` on the caller's side, one boolean, and the marks appear
 * together. That is the standing convention for every form in this product, and it is why this
 * module hands back the list rather than the marks: WHEN to show them belongs to the form.
 *
 * THIS IS THE PATTERN, NOT A CALENDAR ONE. It lives here because the calendar's drafts are where it
 * was first needed and every question a draft answers is already a pure function; a second form that
 * wants it should move this module rather than write a second shape for the same answer.
 */

/** A field a record form asks about, as a shortfall names it. Free text, matched to the form's ids. */
export type ShortfallField = string;

/** One thing a record still needs, and which answer it is about. */
export interface Shortfall {
  /** The field the reader has to go to. Empty where the shortfall is about the record as a whole. */
  readonly field: ShortfallField;
  /** What is missing or wrong, in the words both the bar and the field show. */
  readonly sentence: string;
}

/** A shortfall about one named answer. */
export function shortfall(field: ShortfallField, sentence: string): Shortfall {
  return { field, sentence };
}

/** The sentences alone, in order — what the commit's refusal reads from. */
export function shortfallSentences(shortfalls: readonly Shortfall[]): string[] {
  return shortfalls.map((each) => each.sentence);
}

/**
 * The sentence to show beneath one field, or undefined where that field is answered.
 *
 * The FIRST shortfall naming the field, because a field with two things wrong with it is a field
 * whose reader should fix the first one: "The end date does not read as a date" and "The end date is
 * before the start" cannot both be acted on, and showing both would ask somebody to satisfy a
 * sentence that will stop applying the moment they satisfy the other.
 */
export function shortfallFor(
  shortfalls: readonly Shortfall[],
  field: ShortfallField,
): string | undefined {
  return shortfalls.find((each) => each.field === field)?.sentence;
}
