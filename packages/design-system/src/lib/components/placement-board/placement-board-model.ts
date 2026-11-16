/*
 * PlacementBoard's arithmetic, apart from any DOM so it can be asserted directly.
 *
 * A board is a rectangle measured in whole UNITS the caller chooses (thousandths of an inch for a
 * check, pixels of a photograph for four corners). Everything placed on it is stated in those units
 * and drawn as a share of the board, so the board can be any width on screen and every box still
 * sits where it would on the paper. A pointer moving N pixels across a board drawn W pixels wide is
 * N times (board units / W) units, rounded to the caller's step so a drag lands on the same grid a
 * key press does.
 */

/** A length on the board as a share of the board's own extent, for an inline style. */
export function shareOf(units: number, extent: number): string {
  if (extent <= 0) return "0%";
  return `${((units / extent) * 100).toFixed(4)}%`;
}

/** The units one screen pixel stands for on a board drawn `renderedPixels` wide. */
export function unitsPerPixel(boardUnits: number, renderedPixels: number): number {
  return renderedPixels <= 0 ? 0 : boardUnits / renderedPixels;
}

/** A value rounded to the nearest multiple of `step` (a step of 1 or less rounds to a whole unit). */
export function snapTo(value: number, step: number): number {
  const grid = step > 1 ? step : 1;
  return Math.round(value / grid) * grid;
}

/** Where a pointer drag that began at `origin` has carried a value, on the board's own grid. */
export function draggedTo(
  origin: number,
  pointerTravelPixels: number,
  boardUnits: number,
  renderedPixels: number,
  step: number,
): number {
  return snapTo(origin + pointerTravelPixels * unitsPerPixel(boardUnits, renderedPixels), step);
}

/** How far one arrow key moves a thing: `step`, or `largeStep` with Shift held. */
export function keyTravel(
  key: string,
  shiftKey: boolean,
  step: number,
  largeStep: number,
): { readonly x: number; readonly y: number } | null {
  const distance = shiftKey ? largeStep : step;
  switch (key) {
    case "ArrowLeft":
      return { x: -distance, y: 0 };
    case "ArrowRight":
      return { x: distance, y: 0 };
    case "ArrowUp":
      return { x: 0, y: -distance };
    case "ArrowDown":
      return { x: 0, y: distance };
    default:
      return null;
  }
}

/** The SVG `points` attribute for an outline through the given corners, in board units. */
export function outlinePoints(
  points: readonly { readonly x: number; readonly y: number }[],
): string {
  return points.map((point) => `${point.x},${point.y}`).join(" ");
}
