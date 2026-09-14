<script lang="ts">
  /*
   * One bandwidth run as a line with a soft area fill — the shape speed.cloudflare.com draws under
   * its Download and Upload figures, so the number and the evidence for it share one glance. Each
   * sample is plotted in the order it was measured; a labelled 90th-percentile rule marks the value
   * the headline figure reports, so the reader sees where that number sits in the run.
   *
   * Single series, so the tile's label names it and no legend or categorical palette appears. The
   * axis is recessive and the rule wears a muted text token, never the line's color. A table view
   * accompanies the chart, and every sample carries a hover title, so a value is never conveyed by
   * geometry alone.
   *
   * The frame — the `<svg>` and the `<details>` — renders in every state at its final height, so the
   * page never jumps when a run starts or finishes. With no samples yet it draws the baseline and a
   * single muted marker; only the line, area, rule, and table body are conditional on there being
   * data. The geometry stretches to fill the tile width (`preserveAspectRatio="none"`); strokes hold
   * their pixel width through `vector-effect`.
   */
  import * as DataTable from "@magna-carta/design-system/data-table";
  import { linePath, niceMax, scaleLinear } from "./chart-scale.ts";
  import { percentile } from "./bandwidth-stats.ts";
  import { formatBandwidth } from "./speed-test-format.ts";
  import { ABSENT_MARKER, ABSENT_DESCRIPTION } from "./absence.ts";

  let { points, label }: { points: ReadonlyArray<{ bps: number }>; label: string } = $props();

  const WIDTH = 240;
  const HEIGHT = 64;

  const megabits = $derived(points.map((point) => point.bps / 1e6));
  const ceiling = $derived(niceMax(megabits));
  const scale = $derived(scaleLinear(ceiling, HEIGHT));

  const line = $derived(linePath(megabits, ceiling, WIDTH, HEIGHT));
  // The area is the line closed down to the baseline. A single sample spans no width, so its area
  // collapses to a line — correct: one observation is a point, not a trend to shade under.
  const area = $derived(
    points.length > 0 ? `${line} L${points.length > 1 ? WIDTH : 0},${HEIGHT} L0,${HEIGHT} Z` : "",
  );

  // The rule sits at the same 90th percentile the headline figure reports. Null only for an empty
  // series, in which case no rule is drawn.
  const percentileMegabits = $derived(percentile(megabits, 0.9));
  const ruleY = $derived(percentileMegabits === null ? null : HEIGHT - scale(percentileMegabits));
  // Keep the label inside the frame: below the rule when it runs near the top edge, above otherwise.
  const labelY = $derived(ruleY === null ? 0 : ruleY < 14 ? ruleY + 14 : ruleY - 4);

  const sliceWidth = $derived(points.length > 0 ? WIDTH / points.length : WIDTH);
  const peakBps = $derived(
    points.length > 0 ? Math.max(...points.map((point) => point.bps)) : undefined,
  );
</script>

<figure class="m-0 mt-4">
  <svg
    viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
    width="100%"
    height={HEIGHT}
    preserveAspectRatio="none"
    role="img"
    aria-label={points.length > 0
      ? `${label}: ${points.length} measurements, peak ${formatBandwidth(peakBps)}`
      : `${label}: ${ABSENT_DESCRIPTION}`}
  >
    <line
      x1="0"
      y1={HEIGHT}
      x2={WIDTH}
      y2={HEIGHT}
      stroke="var(--mc-border-default)"
      vector-effect="non-scaling-stroke"
    />

    {#if points.length > 0}
      <path d={area} fill="var(--mc-accent-default)" fill-opacity="0.15" stroke="none" />
      <path
        d={line}
        fill="none"
        stroke="var(--mc-accent-default)"
        stroke-width="2"
        vector-effect="non-scaling-stroke"
      />

      {#if ruleY !== null}
        <line
          x1="0"
          y1={ruleY}
          x2={WIDTH}
          y2={ruleY}
          stroke="var(--mc-text-muted)"
          stroke-dasharray="4 3"
          vector-effect="non-scaling-stroke"
        />
        <text x="4" y={labelY} fill="var(--mc-text-muted)" style="font-size: 10px">
          90th percentile
        </text>
      {/if}

      {#each points as point, index (index)}
        <rect
          x={index * sliceWidth}
          y="0"
          width={sliceWidth}
          height={HEIGHT}
          fill="transparent"
          pointer-events="all"
        >
          <title>Sample {index + 1}: {formatBandwidth(point.bps)}</title>
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
    <!-- The table stands with its two column heads before a sample has landed, and says inside its
         own body that nothing was measured, so the samples fill a shape the reader already has. -->
    <DataTable.Root class="mt-8">
      <DataTable.Header>
        <DataTable.Row>
          <DataTable.Head>Sample</DataTable.Head>
          <DataTable.Head data-align="end">Speed</DataTable.Head>
        </DataTable.Row>
      </DataTable.Header>
      <DataTable.Body>
        {#each points as point, index (index)}
          <DataTable.Row>
            <DataTable.Cell>{index + 1}</DataTable.Cell>
            <DataTable.Cell data-align="end">{formatBandwidth(point.bps)}</DataTable.Cell>
          </DataTable.Row>
        {:else}
          <DataTable.Row data-placeholder="true">
            <DataTable.Cell colspan={2} class="mc-table-empty">{ABSENT_DESCRIPTION}</DataTable.Cell>
          </DataTable.Row>
        {/each}
      </DataTable.Body>
    </DataTable.Root>
  </details>
</figure>
