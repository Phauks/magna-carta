<script lang="ts">
  /*
   * One catalogue entry as a card. The tile carries the same facts as the row in the browsing
   * register: the glyph and the name on one line with the maturity mark opposite, the descriptive
   * line beneath at prose width rather than truncated, and — while the entry is unbuilt — the
   * sentence naming what it waits on, which the row has room for only as small trailing text.
   *
   * An entry with somewhere to go is the whole tile as a link; one without is the same tile, inert
   * and quieter, its badge carrying the "not yet" meaning.
   */
  import * as Card from "@magna-carta/design-system/card";
  import { MaturityBadge, soonDependencySentence } from "@magna-carta/design-system/maturity";
  import type { CatalogueEntry } from "./catalogue.ts";

  let { entry }: { entry: CatalogueEntry } = $props();

  const Icon = $derived(entry.icon);
</script>

{#snippet body()}
  <Card.Root class="h-full">
    <Card.Header>
      <div class="flex items-start justify-between gap-8">
        <span class="flex items-center gap-8">
          <Icon class="size-16 text-text-muted" aria-hidden="true" />
          <Card.Title>{entry.name}</Card.Title>
        </span>
        <MaturityBadge stage={entry.stage} />
      </div>
      <Card.Description>{entry.description}</Card.Description>
      {#if entry.waitsOn !== undefined}
        <p class="text-xs text-text-muted">{soonDependencySentence(entry.waitsOn)}</p>
      {/if}
    </Card.Header>
  </Card.Root>
{/snippet}

{#if entry.href !== null}
  <a href={entry.href} class="block h-full rounded-lg hover:bg-surface-raised">{@render body()}</a>
{:else}
  <div class="h-full">{@render body()}</div>
{/if}
