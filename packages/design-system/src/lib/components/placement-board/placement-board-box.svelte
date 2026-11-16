<script lang="ts">
  /*
   * PlacementBoard.Box — one labelled box on the board, moved by dragging it or by the arrow keys,
   * and sized by the grip at its end corner.
   *
   * THE BOX REPORTS, THE CALLER DECIDES. A drag or a key press reports where the box would go
   * (`onmove`, in board units, on the caller's step) and the caller writes it back, clamped or not.
   * A box that moved itself would have to know which parts of the board are forbidden and why, and
   * that is the caller's business.
   *
   * A WRONG BOX IS RED AND SAYS NOTHING. `invalid` paints the edge and the tag in the danger
   * register; the reason, where there is one, is the caller's to state beside its commit.
   *
   * A drag writes once per animation frame however fast the device reports, so a box follows the
   * hand without the caller's state being written dozens of times a frame.
   */
  import type { Snippet } from "svelte";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import { getPlacementBoardContext } from "./placement-board-context.ts";
  import { draggedTo, keyTravel, shareOf, snapTo } from "./placement-board-model.ts";

  let {
    x,
    y,
    width,
    height,
    label,
    selected = false,
    invalid = false,
    textScale,
    align = "start",
    step = 1,
    largeStep = 10,
    minimumWidth = 1,
    resizable = true,
    tagged = true,
    onselect,
    onmove,
    onresize,
    class: className,
    children,
  }: {
    /** The box's start edge, in board units. */
    x: number;
    /** The box's top edge, in board units. */
    y: number;
    /** The box's width, in board units. */
    width: number;
    /** The box's height, in board units. */
    height: number;
    /** The box's name, shown on its tag and read as its accessible name. */
    label: string;
    /** Whether this is the box being worked on. */
    selected?: boolean;
    /** Whether the box cannot stand where it is. Drawn red, with no words. */
    invalid?: boolean;
    /** The text size as a share of the board's width (points over the board's width in points). */
    textScale: number;
    /** Which edge of the box the text sits against. */
    align?: "start" | "end";
    /** How far one arrow press moves the box, and the grid a drag lands on, in board units. */
    step?: number;
    /** How far one arrow press moves the box with Shift held. */
    largeStep?: number;
    /** The narrowest the grip may make the box. */
    minimumWidth?: number;
    /** Whether the box offers a grip to size it. */
    resizable?: boolean;
    /** Whether the box's name stands on a tag above it. A narrow board shows only the chosen one's. */
    tagged?: boolean;
    onselect?: () => void;
    /** Where the box would go, in board units. */
    onmove?: (x: number, y: number) => void;
    /** How wide the box would be, in board units. */
    onresize?: (width: number) => void;
    class?: string;
    /** What the box reads. */
    children?: Snippet;
  } = $props();

  const board = getPlacementBoardContext();

  interface Drag {
    readonly mode: "move" | "resize";
    readonly pointerX: number;
    readonly pointerY: number;
    readonly originX: number;
    readonly originY: number;
    readonly originWidth: number;
    readonly renderedWidth: number;
    readonly renderedHeight: number;
  }

  let drag: Drag | null = null;
  let pending: { x: number; y: number; width: number } | null = null;
  let frame = 0;

  function begin(event: PointerEvent, mode: Drag["mode"]): void {
    if (event.button !== 0) return;
    const rectangle = board.element()?.getBoundingClientRect();
    if (rectangle === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    onselect?.();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    drag = {
      mode,
      pointerX: event.clientX,
      pointerY: event.clientY,
      originX: x,
      originY: y,
      originWidth: width,
      renderedWidth: rectangle.width,
      renderedHeight: rectangle.height,
    };
  }

  function follow(event: PointerEvent): void {
    if (drag === null) return;
    const travelX = event.clientX - drag.pointerX;
    const travelY = event.clientY - drag.pointerY;
    if (drag.mode === "move") {
      pending = {
        x: draggedTo(drag.originX, travelX, board.width(), drag.renderedWidth, step),
        y: draggedTo(drag.originY, travelY, board.height(), drag.renderedHeight, step),
        width,
      };
    } else {
      pending = {
        x,
        y,
        width: Math.max(
          minimumWidth,
          draggedTo(drag.originWidth, travelX, board.width(), drag.renderedWidth, step),
        ),
      };
    }
    if (frame !== 0) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const next = pending;
      pending = null;
      if (next === null || drag === null) return;
      if (drag.mode === "move") onmove?.(next.x, next.y);
      else onresize?.(next.width);
    });
  }

  function end(event: PointerEvent): void {
    if (drag === null) return;
    const target = event.currentTarget as HTMLElement;
    if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
    drag = null;
  }

  function keydown(event: KeyboardEvent): void {
    const travel = keyTravel(event.key, event.shiftKey, step, largeStep);
    if (travel === null) return;
    event.preventDefault();
    onmove?.(snapTo(x + travel.x, 1), snapTo(y + travel.y, 1));
  }
</script>

<button
  type="button"
  class={mergeClasses(
    "mc-placement-board-box bg-surface-overlay/70 data-[invalid]:bg-status-danger-subtle/80",
    className,
  )}
  data-selected={selected ? "" : undefined}
  data-invalid={invalid ? "" : undefined}
  aria-pressed={selected}
  style="inset-inline-start: {shareOf(x, board.width())}; inset-block-start: {shareOf(
    y,
    board.height(),
  )}; inline-size: {shareOf(width, board.width())}; block-size: {shareOf(
    height,
    board.height(),
  )}; font-size: {(textScale * 100).toFixed(4)}cqi"
  onclick={() => onselect?.()}
  onkeydown={keydown}
  onpointerdown={(event) => begin(event, "move")}
  onpointermove={follow}
  onpointerup={end}
  onpointercancel={end}
>
  <!-- The field's name leads the button's name, shown on its tag or, where tags are off, only
       to a screen reader, so the name always holds what is seen. -->
  {#if tagged || selected}
    <span class="mc-placement-board-box-tag">{label}</span>
  {:else}
    <span class="sr-only">{label}</span>
  {/if}
  <span class="mc-placement-board-box-text" data-align={align}>{@render children?.()}</span>
  {#if resizable}
    <span
      class="mc-placement-board-box-grip"
      aria-hidden="true"
      onpointerdown={(event) => begin(event, "resize")}
      onpointermove={follow}
      onpointerup={end}
      onpointercancel={end}
    ></span>
  {/if}
</button>
