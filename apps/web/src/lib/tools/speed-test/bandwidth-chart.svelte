<script lang="ts">
  /*
   * One bandwidth series across the engine's scaling buckets. Single series, so the title names it
   * and no legend appears; the axis is recessive and the value labels wear text tokens, never the
   * mark's color. A table view accompanies the chart so the values are never conveyed by mark
   * geometry alone.
   *
   * The frame — the `<svg>` and the `<details>` — renders in every state, at its final height, so
   * the page never jumps when a run starts or finishes. Only the marks and the table body are
   * conditional on there being points to show.
   */
  import { niceMax, scaleLinear } from "./chart-scale.ts";
  import { formatBandwidth } from "./speed-test-format.ts";
  import { ABSENT_MARKER, ABSENT_DESCRIPTION } from "./absence.ts";

  let {
    title,
    points,
  }: { title: string; points: ReadonlyArray<{ bytes: number; bps: number }> } = $props();

  const HEIGHT = 96;
  const BAR = 16;
  const GAP = 8;
  // Before there are points to space out, the frame still needs a plausible width to center the
  // placeholder text in — this has no bearing on the fixed pixel HEIGHT that keeps the page still.
  const EMPTY_WIDTH = 240;

  const megabits = $derived(points.map((point) => point.bps / 1e6));
  const ceiling = $derived(niceMax(megabits));
  const scale = $derived(scaleLinear(ceiling, HEIGHT));
  const width = $derived(points.length > 0 ? points.length * (BAR + GAP) : EMPTY_WIDTH);
  const peakBps = $derived(
    points.length > 0 ? Math.max(...points.map((point) => point.bps)) : undefined,
  );
</script>

<figure class="m-0">
  <figcaption
    class="mb-8 text-xs text-text-muted uppercase"
    style="letter-spacing: var(--mc-tracking-caps)"
  >
    {title}
  </figcaption>

  <svg
    viewBox={`0 0 ${width} ${HEIGHT}`}
    width="100%"
    height={HEIGHT}
    role="img"
    aria-label={points.length > 0
      ? `${title}: ${points.length} measurements, peak ${formatBandwidth(peakBps)}`
      : `${title}: ${ABSENT_DESCRIPTION}`}
  >
    {#if points.length > 0}
      {#each points as point, index (index)}
        {@const barHeight = scale(point.bps / 1e6)}
        <rect
          x={index * (BAR + GAP)}
          y={HEIGHT - barHeight}
          width={BAR}
          height={barHeight}
          rx="4"
          fill="var(--mc-accent-default)"
        >
          <title>{formatBandwidth(point.bps)}</title>
        </rect>
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
      <table class="mt-8 w-full text-left text-sm">
        <thead>
          <tr>
            <th scope="col" class="font-medium text-text-muted">Transfer</th>
            <th scope="col" class="font-medium text-text-muted">Speed</th>
          </tr>
        </thead>
        <tbody>
          {#each points as point, index (index)}
            <tr>
              <td>{Math.round(point.bytes / 1000)} kB</td>
              <td>{formatBandwidth(point.bps)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {:else}
      <p class="mt-8 text-sm text-text-muted">{ABSENT_DESCRIPTION}</p>
    {/if}
  </details>
</figure>
