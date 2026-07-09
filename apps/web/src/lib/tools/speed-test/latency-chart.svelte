<script lang="ts">
  /*
   * One latency phase as a point series — a small multiple. The three phases (idle, during
   * download, during upload) each get their own chart rather than sharing one axis, which is how
   * the measurement reads honestly and why no categorical palette is needed.
   */
  import { niceMax, scaleLinear } from "./chart-scale.ts";
  import { formatMilliseconds } from "./speed-test-format.ts";

  let { title, points }: { title: string; points: readonly number[] } = $props();

  const HEIGHT = 80;
  const STEP = 12;
  const RADIUS = 4;

  const ceiling = $derived(niceMax(points));
  const scale = $derived(scaleLinear(ceiling, HEIGHT - RADIUS * 2));
  const width = $derived(Math.max(points.length * STEP, STEP));
  const peak = $derived(points.length > 0 ? Math.max(...points) : undefined);
</script>

<figure class="m-0">
  <figcaption
    class="mb-8 text-xs text-text-muted uppercase"
    style="letter-spacing: var(--mc-tracking-caps)"
  >
    {title}
  </figcaption>

  {#if points.length === 0}
    <p class="text-sm text-text-muted">Not measured yet.</p>
  {:else}
    <svg
      viewBox={`0 0 ${width} ${HEIGHT}`}
      width="100%"
      height={HEIGHT}
      role="img"
      aria-label={`${title}: ${points.length} samples, peak ${formatMilliseconds(peak)}`}
    >
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
    </svg>

    <details class="mt-8">
      <summary class="cursor-pointer text-xs text-text-muted">Table view</summary>
      <ol class="mt-8 text-sm">
        {#each points as value, index (index)}
          <li>{formatMilliseconds(value)}</li>
        {/each}
      </ol>
    </details>
  {/if}
</figure>
