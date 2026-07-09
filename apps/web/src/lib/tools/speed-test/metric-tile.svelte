<script lang="ts">
  /*
   * One headline measurement. `note` states why a metric is absent — a stated reason, never a
   * bare dash the reader must interpret. `size` ranks it: "large" for what the test is FOR
   * (download/upload), "small" for what describes the connection's character (latency, jitter,
   * packet loss) — the value itself never changes structure, only scale.
   *
   * `info` is an optional affordance beside the label explaining what the figure means; `stats` is
   * an optional row of secondary figures (e.g. median/95th/peak/samples) shown under the value.
   */
  import * as Card from "@magna-carta/design-system/card";
  import type { Snippet } from "svelte";

  let {
    label,
    value,
    note,
    size = "small",
    info,
    stats,
  }: {
    label: string;
    value: string;
    note?: string;
    size?: "large" | "small";
    info?: Snippet;
    stats?: ReadonlyArray<{ label: string; value: string }>;
  } = $props();
</script>

<Card.Root>
  <Card.Content>
    <div
      class="flex items-center gap-4 text-xs text-text-muted uppercase"
      style="letter-spacing: var(--mc-tracking-caps)"
    >
      <span>{label}</span>
      {#if info}
        {@render info()}
      {/if}
    </div>
    <div class={["mt-4", size === "large" ? "text-3xl" : "text-2xl"]}>{value}</div>
    {#if note}
      <div class="mt-4 text-xs text-text-muted">{note}</div>
    {/if}
    {#if stats && stats.length > 0}
      <div class="mt-4 flex flex-wrap gap-16">
        {#each stats as stat (stat.label)}
          <div>
            <div
              class="text-xs text-text-muted uppercase"
              style="letter-spacing: var(--mc-tracking-caps)"
            >
              {stat.label}
            </div>
            <div class="text-sm">{stat.value}</div>
          </div>
        {/each}
      </div>
    {/if}
  </Card.Content>
</Card.Root>
