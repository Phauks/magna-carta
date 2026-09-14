/*
 * The folder palette — the product's one member-chosen palette (`lib/palette/index.ts`), under the
 * names this component has always exported.
 *
 * The list itself moved out when the calendar grew a palette of its own: "which colours does this
 * product offer, and in what order" is one fact, and two components each writing it down is two
 * answers free to disagree. A folder still offers all eleven, so the re-export is the whole of it;
 * the calendar takes a subset, which is its own statement and not a second list.
 *
 * THE FILLS are the custom properties `--mc-palette-*`, declared in
 * `styles/recipes/palette.css`. This component's own `--mc-folder-color-*` names alias them, so a
 * call site written against either spelling paints the same colour.
 */
import { PALETTE_COLORS, paletteColorInk, type PaletteColor } from "../../palette/index.ts";
import type { FolderColorName } from "./types.ts";

export type FolderColor = PaletteColor;

/** The palette, in the order it renders. */
export const FOLDER_COLORS: readonly FolderColor[] = PALETTE_COLORS;

/** The ink a chosen swatch's mark takes. Unknown names fall to the light ink, as most fills do. */
export function folderColorInk(name: FolderColorName | undefined): "light" | "dark" {
  return paletteColorInk(name);
}
