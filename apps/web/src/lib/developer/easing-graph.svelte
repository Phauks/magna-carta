<script lang="ts">
  /*
   * EasingGraph — an interactive cubic-bezier editor for the developer menu. Time runs along the
   * x-axis, progress up the y-axis; the two gold handles are the bezier control points — drag
   * them (or type into the paired number fields, the keyboard path) and the curve re-points the
   * live easing token immediately.
   *
   * Geometry: the unit square is 200x200 viewBox units with 40 units of headroom above and below,
   * because progress (y) may legally overshoot [0, 1] — that headroom is what lets a curve bounce.
   * Time (x) is clamped to [0, 1]: cubic-bezier() rejects x outside the unit range.
   */
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import type { CubicBezierPoints } from "./motion-overrides.ts";

  let {
    value,
    onchange,
  }: { value: CubicBezierPoints; onchange: (points: CubicBezierPoints) => void } = $props();

  const SIZE = 200;
  const PAD = 40;
  const Y_MAX = 1 + PAD / SIZE;
  const Y_MIN = -(PAD / SIZE);

  const HANDLE_FIELDS = [
    { label: "x1", index: 0, min: 0, max: 1 },
    { label: "y1", index: 1, min: Y_MIN, max: Y_MAX },
    { label: "x2", index: 2, min: 0, max: 1 },
    { label: "y2", index: 3, min: Y_MIN, max: Y_MAX },
  ] as const;

  let svgElement = $state<SVGSVGElement | null>(null);
  let dragging = $state<0 | 1 | null>(null);

  function toPixelX(x: number): number {
    return x * SIZE;
  }
  function toPixelY(y: number): number {
    return PAD + (1 - y) * SIZE;
  }
  function clamp(input: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, input));
  }

  function setPoint(index: number, next: number): void {
    const points = [...value] as CubicBezierPoints;
    points[index] = Number(next.toFixed(2));
    onchange(points);
  }

  function startDrag(handle: 0 | 1, event: PointerEvent): void {
    dragging = handle;
    (event.currentTarget as Element).setPointerCapture(event.pointerId);
  }

  function moveDrag(event: PointerEvent): void {
    if (dragging === null || svgElement === null) return;
    const rect = svgElement.getBoundingClientRect();
    const x = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    const pixelY = ((event.clientY - rect.top) / rect.height) * (SIZE + PAD * 2);
    const y = clamp(1 - (pixelY - PAD) / SIZE, Y_MIN, Y_MAX);
    const points = [...value] as CubicBezierPoints;
    points[dragging * 2] = Number(x.toFixed(2));
    points[dragging * 2 + 1] = Number(y.toFixed(2));
    onchange(points);
  }

  function endDrag(): void {
    dragging = null;
  }
</script>

<!-- Graph beside the fields, not above them: full-width the graph towers past the viewport. -->
<div class="flex items-center gap-12">
  <svg
    bind:this={svgElement}
    viewBox="0 0 {SIZE} {SIZE + PAD * 2}"
    class="grow touch-none"
    style="max-inline-size: var(--mc-size-sidebar)"
    role="img"
    aria-label="Easing curve: time along the horizontal axis, progress along the vertical axis"
  >
    <!-- The unit square (progress 0 to 1) and the linear reference diagonal. -->
    <rect
      x="0"
      y={PAD}
      width={SIZE}
      height={SIZE}
      fill="none"
      stroke="var(--mc-border-default)"
    />
    <line
      x1="0"
      y1={toPixelY(0)}
      x2={SIZE}
      y2={toPixelY(1)}
      stroke="var(--mc-border-default)"
      stroke-dasharray="4 4"
    />
    <!-- Control arms from each endpoint to its handle. -->
    <line
      x1="0"
      y1={toPixelY(0)}
      x2={toPixelX(value[0])}
      y2={toPixelY(value[1])}
      stroke="var(--mc-text-muted)"
    />
    <line
      x1={SIZE}
      y1={toPixelY(1)}
      x2={toPixelX(value[2])}
      y2={toPixelY(value[3])}
      stroke="var(--mc-text-muted)"
    />
    <!-- The curve itself. -->
    <path
      d={`M 0 ${toPixelY(0)} C ${toPixelX(value[0])} ${toPixelY(value[1])}, ${toPixelX(value[2])} ${toPixelY(value[3])}, ${SIZE} ${toPixelY(1)}`}
      fill="none"
      stroke="var(--mc-text-default)"
      stroke-width="2"
    />
    <circle cx="0" cy={toPixelY(0)} r="4" fill="var(--mc-text-default)" />
    <circle cx={SIZE} cy={toPixelY(1)} r="4" fill="var(--mc-text-default)" />
    <!-- The draggable control handles — gilt, the identity color for the editable thing.
         Pointer-only by design (role=presentation): the number fields below are the keyboard
         and assistive-technology path to the same four values. -->
    <circle
      role="presentation"
      cx={toPixelX(value[0])}
      cy={toPixelY(value[1])}
      r="8"
      fill="var(--mc-chrome-accent)"
      class="cursor-grab"
      onpointerdown={(event) => startDrag(0, event)}
      onpointermove={moveDrag}
      onpointerup={endDrag}
    />
    <circle
      role="presentation"
      cx={toPixelX(value[2])}
      cy={toPixelY(value[3])}
      r="8"
      fill="var(--mc-chrome-accent)"
      class="cursor-grab"
      onpointerdown={(event) => startDrag(1, event)}
      onpointermove={moveDrag}
      onpointerup={endDrag}
    />
  </svg>

  <!-- The keyboard path: the same four values as number fields. -->
  <div class="grid grow grid-cols-2 gap-8">
    {#each HANDLE_FIELDS as field (field.label)}
      <Label class="flex flex-col gap-4 text-xs text-muted">
        {field.label}
        <Input
          type="number"
          step="0.01"
          min={field.min}
          max={field.max}
          value={value[field.index]}
          oninput={(event) => {
            const next = Number.parseFloat(event.currentTarget.value);
            if (!Number.isNaN(next)) setPoint(field.index, clamp(next, field.min, field.max));
          }}
        />
      </Label>
    {/each}
  </div>
</div>
