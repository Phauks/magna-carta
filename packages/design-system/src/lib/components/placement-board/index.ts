/*
 * PlacementBoard is a composition of parts (the house namespace shape): bare names plus
 * PlacementBoard-prefixed aliases. The pure arithmetic is exported for a caller that has to agree
 * with it (a drag elsewhere that must land on the same grid).
 */
import Root from "./placement-board.svelte";
import Box from "./placement-board-box.svelte";
import Handle from "./placement-board-handle.svelte";
import Guide from "./placement-board-guide.svelte";
import Outline from "./placement-board-outline.svelte";
import Region from "./placement-board-region.svelte";
import Mark from "./placement-board-mark.svelte";

export {
  draggedTo,
  keyTravel,
  outlinePoints,
  shareOf,
  snapTo,
  unitsPerPixel,
} from "./placement-board-model.ts";

export {
  Root,
  Box,
  Handle,
  Guide,
  Outline,
  Region,
  Mark,
  //
  Root as PlacementBoard,
  Box as PlacementBoardBox,
  Handle as PlacementBoardHandle,
  Guide as PlacementBoardGuide,
  Outline as PlacementBoardOutline,
  Region as PlacementBoardRegion,
  Mark as PlacementBoardMark,
};
