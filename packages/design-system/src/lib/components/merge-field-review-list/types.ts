/*
 * The review list's row shape — STRUCTURAL, like the picker's option (see
 * ../merge-field-picker/types.ts for why the design system does not import domain types).
 *
 * Every row is a PROPOSAL. There is deliberately no "applied" or "converted" state in this shape:
 * the only state a row carries is whether a person has confirmed it, and confirmation is the
 * consumer's to record. A component that could render "already converted" would eventually be asked
 * to, and the whole point of this surface is that a detected field is guidance a person accepts,
 * not a change that already happened to their template.
 */
export type MergeFieldReviewConfidence = "exact" | "likely" | "uncertain";

export interface MergeFieldReviewItem {
  /** Row identity — stable across re-renders, and what `onToggle` reports. */
  readonly id: string;
  /** The placeholder exactly as it appears in the document, so a person can find it there. */
  readonly sourceText: string;
  /** Where it sits — a page, a paragraph, a caption. Shown as quiet context. */
  readonly sourceLocation?: string;
  /** The human label of the field being proposed, or null when nothing fits. */
  readonly proposedLabel: string | null;
  /** Short value-type name for the proposed field ("Date", "Money"). */
  readonly proposedValueTypeLabel?: string;
  /** How sure the proposal is — shown in words, never as a bare number. */
  readonly confidence: MergeFieldReviewConfidence;
  /** One sentence explaining the proposal, in the voice of a suggestion. */
  readonly note: string;
  /** Whether a person has confirmed this row. The consumer owns it. */
  readonly confirmed: boolean;
}
