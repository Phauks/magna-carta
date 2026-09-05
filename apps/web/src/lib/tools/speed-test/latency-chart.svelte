<script lang="ts">
  import FieldLabel from "@magna-carta/design-system/field-label";
  /*
   * One latency phase as a point series — a small multiple. The three phases (idle, during
   * download, during upload) each get their own chart rather than sharing one axis, which is how
   * the measurement reads honestly and why no categorical palette is needed.
   *
   * The frame — the `<svg>` and the `<details>` — renders in every state, at its final height, so
   * the page never jumps when a run starts or finishes. Only the marks and the list are
   * conditional on there being points to show.
   */
  import { niceMax, scaleLinear } from "./chart-scale.ts";
  import { formatMilliseconds } from "./speed-test-format.ts";
  import { ABSENT_MARKER, ABSENT_DESCRIPTION } from "./absence.ts";

  let { title, points }: { title: string; points: readonly number[] } = $props();

  const HEIGHT = 80;
  const STEP = 12;
  const RADIUS = 4;
  // Before there are points to space out, the frame still needs a plausible width to center the
  // placeholder text in — this has no bearing on the fixed pixel HEIGHT that keeps the page still.
  const EMPTY_WIDTH = 240;

  const ceiling = $derived(niceMax(points));
  const scale = $derived(scaleLinear(ceiling, HEIGHT - RADIUS * 2));
  const width = $derived(points.length > 0 ? points.length * STEP : EMPTY_WIDTH);
  const peak = $derived(points.length > 0 ? Math.max(...points) : undefined);
</script>

<figure class="m-0">
  <FieldLabel as="figcaption" class="mb-8"
  >
    {title}
  </FieldLabel>

  <svg
    viewBox={`0 0 ${width} ${HEIGHT}`}
    width="100%"
    height={HEIGHT}
    role="img"
    aria-label={points.length > 0
      ? `${title}: ${points.length} samples, peak ${formatMilliseconds(peak)}`
      : `${title}: ${ABSENT_DESCRIPTION}`}
  >
    {#if points.length > 0}
      {#each points as value, index (index)}
        <circle
          cx={index * STEP + RADIUS}
          cy={HEIGHT - RADIUS - scale(value)}
          r={RADIUS}
          fill="var(--mc-accent-default)"
        >
          <title>{formatMilliseconds(value)}</title>
        </circle>
      {/each}
    {:else}
      <text
        x="50%"
        y="50%"
        text-anchor="middle"
        dominant-baseline="middle"
        fill="var(--mc-text-muted)"
        style="font-size: 12px"
      >
        {ABSENT_MARKER}
      </text>
    {/if}
  </svg>

  <details class="mt-8">
    <summary class="cursor-pointer text-xs text-text-muted">Table view</summary>
    {#if points.length > 0}
      <ol class="mt-8 text-sm">
        {#each points as value, index (index)}
          <li>{formatMilliseconds(value)}</li>
        {/each}
      </ol>
    {:else}
      <p class="mt-8 text-sm text-text-muted">{ABSENT_DESCRIPTION}</p>
    {/if}
  </details>
</figure>
