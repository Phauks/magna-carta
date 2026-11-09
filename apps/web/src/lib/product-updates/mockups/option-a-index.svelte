<script lang="ts">
  /* Option A: a headline index. One line per change, grouped by date; open a line to read it. */
  import * as Accordion from "@magna-carta/design-system/accordion";
  import Badge from "@magna-carta/design-system/badge";
  import FieldLabel from "@magna-carta/design-system/field-label";
  import { formatDate } from "@magna-carta/design-system/formatters";
  import { CATEGORY_BADGE, type ChangelogEntry } from "../changelog-entries.ts";
  import ChangelogInline from "../changelog-inline.svelte";
  import CategoryChips from "./category-chips.svelte";

  let { entries, query }: { entries: readonly ChangelogEntry[]; query: string } = $props();
  let category = $state("all");
  let open = $state<string[]>([]);

  const visible = $derived(
    entries.filter(
      (entry) =>
        (category === "all" || entry.category === category) &&
        (query.trim() === "" || entry.searchText.includes(query.trim().toLowerCase())),
    ),
  );
  const dates = $derived([...new Set(visible.map((entry) => entry.date))]);
</script>

<div class="flex flex-col gap-16">
  <CategoryChips {entries} bind:selected={category} />
  {#each dates as date (date)}
    {@const onDate = visible.filter((entry) => entry.date === date)}
    <section>
      <FieldLabel as="h2" class="mb-8 flex items-baseline gap-8 border-b border-border-strong pb-8">
        {formatDate(date)}
        <span class="text-xs normal-case text-text-muted">{onDate.length} changes</span>
      </FieldLabel>
      <Accordion.Root type="multiple" value={open} onValueChange={(value) => (open = value)}>
        {#each onDate as entry (entry.id)}
          <Accordion.Item value={entry.id}>
            <Accordion.Trigger>
              <span class="flex min-w-0 items-center gap-12 text-start">
                <Badge variant={CATEGORY_BADGE[entry.category]} class="shrink-0">
                  {entry.category}
                </Badge>
                <span class="truncate text-sm font-medium"><ChangelogInline nodes={entry.headline} /></span>
              </span>
            </Accordion.Trigger>
            <Accordion.Content>
              <div class="flex max-w-prose flex-col gap-8 ps-24 text-sm text-text-muted">
                {#each entry.detail as paragraph, index (index)}
                  <p><ChangelogInline nodes={paragraph} /></p>
                {/each}
              </div>
            </Accordion.Content>
          </Accordion.Item>
        {/each}
      </Accordion.Root>
    </section>
  {/each}
</div>
