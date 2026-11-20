<script lang="ts">
  /*
   * The picture a report is sent with, and the covers the sender drags over it.
   *
   * The canvas shows the picture at the width the dialog allows; a drag is turned into the
   * picture's own pixels, so a cover lands where it was drawn at any size. Each cover is painted in
   * as it is drawn, which is what the sender will see sent. Undo takes the last one off.
   */
  import Button from "@magna-carta/design-system/button";
  import { coverBetween, paintCovered, type Cover } from "./screen-capture.ts";

  let {
    picture,
    covers = $bindable([]),
    disabled = false,
  }: {
    /** The uncovered screen, as captured when the dialog opened. */
    picture: HTMLCanvasElement;
    /** The covers drawn so far, in the picture's pixels. */
    covers?: Cover[];
    disabled?: boolean;
  } = $props();

  let canvas = $state<HTMLCanvasElement | null>(null);
  let dragStart = $state<{ x: number; y: number } | null>(null);
  let dragging = $state<Cover | null>(null);

  $effect(() => {
    if (canvas === null) return;
    paintCovered(canvas, picture, dragging === null ? covers : [...covers, dragging]);
  });

  function pointOf(event: PointerEvent): { x: number; y: number } | null {
    if (canvas === null) return null;
    const box = canvas.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) return null;
    return {
      x: ((event.clientX - box.left) / box.width) * picture.width,
      y: ((event.clientY - box.top) / box.height) * picture.height,
    };
  }

  function begin(event: PointerEvent): void {
    if (disabled) return;
    const point = pointOf(event);
    if (point === null) return;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    dragStart = point;
    dragging = null;
  }

  function move(event: PointerEvent): void {
    if (dragStart === null) return;
    const point = pointOf(event);
    if (point === null) return;
    dragging = coverBetween(dragStart, point, picture);
  }

  function end(): void {
    // A click with no drag covers nothing: a cover has to have been drawn to be one.
    if (dragging !== null && dragging.width >= 4 && dragging.height >= 4) {
      covers = [...covers, dragging];
    }
    dragStart = null;
    dragging = null;
  }

  function undo(): void {
    covers = covers.slice(0, -1);
  }
</script>

<div class="flex flex-col gap-8">
  <canvas
    bind:this={canvas}
    class="block h-auto w-full cursor-crosshair touch-none rounded-md border border-border-default"
    aria-label="Screenshot of the screen behind this dialog. Drag over anything private to cover it."
    onpointerdown={begin}
    onpointermove={move}
    onpointerup={end}
    onpointercancel={end}
  ></canvas>
  <div class="flex flex-wrap items-center justify-between gap-8">
    <p class="text-xs text-text-muted">
      Drag over anything private to cover it.
      {covers.length === 1 ? "1 part covered." : covers.length > 1 ? `${covers.length} parts covered.` : ""}
    </p>
    <Button variant="secondary" size="sm" disabled={disabled || covers.length === 0} onclick={undo}>
      Undo
    </Button>
  </div>
</div>
