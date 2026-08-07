/*
 * Input size classes — the house variant pattern (a plain typed record lookup, no DSL), identical
 * in shape to button/variants.ts. Input has no colour variants, so size is its only axis: the same
 * three control heights the Button offers, so a field and the button beside it can be set to one
 * row height. The heights come from the density aliases in the recipe, not from a utility, so the
 * user density axis still re-points them.
 */

export type InputSize = "sm" | "default" | "lg";

const SIZE: Record<InputSize, string> = {
  sm: "mc-input-sm",
  default: "mc-input-md",
  lg: "mc-input-lg",
};

/** The full recipe class string for an input: the base recipe plus its size. */
export function inputClasses(options: { size: InputSize }): string {
  return `mc-input ${SIZE[options.size]}`;
}
