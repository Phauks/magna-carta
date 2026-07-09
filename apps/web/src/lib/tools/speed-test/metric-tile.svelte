<script lang="ts">
  /*
   * One headline measurement. `note` states why a metric is absent — a stated reason, never a
   * bare dash the reader must interpret. `size` ranks it: "large" for what the test is FOR
   * (download/upload), "small" for what describes the connection's character (latency, jitter,
   * packet loss) — the value itself never changes structure, only scale.
   */
  import * as Card from "@magna-carta/design-system/card";

  let {
    label,
    value,
    note,
    size = "small",
  }: { label: string; value: string; note?: string; size?: "large" | "small" } = $props();
</script>

<Card.Root>
  <Card.Content>
    <div class="text-xs text-text-muted uppercase" style="letter-spacing: var(--mc-tracking-caps)">
      {label}
    </div>
    <div class={["mt-4", size === "large" ? "text-3xl" : "text-2xl"]}>{value}</div>
    {#if note}
      <div class="mt-4 text-xs text-text-muted">{note}</div>
    {/if}
  </Card.Content>
</Card.Root>
