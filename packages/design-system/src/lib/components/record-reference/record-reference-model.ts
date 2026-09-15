/*
 * What a record reference reads as, decided without a DOM so it can be asserted directly rather
 * than inferred from a rendered panel — the same division ../action-dialog/action-dialog-model.ts
 * draws between what a story shows and what a test pins.
 *
 * The table is the argument. A reader can see at a glance that a preview says it is a preview, that
 * a tentative number is shown as plainly as a permanent one (it is a real number the record really
 * carries), and that a missing number is never silence. None of that was true of the panels this
 * replaces, where the wording existed in one file and the other thirty showed nothing.
 */
import type { RecordReference, RecordSubject } from "./types.ts";

/**
 * What a preview is, said beside the number rather than instead of it.
 *
 * One string, here, so the wording is a thing a test can pin and a ruling can change in one edit.
 * It states plainly that nothing has been taken: a number shown before the save is what the next
 * record would draw, so a record saved first takes it and this one moves on.
 */
export const PREVIEW_NOTE = "drawn when this is saved";

/** What a panel says when the number does not exist yet and will be drawn by the save. */
export const AWAITING_NUMBER_SENTENCE = "A number is drawn when this is saved.";

/**
 * The mark between the reference and each fact beside it. ONE separator for the product.
 *
 * A constant rather than a per-call-site choice because it was a per-call-site choice: the panels
 * this replaces used a middle dot in five places and an em dash in a sixth, for the same join.
 */
export const SUBJECT_SEPARATOR = "·";

/** How a reference resolves for rendering. */
export type RenderedReference =
  /** The number exists. `note` carries the preview's own words, where it is one. */
  | {
      readonly shape: "identified";
      readonly kind: string;
      readonly number: string;
      readonly note: string | null;
    }
  /** A number is coming, and the save is what draws it. */
  | { readonly shape: "awaiting"; readonly sentence: string }
  /**
   * There is no number to show and none is promised. The kind alone is still an honest answer —
   * the reader is told WHAT is being acted on, just not which one — and it is what a record whose
   * number has not loaded yet reads as, rather than a panel claiming a save would draw one.
   */
  | { readonly shape: "unnumbered"; readonly kind: string };

/** What this reference reads as. */
export function renderReference(reference: RecordReference): RenderedReference {
  const standing = reference.standing ?? "drawn";
  if (reference.number === null) {
    return standing === "preview"
      ? { shape: "awaiting", sentence: AWAITING_NUMBER_SENTENCE }
      : { shape: "unnumbered", kind: reference.kind };
  }
  return {
    shape: "identified",
    kind: reference.kind,
    number: reference.number,
    note: standing === "preview" ? PREVIEW_NOTE : null,
  };
}

/**
 * Whether this subject has anything to render at all.
 *
 * A subject with no reference and no facts renders nothing, and the shells then omit the subtitle
 * element entirely rather than leaving an empty line under the heading — which is what a caller
 * that passes a subject built from a record still loading would otherwise get.
 */
export function subjectIsEmpty(subject: RecordSubject): boolean {
  return subject.reference === undefined && (subject.facts ?? []).length === 0;
}
