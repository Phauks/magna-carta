/*
 * Masthead density — the house variant pattern (a plain typed record mapping options to recipe
 * class names, same shape as button/variants.ts; no DSL).
 *
 * The masthead is the one door to the display serif, so its title's step is the recipe's to own,
 * never a utility on the element. What density changes is that step and the stack's rhythm: a page
 * whose chrome shares its band with navigation cannot spend forty pixels on a title line, and the
 * alternative — letting a screen reach for `text-2xl` itself — would put the display scale back in
 * the hands of every call site, which is the thing this recipe exists to prevent.
 */

export type MastheadDensity = "default" | "compact" | "dense";

const DENSITY: Record<MastheadDensity, string> = {
  default: "",
  compact: "mc-masthead-compact",
  dense: "mc-masthead-dense",
};

/** The modifier class for a density, or "" for the default (which needs no modifier). */
export function mastheadDensityClass(density: MastheadDensity): string {
  return DENSITY[density];
}
