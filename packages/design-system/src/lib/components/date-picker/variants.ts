/*
 * Date-field size classes — the house variant pattern (a plain typed record lookup, no DSL), and
 * deliberately the SAME axis the Input carries rather than one of its own. A date field
 * and a text field sit in the same rows and the same filter menus, so a surface that sets one to a
 * height must be able to set the other to the same height; a second scale here would be a second
 * answer to "how tall is a control", which is the whole reason `InputSize` is imported instead of
 * redeclared. The heights come from the density aliases in the recipe, so the user density axis
 * still re-points them.
 */

import type { InputSize } from "../input/variants.ts";

const SIZE: Record<InputSize, string> = {
  sm: "mc-date-field-sm",
  default: "mc-date-field-md",
  lg: "mc-date-field-lg",
};

/** The full recipe class string for a date field: the base recipe plus its size. */
export function dateFieldClasses(options: { size: InputSize }): string {
  return `mc-date-field ${SIZE[options.size]}`;
}
