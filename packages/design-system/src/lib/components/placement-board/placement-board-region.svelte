<script lang="ts">
  /*
   * PlacementBoard.Region — an area of the board drawn as an outline: where one part of a sheet
   * sits on a larger one, such as a check and its stubs on a letter page. It is a picture of the
   * paper, never a control, so it takes no pointer and no focus; the board's own label names it.
   *
   * A solid edge is a part the reader works on; a dashed edge is a part that comes along with it
   * (a stub torn off at a perforation). The caption, where there is one, sits inside the top
   * corner at a size stated against the board's width, so a small board draws a small caption.
   */
  import { getPlacementBoardContext } from "./placement-board-context.ts";
  import { shareOf } from "./placement-board-model.ts";

  let {
    x,
    y,
    width,
    height,
    edge = "solid",
    caption,
    textScale = 0,
  }: {
    /** The area's start edge, in board units. */
    x: number;
    /** The area's top edge, in board units. */
    y: number;
    /** The area's width, in board units. */
    width: number;
    /** The area's height, in board units. */
    height: number;
    /** A solid edge for the part worked on, a dashed one for a part that comes along with it. */
    edge?: "solid" | "dashed";
    /** Words inside the top corner. */
    caption?: string;
    /** The caption's size as a share of the board's width. */
    textScale?: number;
  } = $props();

  const board = getPlacementBoardContext();
</script>

<span
  class="mc-placement-board-region"
  data-edge={edge}
  aria-hidden="true"
  style="inset-inline-start: {shareOf(x, board.width())}; inset-block-start: {shareOf(
    y,
    board.height(),
  )}; inline-size: {shareOf(width, board.width())}; block-size: {shareOf(
    height,
    board.height(),
  )}; font-size: {(textScale * 100).toFixed(4)}cqi"
>
  {#if caption}
    <span class="mc-placement-board-region-caption">{caption}</span>
  {/if}
</span>
