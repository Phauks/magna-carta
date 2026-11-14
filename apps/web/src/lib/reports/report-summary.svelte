<script lang="ts">
  /*
   * The row of totals a report opens with: one card per figure, the closing one filled. Every
   * value is the presenter's text over the payload's own totals; this draws, it reads nothing.
   * The card is the speed test's metric tile's frame ($lib/tools/speed-test/metric-tile.svelte):
   * a label over a figure over one muted line.
   *
   * The cards wrap rather than overflow, on the width of the report's own column (a container
   * query): two to a row when it is narrow, three when it is middling, all on one line when it is
   * wide enough. The one-line classes are literal per count so the stylesheet scanner sees them.
   */
  import * as Card from "@magna-carta/design-system/card";
  import FieldLabel from "@magna-carta/design-system/field-label";
  import type { ReportSummaryTile } from "./report-presentation.ts";

  let { tiles }: { tiles: readonly ReportSummaryTile[] } = $props();

  const ONE_LINE: Readonly<Record<number, string>> = {
    4: "@3xl:grid-cols-4",
    5: "@3xl:grid-cols-5",
    6: "@3xl:grid-cols-6",
  };
</script>

<div class="@container">
  <ul
    class={["grid grid-cols-2 gap-12 @lg:grid-cols-3", ONE_LINE[tiles.length]]}
    aria-label="Totals"
  >
    {#each tiles as tile (tile.label)}
      <li class="min-w-0">
        <Card.Root class={["h-full", tile.tone === "total" ? "bg-surface-sunken" : undefined]}>
          <Card.Content>
            <FieldLabel as="p">{tile.label}</FieldLabel>
            <p
              class={[
                "mt-4 text-base font-semibold whitespace-nowrap tabular-nums @5xl:text-lg",
                tile.tone === "attention" ? "text-status-danger" : "text-text-default",
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
</div>
