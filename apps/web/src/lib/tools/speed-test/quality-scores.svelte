<script lang="ts">
  /*
   * The engine's per-use-case verdict on this connection. The classification word carries the
   * meaning, so it is never conveyed by colour alone; the point total sits beside it for anyone
   * who wants the number. Renders nothing until a run has produced scores.
   */
  import type { Scores } from "@cloudflare/speedtest";
  import { useCaseLabel } from "./quality-labels.ts";

  let { scores }: { scores: Scores | undefined } = $props();

  const entries = $derived(Object.entries(scores ?? {}));
</script>

{#if entries.length > 0}
  <dl class="grid grid-cols-1 gap-16 text-sm sm:grid-cols-3">
    {#each entries as [key, score] (key)}
      <div>
        <dt class="text-text-muted">{useCaseLabel(key)}</dt>
        <dd class="mt-4 text-lg capitalize">{score.classificationName}</dd>
        <dd class="text-xs text-text-muted">{score.points} points</dd>
      </div>
    {/each}
  </dl>
{:else}
  <p class="text-sm text-text-muted">Scored once a run finishes.</p>
{/if}
