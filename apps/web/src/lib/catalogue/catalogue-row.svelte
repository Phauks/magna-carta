<script lang="ts">
  /*
   * One catalogue entry as a dense list row: the glyph, the name, the line saying what it does
   * trailing muted, and at the end what it waits on (while unbuilt) beside its maturity mark. An
   * entry with somewhere to go is the whole row as a link; one without is the same row, plain —
   * never dressed as a disabled control, which would read as broken rather than as not yet.
   */
  import { MaturityBadge, soonDependencySentence } from "@magna-carta/design-system/maturity";
  import type { CatalogueEntry } from "./catalogue.ts";

  let { entry }: { entry: CatalogueEntry } = $props();

  const Icon = $derived(entry.icon);
</script>

{#snippet body()}
  <div class="flex items-center gap-16 px-16 py-12">
    <Icon class="size-16 shrink-0 text-text-muted" aria-hidden="true" />
    <span class="shrink-0 font-medium">{entry.name}</span>
    <span class="min-w-0 truncate text-sm text-text-muted" title={entry.description}>
      {entry.description}
    </span>
    <span class="ml-auto flex shrink-0 items-center gap-8">
      {#if entry.waitsOn !== undefined}
        <span class="text-xs text-text-muted">{soonDependencySentence(entry.waitsOn)}</span>
      {/if}
      <MaturityBadge stage={entry.stage} />
    </span>
  </div>
{/snippet}

{#if entry.href !== null}
  <a href={entry.href} class="block hover:bg-surface-raised">{@render body()}</a>
{:else}
  <div aria-disabled="true">{@render body()}</div>
{/if}
