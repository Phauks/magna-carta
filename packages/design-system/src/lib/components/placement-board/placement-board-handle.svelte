<script lang="ts">
  /*
   * PlacementBoard.Handle — one point on the board, dragged or moved with the arrow keys: the
   * corners a reader marks on a photograph, where a box would be the wrong shape. It reports where
   * it would go, in board units, and the caller writes it back.
   */
  import { getPlacementBoardContext } from "./placement-board-context.ts";
  import { draggedTo, keyTravel, shareOf } from "./placement-board-model.ts";

  let {
    x,
    y,
    label,
    step = 1,
    largeStep = 10,
    onmove,
  }: {
    /** The point across the board, in board units. */
    x: number;
    /** The point down the board, in board units. */
    y: number;
    /** The point's accessible name ("Top left corner"). */
    label: string;
    /** How far one arrow press moves the point, in board units. */
    step?: number;
    /** How far one arrow press moves it with Shift held. */
    largeStep?: number;
    onmove?: (x: number, y: number) => void;
  } = $props();

  const board = getPlacementBoardContext();

  let drag: {
    pointerX: number;
    pointerY: number;
    originX: number;
    originY: number;
    renderedWidth: number;
    renderedHeight: number;
  } | null = null;
  let frame = 0;
  let pending: { x: number; y: number } | null = null;

  const clampX = (value: number) => Math.min(Math.max(value, 0), board.width());
  const clampY = (value: number) => Math.min(Math.max(value, 0), board.height());

  function begin(event: PointerEvent): void {
    if (event.button !== 0) return;
    const rectangle = board.element()?.getBoundingClientRect();
    if (rectangle === undefined) return;
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    drag = {
      pointerX: event.clientX,
      pointerY: event.clientY,
      originX: x,
      originY: y,
      renderedWidth: rectangle.width,
      renderedHeight: rectangle.height,
    };
  }

  function follow(event: PointerEvent): void {
    if (drag === null) return;
    pending = {
      x: clampX(draggedTo(drag.originX, event.clientX - drag.pointerX, board.width(), drag.renderedWidth, step)),
      y: clampY(draggedTo(drag.originY, event.clientY - drag.pointerY, board.height(), drag.renderedHeight, step)),
    };
    if (frame !== 0) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const next = pending;
      pending = null;
      if (next !== null) onmove?.(next.x, next.y);
    });
  }

  function end(event: PointerEvent): void {
    const target = event.currentTarget as HTMLElement;
    if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
    drag = null;
  }

  function keydown(event: KeyboardEvent): void {
    const travel = keyTravel(event.key, event.shiftKey, step, largeStep);
    if (travel === null) return;
    event.preventDefault();
    onmove?.(clampX(x + travel.x), clampY(y + travel.y));
  }
</script>

<button
  type="button"
  class="mc-placement-board-handle -translate-x-1/2 -translate-y-1/2"
  aria-label={label}
  style="inset-inline-start: {shareOf(x, board.width())}; inset-block-start: {shareOf(
    y,
    board.height(),
  )}"
  onkeydown={keydown}
  onpointerdown={begin}
  onpointermove={follow}
  onpointerup={end}
  onpointercancel={end}
></button>
