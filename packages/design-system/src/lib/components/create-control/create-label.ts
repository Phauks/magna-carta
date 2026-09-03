/*
 * The one label grammar every create control speaks: "New" and a noun.
 *
 * A create control is read by position more than by text — a member reaches for the button at the
 * end of the action row — so what the text does is CONFIRM which record is about to be made, in the
 * fewest characters that can. "New Fee", "New File", "New Matter". A noun is one capitalised word
 * and never a phrase, because the control's width is fixed (size.create-control in the tokens) and
 * held identical on every screen: a phrase would be clipped, and a control that widened to fit
 * one would shove the search beside it, which is the reflow the fixed width exists to prevent.
 */

/**
 * The longest noun the control's fixed width holds with the plus glyph, a menu chevron and the
 * button's own padding. "Packet" and "Matter" are the longest in use; the budget leaves one
 * character of growth and no more, so a noun that outgrows it is refused rather than clipped.
 */
export const CREATE_NOUN_MAX_LENGTH = 7;

/** The bare label a control reads when the screen has no noun to offer. */
export const CREATE_BARE_LABEL = "New";

/** What the control reads for a noun: "New Fee". */
export function createLabel(noun: string): string {
  return `${CREATE_BARE_LABEL} ${noun}`;
}

/**
 * Refuses a noun the label grammar cannot carry: a phrase, a lower-case or plural word, or one
 * longer than the width holds. Thrown rather than returned, because a bad noun is a defect in the
 * screen that named it and should fail the moment the screen loads.
 */
export function assertCreateNoun(noun: string): void {
  if (!/^[A-Z][a-z]+$/u.test(noun)) {
    throw new Error(
      `The create noun "${noun}" is not one capitalised word. A create control reads "New <Noun>" ` +
        "and nothing else; a phrase or a plural does not fit that grammar.",
    );
  }
  if (noun.length > CREATE_NOUN_MAX_LENGTH) {
    throw new Error(
      `The create noun "${noun}" is ${noun.length} characters; the control's fixed width holds ` +
        `${CREATE_NOUN_MAX_LENGTH}. Choose a shorter noun rather than widening the control.`,
    );
  }
}
