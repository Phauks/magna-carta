<script lang="ts">
  /*
   * One headline measurement. `note` states why a metric is absent — a stated reason, never a
   * bare dash the reader must interpret. `size` ranks it: "large" for what the test is FOR
   * (download/upload), "small" for what describes the connection's character (latency, jitter,
   * packet loss) — the value itself never changes structure, only scale.
   *
   * `info` is an optional affordance beside the label explaining what the figure means; `chart` is
   * an optional sparkline shown directly under the value, pairing the figure with its evidence;
   * `stats` is an optional row of secondary figures (e.g. median/95th/peak/samples) below that.
   */
  import * as Card from "@magna-carta/design-system/card";
  import FieldLabel from "@magna-carta/design-system/field-label";
  import type { Snippet } from "svelte";

  let {
    label,
    value,
    note,
    size = "small",
    info,
    chart,
    stats,
  }: {
    label: string;
    value: string;
    note?: string;
    size?: "large" | "small";
    info?: Snippet;
    chart?: Snippet;
    stats?: ReadonlyArray<{ label: string; value: string }>;
  } = $props();
</script>

<Card.Root>
  <Card.Content>
    <FieldLabel as="div" class="flex items-center gap-4"
    >
      <span>{label}</span>
      {#if info}
        {@render info()}
      {/if}
    </FieldLabel>
    <!-- Every caller passes a formatted value or the absence marker, never an empty string, so the
         line box always has content and never needs a non-breaking-space guard. -->
    <div class={["mt-4", size === "large" ? "text-3xl" : "text-2xl"]}>{value}</div>
    {#if chart}
      {@render chart()}
    {/if}
    <!-- The note line always renders (a non-breaking space when there is nothing to say), so a
         tile's height never depends on whether it carries a note. -->
    <div class="mt-4 text-xs text-text-muted">{note ?? " "}</div>
    {#if stats && stats.length > 0}
      <div class="mt-4 flex flex-wrap gap-16">
        {#each stats as stat (stat.label)}
          <div>
            <FieldLabel as="div"
            >
              {stat.label}
            </FieldLabel>
            <div class="text-sm">{stat.value}</div>
          </div>
        {/each}
      </div>
    {/if}
  </Card.Content>
</Card.Root>
