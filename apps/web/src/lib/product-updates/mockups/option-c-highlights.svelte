<script lang="ts">
  /* Option C: highlights. The latest update as cards up top, everything earlier as a card grid. */
  import * as Card from "@magna-carta/design-system/card";
  import Badge from "@magna-carta/design-system/badge";
  import FieldLabel from "@magna-carta/design-system/field-label";
  import { formatDate } from "@magna-carta/design-system/formatters";
  import { CATEGORY_BADGE, type ChangelogEntry } from "../changelog-entries.ts";
  import ChangelogInline from "../changelog-inline.svelte";
  import CategoryChips from "./category-chips.svelte";

  let { entries, query }: { entries: readonly ChangelogEntry[]; query: string } = $props();
  let category = $state("all");

  const visible = $derived(
    entries.filter(
      (entry) =>
        (category === "all" || entry.category === category) &&
        (query.trim() === "" || entry.searchText.includes(query.trim().toLowerCase())),
    ),
  );
  const latestDate = $derived(entries[0]?.date ?? null);
  const latest = $derived(visible.filter((entry) => entry.date === latestDate));
  const earlier = $derived(visible.filter((entry) => entry.date !== latestDate));
</script>

{#snippet card(entry: ChangelogEntry, featured: boolean)}
  <Card.Root class={featured ? "border-border-strong" : ""}>
    <Card.Content class="flex flex-col gap-8">
      <div class="flex items-center gap-8 text-xs text-text-muted">
        <Badge variant={CATEGORY_BADGE[entry.category]}>{entry.category}</Badge>
        {formatDate(entry.date)}
      </div>
      <p class={featured ? "text-base font-semibold" : "text-sm font-semibold"}>
        <ChangelogInline nodes={entry.headline} />
      </p>
      {#if entry.detail[0] !== undefined}
        <p class="line-clamp-3 text-sm text-text-muted"><ChangelogInline nodes={entry.detail[0]} /></p>
      {/if}
      <span class="text-sm text-text-link">Read more</span>
    </Card.Content>
  </Card.Root>
{/snippet}

<div class="flex flex-col gap-24">
  <CategoryChips {entries} bind:selected={category} />
  {#if latest.length > 0 && latestDate !== null}
    <section class="flex flex-col gap-12">
      <FieldLabel as="h2">Latest · {formatDate(latestDate)}</FieldLabel>
      <div class="grid grid-cols-2 gap-16">
        {#each latest as entry (entry.id)}{@render card(entry, true)}{/each}
      </div>
    </section>
  {/if}
  <section class="flex flex-col gap-12">
    <FieldLabel as="h2">Earlier</FieldLabel>
    <div class="grid grid-cols-3 gap-16">
      {#each earlier as entry (entry.id)}{@render card(entry, false)}{/each}
    </div>
  </section>
</div>
