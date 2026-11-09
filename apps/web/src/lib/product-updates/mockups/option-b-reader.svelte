<script lang="ts">
  /* Option B: a reader. Headlines down the left, the chosen change in full on the right. */
  import Badge from "@magna-carta/design-system/badge";
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
  let selectedId = $state<string | null>(null);
  const selected = $derived(visible.find((entry) => entry.id === selectedId) ?? visible[0] ?? null);
</script>

<div class="flex flex-col gap-16">
  <CategoryChips {entries} bind:selected={category} />
  <div class="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-24">
    <ul class="mc-scrollbar flex max-h-svh flex-col overflow-auto rounded-md border border-border-default">
      {#each visible as entry, index (entry.id)}
        {@const previous = visible[index - 1]}
        {#if previous?.date !== entry.date}
          <li class="sticky top-0 border-b border-border-default bg-surface-sunken px-12 py-4 text-xs font-medium text-text-muted">
            {formatDate(entry.date)}
          </li>
        {/if}
        <li>
          <button
            type="button"
            class={[
              "flex w-full flex-col gap-4 border-b border-border-subtle px-12 py-8 text-start",
              selected?.id === entry.id ? "bg-surface-selected" : "hover:bg-surface-hover",
            ]}
            onclick={() => (selectedId = entry.id)}
          >
            <span class="line-clamp-2 text-sm font-medium"><ChangelogInline nodes={entry.headline} /></span>
            <span><Badge variant={CATEGORY_BADGE[entry.category]}>{entry.category}</Badge></span>
          </button>
        </li>
      {/each}
    </ul>
    {#if selected !== null}
      <article class="flex max-w-prose flex-col gap-12">
        <div class="flex items-center gap-8 text-xs text-text-muted">
          <Badge variant={CATEGORY_BADGE[selected.category]}>{selected.category}</Badge>
          {formatDate(selected.date)}
        </div>
        <h2 class="font-display text-2xl"><ChangelogInline nodes={selected.headline} /></h2>
        {#each selected.detail as paragraph, index (index)}
          <p class="text-sm leading-relaxed"><ChangelogInline nodes={paragraph} /></p>
        {/each}
      </article>
    {/if}
  </div>
</div>
