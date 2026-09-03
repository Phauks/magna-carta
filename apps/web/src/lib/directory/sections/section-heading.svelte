<script lang="ts">
  /*
   * A section's rule: its name in the caps register, and how many it holds where it is a list.
   * The one heading every section of a record shares, so the New Person screen and the record's
   * own panes read as the same document.
   */
  let { label, count }: { label: string; count?: number | null } = $props();
</script>

<div class="flex items-baseline justify-between gap-8 border-b border-border-default pb-8">
  <h3 class="text-xs text-text-muted uppercase" style="letter-spacing: var(--mc-tracking-caps)">
    {label}
  </h3>
  {#if count !== undefined && count !== null}
    <span class="text-xs text-text-subtle tabular-nums">{count}</span>
  {/if}
</div>
