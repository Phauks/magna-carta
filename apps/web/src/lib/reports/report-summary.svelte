<script lang="ts">
  /*
   * The row of totals a report opens with: one card per figure, the closing one filled. Every
   * value is the presenter's text over the payload's own totals; this draws, it reads nothing.
   * The card is the speed test's metric tile's frame ($lib/tools/speed-test/metric-tile.svelte):
   * a label over a figure over one muted line.
   *
   * The cards wrap rather than scroll: two to a row on a phone, three on a narrow column, all of
   * them on one line where the content column is wide enough.
   */
  import * as Card from "@magna-carta/design-system/card";
  import FieldLabel from "@magna-carta/design-system/field-label";
  import type { ReportSummaryTile } from "./report-presentation.ts";

  let { tiles }: { tiles: readonly ReportSummaryTile[] } = $props();
</script>

<ul class="grid grid-cols-2 gap-12 sm:grid-cols-3 xl:flex xl:flex-nowrap" aria-label="Totals">
  {#each tiles as tile (tile.label)}
    <li class="min-w-0 xl:flex-1">
      <Card.Root class={["h-full", tile.tone === "total" ? "bg-surface-sunken" : undefined]}>
        <Card.Content>
          <FieldLabel as="p">{tile.label}</FieldLabel>
          <p
            class={[
              "mt-4 text-xl font-semibold tabular-nums",
              tile.tone === "attention" ? "text-text-danger" : "text-text-default",
            ]}
          >
            {tile.value}
          </p>
          <p class="mt-4 text-xs text-text-muted">{tile.detail ?? " "}</p>
        </Card.Content>
      </Card.Root>
    </li>
  {/each}
</ul>
