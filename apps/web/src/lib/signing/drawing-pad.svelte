<script lang="ts">
  /*
   * A pad a signer draws a mark on with a mouse, a finger or a pen. The ink is the document's ink
   * (./signature-marks.ts), and `canvas` is handed back so the dialog can trim and encode it.
   */
  import Eraser from "@lucide/svelte/icons/eraser";
  import Button from "@magna-carta/design-system/button";
  import { inkColour } from "./signature-marks.ts";

  let {
    label,
    canvas = $bindable(null),
    drawn = $bindable(false),
    disabled = false,
    tall = true,
  }: {
    label: string;
    canvas?: HTMLCanvasElement | null;
    drawn?: boolean;
    disabled?: boolean;
    tall?: boolean;
  } = $props();

  let last: { x: number; y: number } | null = null;

  function point(event: PointerEvent): { x: number; y: number } | null {
    if (canvas === null) return null;
    const box = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - box.left) / box.width) * canvas.width,
      y: ((event.clientY - box.top) / box.height) * canvas.height,
    };
  }

  function begin(event: PointerEvent): void {
    if (disabled || canvas === null) return;
    canvas.setPointerCapture(event.pointerId);
    last = point(event);
  }

  function move(event: PointerEvent): void {
    if (last === null || canvas === null) return;
    const next = point(event);
    const context = canvas.getContext("2d");
    if (next === null || context === null) return;
    context.strokeStyle = inkColour();
    context.lineWidth = 4;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.beginPath();
    context.moveTo(last.x, last.y);
    context.lineTo(next.x, next.y);
    context.stroke();
    last = next;
    drawn = true;
  }

  function end(): void {
    last = null;
  }

  function clear(): void {
    if (canvas === null) return;
    canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    drawn = false;
  }
</script>

<div class="flex flex-col gap-8">
  <canvas
    bind:this={canvas}
    width="900"
    height={tall ? 300 : 200}
    class="block w-full touch-none rounded-md border border-border-strong bg-surface-raised {disabled ? 'cursor-not-allowed' : 'cursor-crosshair'}"
    aria-label={label}
    onpointerdown={begin}
    onpointermove={move}
    onpointerup={end}
    onpointercancel={end}
  ></canvas>
  <div class="flex items-center justify-between">
    <span class="text-xs text-text-muted">{label}</span>
    <Button variant="ghost" size="sm" disabled={disabled || !drawn} onclick={clear}>
      <Eraser aria-hidden="true" />Clear
    </Button>
  </div>
</div>
