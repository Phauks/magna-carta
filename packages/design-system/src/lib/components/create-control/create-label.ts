/*
 * The one label grammar every create control speaks: "New" and a noun.
 *
 * A create control is read by position more than by text — a member reaches for the button at the
 * end of the action row — so what the text does is CONFIRM which record is about to be made, in the
 * fewest characters that can. "New Fee", "New File", "New Matter". A noun is one capitalised word
 * and never a phrase, because the control's width is fixed (size.create-control in the tokens) and
 * held identical on every screen: a phrase would be clipped, and a control that fitted its own
 * label would shove the search beside it every time the label changed, which is the reflow the
 * fixed width exists to prevent.
 *
 * FIXED IS NOT FROZEN. The one width may be re-measured when the product needs a longer noun than
 * it holds — it went to 140px for "New Template" — and every control moves with it, because one
 * width on every screen is the property, not the number. What a screen may never do is widen the
 * control for itself.
 */

/**
 * The longest noun the control's fixed width holds with the plus glyph and the button's own
 * padding. Measured, not guessed: in the reading face at the small size, "New Template" sets 81.6px
 * and a 140px control (size.create-control) leaves 80px of label after the padding, the glyph and
 * its gap — so eight characters fit with a little over two points to spare and nine do not. A noun
 * that outgrows it is refused rather than clipped.
 *
 * A control that opens a MENU spends a further 20px on its chevron, which no eight-character noun
 * survives. It does not have to: a menu reads the bare "New" and names the kinds on its items, so
 * the only labels measured against this budget are the ones a single-action control carries.
 *
 * The budget and the token move together. This was seven while "New Message" was the longest label
 * in the product; the template library needed one more character, and widening by four points was
 * judged the smaller cost than naming the record something it is not.
 */
export const CREATE_NOUN_MAX_LENGTH = 8;

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
        `${CREATE_NOUN_MAX_LENGTH}. Choose a shorter noun: the width is one token shared by every ` +
        "screen, so widening it to fit one label widens the control everywhere.",
    );
  }
}
