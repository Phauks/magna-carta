<script lang="ts">
  /*
   * PlacementBoard.Mark — a line of text printed at a fixed place on the board: what a sheet will
   * read once it is printed, drawn where it will land. The still counterpart of Box: a Box is a
   * thing the reader moves, a Mark is the result shown back to them, so it takes no pointer and no
   * focus and a board of fifty marks is not fifty tab stops.
   *
   * Its text is sized against the board's width (container units), the same way a Box's is, so a
   * line drawn on a quarter-size page reads at a quarter of its printed size and keeps its place
   * relative to everything else on the sheet.
   */
  import type { Snippet } from "svelte";
  import { getPlacementBoardContext } from "./placement-board-context.ts";
  import { shareOf } from "./placement-board-model.ts";

  let {
    x,
    y,
    width,
    height,
    textScale,
    align = "start",
    strong = false,
    children,
  }: {
    /** The line's start edge, in board units. */
    x: number;
    /** The line's top edge, in board units. */
    y: number;
    /** The line's width, in board units; text past it is cut off, as a printed box cuts it. */
    width: number;
    /** The line's height, in board units. */
    height: number;
    /** The text size as a share of the board's width. */
    textScale: number;
    /** Which edge of the line the text sits against. */
    align?: "start" | "end";
    /** Whether the line is set in the heavier weight. */
    strong?: boolean;
    /** What the line reads. */
    children?: Snippet;
  } = $props();

  const board = getPlacementBoardContext();
</script>

<span
  class="mc-placement-board-mark"
  data-align={align}
  data-strong={strong ? "" : undefined}
  style="inset-inline-start: {shareOf(x, board.width())}; inset-block-start: {shareOf(
    y,
    board.height(),
  )}; inline-size: {shareOf(width, board.width())}; block-size: {shareOf(
    height,
    board.height(),
  )}; font-size: {(textScale * 100).toFixed(4)}cqi">{@render children?.()}</span
>
