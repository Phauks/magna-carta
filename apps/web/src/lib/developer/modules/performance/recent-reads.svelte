<script lang="ts">
  /*
   * The reads this tab has waited on, most recent first — what every LoadingRegion measured when
   * it settled. The region writes a User Timing measure named `mc-loading <label>` with the
   * milliseconds and whether the read failed in its detail, so this list is a read of the
   * performance timeline and nothing more: no store, no wiring in any screen, and the same entries
   * a profiler shows. Mounted only while the performance module is open, like the meter beside it.
   */
  import type { LoadingSettledDetail } from "@magna-carta/design-system/loading-region";
  import FieldLabel from "@magna-carta/design-system/field-label";

  const MEASURE_PREFIX = "mc-loading ";
  const SHOWN = 12;

  interface Read {
    readonly key: string;
    readonly label: string;
    readonly milliseconds: number;
    readonly failed: boolean;
  }

  function isSettledDetail(value: unknown): value is LoadingSettledDetail {
    return (
      typeof value === "object" &&
      value !== null &&
      typeof (value as LoadingSettledDetail).label === "string" &&
      typeof (value as LoadingSettledDetail).milliseconds === "number"
    );
  }

  function collect(): Read[] {
    return performance
      .getEntriesByType("measure")
      .filter((entry) => entry.name.startsWith(MEASURE_PREFIX))
      .map((entry) => {
        const detail = (entry as PerformanceMeasure).detail as unknown;
        return {
          key: `${entry.name}:${entry.startTime}`,
          label: entry.name.slice(MEASURE_PREFIX.length),
          milliseconds: isSettledDetail(detail) ? detail.milliseconds : Math.round(entry.duration),
          failed: isSettledDetail(detail) ? detail.failed : false,
        };
      })
      .toReversed()
      .slice(0, SHOWN);
  }

  let reads = $state<Read[]>(collect());

  $effect(() => {
    // A measure lands when a region settles; the observer keeps the list current without polling.
    const observer = new PerformanceObserver(() => {
      reads = collect();
    });
    observer.observe({ type: "measure", buffered: true });
    return () => observer.disconnect();
  });
</script>

<div class="flex flex-col gap-8">
  <FieldLabel as="p">Reads this tab waited on</FieldLabel>
  {#if reads.length === 0}
    <p class="text-xs text-text-muted">
      Nothing has settled yet. Every loading region reports how long its read took when its content
      lands; the last {SHOWN} land here, newest first.
    </p>
  {:else}
    <ol class="flex flex-col gap-4">
      {#each reads as read (read.key)}
        <li class="flex items-baseline justify-between gap-12 text-xs">
          <span class="min-w-0 truncate">{read.label}</span>
          <span class="shrink-0 tabular-nums text-text-muted">
            {read.milliseconds} ms{read.failed ? " · failed" : ""}
          </span>
        </li>
      {/each}
    </ol>
  {/if}
</div>
