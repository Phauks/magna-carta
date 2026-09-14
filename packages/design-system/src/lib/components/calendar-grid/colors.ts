/*
 * The colours a calendar can be given, and the fact that they are a SUBSET of the product's one
 * palette rather than a second list.
 *
 * Nine of the eleven. Black and white are left out for a reason a reader would otherwise have to
 * discover by trying them: a calendar's colour paints a two-pixel rule down the leading edge of a
 * chip that already sits on the surface's own paper, so white paints nothing and black is the ink
 * the chip's own text is already in. Everything else in the palette reads there.
 *
 * The order is the palette's, never re-written here — `paletteSubset` keeps it — so a reader who
 * coloured a folder and a calendar the same week meets the same swatches in the same order.
 */
import { paletteSubset, type PaletteColor, type PaletteColorName } from "../../palette/index.ts";

/** The names a calendar offers, as the palette spells them. */
const OFFERED: readonly PaletteColorName[] = [
  "red",
  "orange",
  "yellow",
  "green",
  "blue",
  "purple",
  "pink",
  "brown",
  "grey",
];

/** The palette a calendar is coloured from, in the order it renders. */
export const CALENDAR_COLORS: readonly PaletteColor[] = paletteSubset(OFFERED);

/** Whether a name is one this calendar palette offers, for reading a stored preference back. */
export function isCalendarColor(value: string): value is PaletteColorName {
  return CALENDAR_COLORS.some((color) => color.name === value);
}

/**
 * A colour for a calendar nobody has chosen one for, dealt round the palette by position, so a
 * firm that turns on eight calendars and colours none of them still gets eight distinguishable
 * columns. Stable in the position, not random: the same rail draws the same colours every time.
 */
export function defaultCalendarColor(index: number): PaletteColorName {
  const colors = CALENDAR_COLORS;
  const position = ((index % colors.length) + colors.length) % colors.length;
  return colors[position]!.name;
}
