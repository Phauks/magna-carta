/*
 * The Soon affordance's model: what a not-yet-served control owes the person looking at it.
 *
 * Kept out of the component so the wording is one function with one test rather than a string
 * assembled inside markup. Every disabled-but-designed control in the product says this sentence,
 * so the sentence gets to be checked.
 */

/**
 * What a call site spreads onto the control it is wrapping. Everything a Soon affordance owes that
 * control, in one object, so no surface hand-writes `disabled` beside a title of its own again.
 */
export interface SoonControlProperties {
  disabled: true;
  title: string;
  "aria-describedby": string;
}

/**
 * The one sentence a not-yet-served capability says about itself.
 *
 * It states the fact and names what is missing, in the reader's words, and stops. What the reader may then do about it is
 * not the affordance's business: there is nothing to do about it except wait for the dependency,
 * and a control that says so at length is a control that has been read once and skipped after.
 *
 * `reason` is a noun phrase ("file conversion"), which is what lets the wording be identical
 * everywhere while the dependency differs.
 */
export function soonDependencySentence(reason: string): string {
  return `Not built yet: ${reason}.`;
}

/** The attributes for the wrapped control, given its dependency and the description's element id. */
export function soonControlProperties(
  reason: string,
  descriptionIdentifier: string,
): SoonControlProperties {
  return {
    disabled: true,
    title: soonDependencySentence(reason),
    "aria-describedby": descriptionIdentifier,
  };
}
