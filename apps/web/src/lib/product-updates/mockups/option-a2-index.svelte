<script lang="ts">
  /* Option A, revised: dates collapse (chevron leading), every entry shown whole with its commit. */
  import * as Accordion from "@magna-carta/design-system/accordion";
  import Badge from "@magna-carta/design-system/badge";
  import { formatDate } from "@magna-carta/design-system/formatters";
  import GitCommitHorizontal from "@lucide/svelte/icons/git-commit-horizontal";
  import { BUILD_IDENTITY } from "$lib/build-identity.ts";
  import { CATEGORY_BADGE, type ChangelogEntry } from "../changelog-entries.ts";
  import ChangelogInline from "../changelog-inline.svelte";
  import CategoryChips from "./category-chips.svelte";
  import * as Select from "@magna-carta/design-system/select";
  import provenance from "./commits.json";

  let { entries, query }: { entries: readonly ChangelogEntry[]; query: string } = $props();
  let category = $state("all");

  const keyOf = (entry: ChangelogEntry) => entry.source.replace(/\s+/g, " ").trim().slice(0, 100);
  const commitOf = (entry: ChangelogEntry): string | null =>
    (provenance.commits as Record<string, string>)[keyOf(entry)] ?? null;
  const areasOf = (entry: ChangelogEntry): string[] =>
    (provenance.areas as Record<string, string[]>)[keyOf(entry)] ?? [];
  const allAreas = [...new Set(entries.flatMap(areasOf))].toSorted();
  const AREA_OPTIONS = [
    { value: "all", label: "Every part of the app" },
    ...allAreas.map((area) => ({ value: area, label: area })),
  ];
  let area = $state("all");

  const visible = $derived(
    entries.filter(
      (entry) =>
        (category === "all" || entry.category === category) &&
        (area === "all" || areasOf(entry).includes(area)) &&
        (query.trim() === "" || entry.searchText.includes(query.trim().toLowerCase())),
    ),
  );
  const dates = $derived([...new Set(visible.map((entry) => entry.date))]);
  let open = $state<string[]>([entries[0]?.date ?? ""]);
</script>

<div class="flex flex-col gap-16">
  <div class="flex flex-wrap items-center gap-8">
    <CategoryChips {entries} bind:selected={category} />
    <Select.Root type="single" items={AREA_OPTIONS} value={area} onValueChange={(value) => (area = value)}>
      <Select.Trigger class="w-3xs" aria-label="Filter by part of the app">
        <Select.Value placeholder="Every part of the app" />
      </Select.Trigger>
      <Select.Content>
        {#each AREA_OPTIONS as option (option.value)}
          <Select.Item value={option.value} label={option.label} />
        {/each}
      </Select.Content>
    </Select.Root>
  </div>
  <Accordion.Root type="multiple" value={open} onValueChange={(value) => (open = value)}>
    {#each dates as date (date)}
      {@const onDate = visible.filter((entry) => entry.date === date)}
      <Accordion.Item value={date}>
        <Accordion.Trigger chevron="start">
          <span class="flex items-baseline gap-12">
            <span class="font-display text-xl">{formatDate(date)}</span>
            <span class="text-sm text-text-muted">{onDate.length} changes</span>
          </span>
        </Accordion.Trigger>
        <Accordion.Content>
          <ul class="flex flex-col divide-y divide-border-default ps-24">
            {#each onDate as entry (entry.id)}
              {@const commit = commitOf(entry)}
              <li class="flex flex-col gap-8 py-16">
                <div class="flex flex-wrap items-start gap-x-12 gap-y-4">
                  <Badge variant={CATEGORY_BADGE[entry.category]}>{entry.category}</Badge>
                  <p class="min-w-0 flex-1 text-base font-semibold text-pretty">
                    <ChangelogInline nodes={entry.headline} />
                  </p>
                  {#if commit !== null}
                    <a
                      class="inline-flex items-center gap-4 rounded-sm px-4 font-mono text-xs text-text-muted hover:text-text-link"
                      href={BUILD_IDENTITY.sourceRepository === null
                        ? undefined
                        : `${BUILD_IDENTITY.sourceRepository}/commit/${commit}`}
                      title={`Shipped in commit ${commit}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <GitCommitHorizontal class="size-16" aria-hidden="true" />
                      {commit.slice(0, 7)}
                    </a>
                  {/if}
                </div>
                {#if areasOf(entry).length > 0}
                  <div class="flex flex-wrap gap-4">
                    {#each areasOf(entry) as tag (tag)}
                      <button type="button" onclick={() => (area = tag)}>
                        <Badge variant="neutral">{tag}</Badge>
                      </button>
                    {/each}
                  </div>
                {/if}
                <div class="flex max-w-prose flex-col gap-8 text-sm text-text-default">
                  {#each entry.detail as paragraph, index (index)}
                    <p class="text-pretty"><ChangelogInline nodes={paragraph} /></p>
                  {/each}
                </div>
              </li>
            {/each}
          </ul>
        </Accordion.Content>
      </Accordion.Item>
    {/each}
  </Accordion.Root>
</div>
