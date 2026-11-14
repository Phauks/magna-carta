<script lang="ts">
  /*
   * PlacementBoard.Outline — a closed outline through points on the board, drawn over the picture:
   * the edge of the region four corner handles mark. It is drawn in the board's own units, so it
   * follows the handles exactly at any size.
   */
  import { getPlacementBoardContext } from "./placement-board-context.ts";
  import { outlinePoints } from "./placement-board-model.ts";

  let {
    points,
  }: {
    /** The corners, in order round the outline, in board units. */
    points: readonly { readonly x: number; readonly y: number }[];
  } = $props();

  const board = getPlacementBoardContext();
</script>

<svg
  class="mc-placement-board-outline size-full"
  aria-hidden="true"
  viewBox="0 0 {board.width()} {board.height()}"
  preserveAspectRatio="none"
>
  <polygon class="mc-placement-board-outline-shape" points={outlinePoints(points)} />
</svg>
