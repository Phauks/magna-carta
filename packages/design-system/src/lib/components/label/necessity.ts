/*
 * Whether a field must be filled, and how that is shown: two separate decisions.
 *
 * Every labelled field says which it is, `required` or `optional`, as a fact about the form. How the
 * difference is DRAWN is one setting, here, and nowhere else: mark the optional fields with a word
 * and leave the required ones bare, or mark the required ones with a star and leave the optional
 * ones bare. Switching it is a one-line change that reaches every form, because no call site writes
 * a star or the word "Optional" itself.
 *
 * A field that is neither (a checkbox, a switch, a choice that always holds a value, a read-only
 * fact) passes no necessity and gets no mark under either setting.
 */

/** Whether the person must fill the field before the form can be committed. */
export type FieldNecessity = "required" | "optional";

/** Which side of the difference carries a visible mark. */
export type NecessityMarking = "mark-optional" | "mark-required";

/** The one setting every label reads. */
export const NECESSITY_MARKING: NecessityMarking = "mark-optional";

/** What a label shows after its name, or null for nothing. */
export interface NecessityMark {
  /** The visible text. */
  readonly text: string;
  /**
   * Hidden from assistive technology. A star is decoration over the control's own required
   * state, which a screen reader announces already; a word is read.
   */
  readonly decorative: boolean;
}

export function necessityMark(
  necessity: FieldNecessity | undefined,
  marking: NecessityMarking = NECESSITY_MARKING,
): NecessityMark | null {
  if (necessity === undefined) return null;
  if (marking === "mark-optional") {
    return necessity === "optional" ? { text: "Optional", decorative: false } : null;
  }
  return necessity === "required" ? { text: "*", decorative: true } : null;
}
