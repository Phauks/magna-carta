<script lang="ts">
  /*
   * One headline measurement. `note` states why a metric is absent — a stated reason, never a
   * bare dash the reader must interpret.
   */
  import * as Card from "@magna-carta/design-system/card";

  let {
    label,
    value,
    note,
  }: { label: string; value: string; note?: string } = $props();
</script>

<Card.Root>
  <Card.Content>
    <div class="text-xs text-text-muted uppercase" style="letter-spacing: var(--mc-tracking-caps)">
      {label}
    </div>
    <div class="mt-4 text-3xl">{value}</div>
    {#if note}
      <div class="mt-4 text-xs text-text-muted">{note}</div>
    {/if}
  </Card.Content>
</Card.Root>
