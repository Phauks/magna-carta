<script lang="ts">
  /*
   * The engine's per-use-case verdict on this connection. The classification word carries the
   * meaning, so it is never conveyed by colour alone; the point total sits beside it for anyone
   * who wants the number.
   *
   * Always renders the same three-column grid, scored or not — reserving its height from the
   * moment the page loads so the page never jumps once a run finishes.
   */
  import type { Scores } from "@cloudflare/speedtest";
  import { useCaseLabel } from "./quality-labels.ts";

  let { scores }: { scores: Scores | undefined } = $props();

  // Before a run there are no scores, but the panel must already occupy its full height or the
  // page will jump the moment one finishes. These three are the use-cases the engine reports
  // today; once it answers, its own keys replace them.
  const PLACEHOLDER_KEYS = ["streaming", "gaming", "rtc"];

  const entries = $derived(Object.entries(scores ?? {}));
  const scored = $derived(entries.length > 0);
</script>

<dl class="grid grid-cols-1 gap-16 text-sm sm:grid-cols-3">
  {#if scored}
    {#each entries as [key, score] (key)}
      <div>
        <dt class="text-text-muted">{useCaseLabel(key)}</dt>
        <dd class="mt-4 text-lg capitalize">{score.classificationName}</dd>
        <dd class="text-xs text-text-muted">{score.points} points</dd>
      </div>
    {/each}
  {:else}
    {#each PLACEHOLDER_KEYS as key (key)}
      <div>
        <dt class="text-text-muted">{useCaseLabel(key)}</dt>
        <dd class="mt-4 text-lg">—</dd>
        <dd class="text-xs text-text-muted">Scored once a run finishes.</dd>
      </div>
    {/each}
  {/if}
</dl>
