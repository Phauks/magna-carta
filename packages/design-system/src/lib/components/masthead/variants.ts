/*
 * Masthead density — the house variant pattern (a plain typed record mapping options to recipe
 * class names, same shape as button/variants.ts; no DSL).
 *
 * The masthead is the one door to the display serif, so its title's step is the recipe's to own,
 * never a utility on the element: letting a screen reach for `text-2xl` itself would put the
 * display scale back in the hands of every call site, which is the thing this recipe exists to
 * prevent. `compact` is for a band that shares its height with something else — the matter chrome
 * carries its section navigation in the same band — and it steps the title from 2rem to 1.5rem,
 * which still reads as a masthead against the 0.875rem citation beneath it.
 *
 * A third step down was measured and dropped. At 1.25rem the display face is close enough to the
 * citation that the scale contrast the register is built on nearly goes, and it bought nothing:
 * the matter band's height was floored by its other column at that point, so the smaller title
 * paid in contrast for pixels the layout would not give back.
 */

export type MastheadDensity = "default" | "compact";

const DENSITY: Record<MastheadDensity, string> = {
  default: "",
  compact: "mc-masthead-compact",
};

/** The modifier class for a density, or "" for the default (which needs no modifier). */
export function mastheadDensityClass(density: MastheadDensity): string {
  return DENSITY[density];
}
