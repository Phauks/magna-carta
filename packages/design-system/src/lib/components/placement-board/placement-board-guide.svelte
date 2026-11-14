<script lang="ts">
  /*
   * PlacementBoard.Guide — a printed rule on the board with its caption, for drawing what a blank
   * form looks like when there is no picture of the real one: a line to write on and the words
   * printed beside it. It is ink on the paper, never a control, so it takes no pointer and no focus.
   */
  import { getPlacementBoardContext } from "./placement-board-context.ts";
  import { shareOf } from "./placement-board-model.ts";

  let {
    x,
    y,
    width,
    caption,
    captionPlacement = "before",
    textScale,
    ruled = true,
  }: {
    /** Where the rule starts, in board units. */
    x: number;
    /** Where the rule runs down the board, in board units. */
    y: number;
    /** The rule's length, in board units. */
    width: number;
    /** The words printed beside it. */
    caption?: string;
    /** Where the words sit: before the rule's start, after its end, or under it. */
    captionPlacement?: "before" | "after" | "below";
    /** The caption's size as a share of the board's width. */
    textScale: number;
    /** Whether a line is drawn, or only the caption. */
    ruled?: boolean;
  } = $props();

  const board = getPlacementBoardContext();
</script>

<span
  class="mc-placement-board-guide"
  data-ruled={ruled ? "" : undefined}
  aria-hidden="true"
  style="inset-inline-start: {shareOf(x, board.width())}; inset-block-start: {shareOf(
    y,
    board.height(),
  )}; inline-size: {shareOf(width, board.width())}; font-size: {(textScale * 100).toFixed(4)}cqi"
>
  {#if caption}
    <span class="mc-placement-board-guide-caption" data-placement={captionPlacement}>{caption}</span>
  {/if}
</span>
