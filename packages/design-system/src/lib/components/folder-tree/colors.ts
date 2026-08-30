/*
 * The folder palette, as plain data with no glyph in it — so the one thing a reader argues about
 * (which colours there are, and in what order) is testable on its own, without a browser.
 *
 * The order of FOLDER_COLORS is the order the reader sees: the spectrum, then the achromatics. It
 * is written out rather than sorted, because "rainbow" is not a computable property of a colour
 * name and a sort would be a second, quieter answer to a question this list already answers.
 *
 * `ink` is the check mark's colour when a swatch is the chosen one — the mark sits INSIDE the
 * square, so it must read against that square's own fill rather than against the menu behind it.
 * Only the palest fills take the dark ink.
 *
 * THE FILLS THEMSELVES are custom properties (`--mc-folder-color-*`) declared in this component's
 * recipe, where each one aliases a design token. Four of the eleven have no ramp of their own in
 * the token set yet and currently alias their nearest neighbour; the recipe says which, and adding
 * the ramps changes only that one block.
 */
import type { FolderColorName } from "./types.ts";

export type FolderColor = {
  name: FolderColorName;
  /** The swatch's accessible name — a swatch has no text of its own. */
  label: string;
  /** Which ink the chosen-mark takes so it reads against this fill. */
  ink: "light" | "dark";
};

/** The palette, in the order it renders. */
export const FOLDER_COLORS: readonly FolderColor[] = [
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
export function folderColorInk(name: FolderColorName | undefined): "light" | "dark" {
  return FOLDER_COLORS.find((color) => color.name === name)?.ink ?? "light";
}
