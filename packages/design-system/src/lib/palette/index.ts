/*
 * The product's ONE palette of member-chosen colours — the set a person picks from when they
 * colour a thing they own: a folder in the file manager, a calendar on the firm's grid.
 *
 * It lives here rather than inside either of those components because "which colours does this
 * product offer, and in what order" is one fact with one home. Two components each writing their
 * own list is two answers that drift, and a reader who coloured a folder red and a calendar red
 * would find two different reds.
 *
 * The order is the order the reader sees: the spectrum, then the achromatics. It is written out
 * rather than sorted, because "rainbow" is not a computable property of a colour name and a sort
 * would be a second, quieter answer to a question this list already answers.
 *
 * `ink` is a mark's colour when the swatch is the chosen one — the mark sits INSIDE the square, so
 * it must read against that square's own fill rather than against the menu behind it. Only the
 * palest fills take the dark ink.
 *
 * THE FILLS THEMSELVES are the custom properties `--mc-palette-*`, declared once in
 * `styles/recipes/palette.css`, where each one aliases a design token. A surface that paints with
 * one reads the property; nothing anywhere writes a colour value.
 */

export { default as PaletteSwatches } from "./palette-swatches.svelte";

/** The colours a member can give something they own. */
export type PaletteColorName =
  | "red"
  | "orange"
  | "yellow"
  | "green"
  | "blue"
  | "purple"
  | "pink"
  | "brown"
  | "grey"
  | "black"
  | "white";

export interface PaletteColor {
  name: PaletteColorName;
  /** The swatch's accessible name — a swatch has no text of its own. */
  label: string;
  /** Which ink a mark drawn on this fill takes so it reads against it. */
  ink: "light" | "dark";
}

/** The palette, in the order it renders. */
export const PALETTE_COLORS: readonly PaletteColor[] = [
  { name: "red", label: "Red", ink: "light" },
  { name: "orange", label: "Orange", ink: "light" },
  { name: "yellow", label: "Yellow", ink: "dark" },
  { name: "green", label: "Green", ink: "light" },
  { name: "blue", label: "Blue", ink: "light" },
  { name: "purple", label: "Purple", ink: "light" },
  { name: "pink", label: "Pink", ink: "dark" },
  { name: "brown", label: "Brown", ink: "light" },
  { name: "grey", label: "Grey", ink: "light" },
  { name: "black", label: "Black", ink: "light" },
  { name: "white", label: "White", ink: "dark" },
];

/** The ink a chosen swatch's mark takes. Unknown names fall to the light ink, as most fills do. */
export function paletteColorInk(name: PaletteColorName | undefined): "light" | "dark" {
  return PALETTE_COLORS.find((color) => color.name === name)?.ink ?? "light";
}

/**
 * The palette narrowed to the names a surface offers, in the palette's own order.
 *
 * A surface offers fewer than eleven when some of them would not do its job — a calendar chip
 * painted white is a chip with no colour on it — and it says which it keeps rather than writing a
 * second list in a second order.
 */
export function paletteSubset(names: readonly PaletteColorName[]): readonly PaletteColor[] {
  const wanted = new Set<PaletteColorName>(names);
  return PALETTE_COLORS.filter((color) => wanted.has(color.name));
}
