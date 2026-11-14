/*
 * What a record reference reads as, decided without a DOM so it can be asserted directly rather
 * than inferred from a rendered panel — the same division ../action-dialog/action-dialog-model.ts
 * draws between what a story shows and what a test pins.
 *
 * The table is the argument. A reader can see at a glance that a draft number is marked as one, that
 * a tentative number is shown as plainly as a permanent one (it is a real number the record really
 * carries), and that a missing number still names the kind of record.
 */
import type { RecordReference, RecordSubject } from "./types.ts";

/**
 * What a draft number is, said on the number itself rather than beside it: the line keeps one
 * format for every kind of record, the number in italics, and this is its accessible description.
 * One string, here, so the wording is a thing a test can pin and a ruling can change in one edit.
 */
export const DRAFT_NUMBER_DESCRIPTION =
  "Draft number. It is held for this record until it is saved, and given back if it is cancelled.";

/**
 * The mark between the reference and each fact beside it. ONE separator for the product.
 *
 * A constant rather than a per-call-site choice because it was a per-call-site choice: the panels
 * this replaces used a middle dot in five places and an em dash in a sixth, for the same join.
 */
export const SUBJECT_SEPARATOR = "·";

/** How a reference resolves for rendering. */
export type RenderedReference =
  /** The number exists. `draft` marks one held for a record still being created. */
  | {
      readonly shape: "identified";
      readonly kind: string;
      readonly number: string;
      readonly draft: boolean;
    }
  /**
   * There is no number to show. The kind alone is still an honest answer — the reader is told WHAT
   * is being acted on, just not which one — and it is what a record whose number has not loaded
   * yet, or a draft whose number is still being held, reads as.
   */
  | { readonly shape: "unnumbered"; readonly kind: string };

/** What this reference reads as. */
export function renderReference(reference: RecordReference): RenderedReference {
  if (reference.number === null) return { shape: "unnumbered", kind: reference.kind };
  return {
    shape: "identified",
    kind: reference.kind,
    number: reference.number,
    draft: (reference.standing ?? "drawn") === "draft",
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
