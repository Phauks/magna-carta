/*
 * MergeFieldChip status classes — the house variant pattern (a plain typed record lookup, no DSL),
 * identical in shape to badge/variants.ts.
 *
 * The status axis is NOT decoration: it is the one thing a person reading a template needs to know
 * about an inserted field, which is whether they will have to do anything about it. `automatic`
 * fills itself, `manual` is work waiting for them, `unavailable` will come out blank or as a
 * marker, and `invalid` means the field does not exist and the template cannot be used as-is.
 */

export type MergeFieldChipStatus = "automatic" | "manual" | "unavailable" | "invalid";

const STATUS: Record<MergeFieldChipStatus, string> = {
  automatic: "mc-merge-field-chip-automatic",
  manual: "mc-merge-field-chip-manual",
  unavailable: "mc-merge-field-chip-unavailable",
  invalid: "mc-merge-field-chip-invalid",
};

/**
 * The screen-reader text that states the status in words. The colour and the icon carry it
 * visually; this is what stops the status being colour-only information.
 */
export const MERGE_FIELD_CHIP_STATUS_TEXT: Record<MergeFieldChipStatus, string> = {
  automatic: "Filled automatically",
  manual: "Needs to be entered",
  unavailable: "No value available",
  invalid: "Not a known merge field",
};

/** The full recipe class string for a chip: the base recipe plus its status. */
export function mergeFieldChipClasses(options: { status: MergeFieldChipStatus }): string {
  return `mc-merge-field-chip ${STATUS[options.status]}`;
}
