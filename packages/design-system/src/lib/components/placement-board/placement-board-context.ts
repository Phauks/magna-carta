/*
 * What a board hands the things placed on it: its extent in units and the element it is drawn as,
 * so a drag can turn screen pixels into the board's own units without each part measuring for
 * itself.
 */
import { getContext, setContext } from "svelte";

export interface PlacementBoardContext {
  /** The board's width, in its own units. */
  readonly width: () => number;
  /** The board's height, in its own units. */
  readonly height: () => number;
  /** The board's element, measured at the start of each drag. */
  readonly element: () => HTMLElement | null;
}

const KEY = Symbol("placement-board");

export function setPlacementBoardContext(context: PlacementBoardContext): void {
  setContext(KEY, context);
}

export function getPlacementBoardContext(): PlacementBoardContext {
  const context = getContext<PlacementBoardContext | undefined>(KEY);
  if (context === undefined) {
    throw new Error("A PlacementBoard part must be placed inside PlacementBoard.Root.");
  }
  return context;
}
