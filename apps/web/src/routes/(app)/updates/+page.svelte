<script lang="ts">
  /*
   * The Changelog — what changed in Magna Carta, written for the people who use it, newest first.
   *
   * NOTHING ON THIS SCREEN IS WRITTEN HERE. Every entry comes from docs/public-changelog.md, built
   * into this bundle and parsed by $lib/product-updates/public-changelog.ts, so the screen updates
   * itself with every build that carries a public changelog fragment and can only ever describe the
   * build it is part of. There is no read, so there is no loading or failure state: the content is
   * already here when the screen is.
   *
   * It lives at /updates because that is the product-updates route, and the changelog is its first
   * view; What's New highlights and the roadmap join it there as further views rather than as
   * screens of their own. It is reached from the profile menu's Websites > Changelog, which points
   * here until the public changelog site has an address of its own
   * (src/lib/navigation/ecosystem-sites.ts).
   *
   * THE ONE FILTER IS THE CATEGORY. The document already sorts every entry into Added, Changed,
   * Fixed and the rest, and "what was fixed" is a question somebody actually brings to a changelog.
   * A date range is not: the list is newest first, and the newest is what is being looked for.
   */
  import * as Select from "@magna-carta/design-system/select";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import FieldLabel from "@magna-carta/design-system/field-label";
  import Badge from "@magna-carta/design-system/badge";
  import type { BadgeVariant } from "@magna-carta/design-system/badge";
  import { formatDate } from "@magna-carta/design-system/formatters";
  import ScreenHeader from "$lib/screen/screen-header.svelte";
  import {
    CHANGELOG_CATEGORIES,
    type ChangelogCategory,
  } from "@magna-carta/product-updates/schema";
  import { publicChangelogReleases } from "$lib/product-updates/public-changelog.ts";
  import {
    parseChangelogText,
    type ChangelogInline,
  } from "$lib/product-updates/changelog-text.ts";

  const ALL = "all" as const;

  // Parsed once: the document is fixed for the life of the bundle.
  const releases = publicChangelogReleases().map((release) => ({
    date: release.date,
    version: release.version,
    categories: release.categories.map((group) => ({
      category: group.category,
      entries: group.entries.map((entry) => parseChangelogText(entry.text)),
    })),
  }));

  // Only the categories the document actually uses are offered: a filter that can only ever come
  // back empty is a question the screen already knows the answer to.
  const usedCategories = CHANGELOG_CATEGORIES.filter((category) =>
    releases.some((release) => release.categories.some((group) => group.category === category)),
  );
  const CATEGORY_FILTER_OPTIONS = [
    { value: ALL, label: "All changes" },
    ...usedCategories.map((category) => ({ value: category, label: category })),
  ];

  /*
   * A category's chip colour. Additions and fixes are the good news and read as such; a removal or
   * a security change is the one a reader must not skim past.
   */
  const CATEGORY_BADGE: Record<ChangelogCategory, BadgeVariant> = {
    Added: "success",
    Changed: "info",
    Deprecated: "warning",
    Removed: "danger",
    Fixed: "neutral",
    Security: "danger",
  };

  let categoryFilter = $state<ChangelogCategory | typeof ALL>(ALL);

  const visibleReleases = $derived(
    categoryFilter === ALL
      ? releases
      : releases
          .map((release) => ({
            date: release.date,
            version: release.version,
            categories: release.categories.filter((group) => group.category === categoryFilter),
          }))
          .filter((release) => release.categories.length > 0),
  );

  const latest = releases[0]?.date ?? null;
</script>

<svelte:head>
  <title>Changelog · Magna Carta</title>
</svelte:head>

<ScreenHeader title="Changelog" class="mb-24">
  {#snippet meta()}
    {#if latest !== null}
      <span>Last updated {formatDate(latest)}</span>
    {/if}
  {/snippet}
  {#snippet actions()}
    <Select.Root
      type="single"
      items={CATEGORY_FILTER_OPTIONS}
      value={categoryFilter}
      onValueChange={(value) => (categoryFilter = value as ChangelogCategory | typeof ALL)}
    >
      <Select.Trigger class="w-3xs" aria-label="Filter by kind of change">
        <Select.Value placeholder="All changes" />
      </Select.Trigger>
      <Select.Content>
        {#each CATEGORY_FILTER_OPTIONS as option (option.value)}
          <Select.Item value={option.value} label={option.label} />
        {/each}
      </Select.Content>
    </Select.Root>
  {/snippet}
</ScreenHeader>

{#if visibleReleases.length === 0}
  <EmptyState title={categoryFilter === ALL ? "Nothing published yet" : "Nothing of that kind"}>
    {categoryFilter === ALL
      ? "Changes appear here as they ship, newest first."
      : "No published change is in that category. Choosing All changes brings the full list back."}
  </EmptyState>
{:else}
  <div class="flex max-w-prose flex-col gap-32">
    {#each visibleReleases as release (release.date)}
      <section aria-labelledby={`release-${release.date}`}>
        <FieldLabel
          as="h2"
          id={`release-${release.date}`}
          class="mb-16 border-b border-border-strong pb-8"
        >
          {release.version === null
            ? formatDate(release.date)
            : `${release.version} · ${formatDate(release.date)}`}
        </FieldLabel>
        <div class="flex flex-col gap-16">
          {#each release.categories as group (group.category)}
            <div class="flex flex-col gap-8">
              <h3><Badge variant={CATEGORY_BADGE[group.category]}>{group.category}</Badge></h3>
              <ul class="flex flex-col divide-y divide-border-default">
                {#each group.entries as paragraphs, entryIndex (entryIndex)}
                  <li class="flex flex-col gap-8 py-12 text-sm text-text-default first:pt-0">
                    {#each paragraphs as paragraph, paragraphIndex (paragraphIndex)}
                      <p>{@render inline(paragraph)}</p>
                    {/each}
                  </li>
                {/each}
              </ul>
            </div>
          {/each}
        </div>
      </section>
    {/each}
  </div>
{/if}

{#snippet inline(nodes: readonly ChangelogInline[])}
  {#each nodes as node, nodeIndex (nodeIndex)}
    {#if node.kind === "text"}{node.text}{:else if node.kind === "code"}<code
        class="rounded-sm bg-surface-sunken px-4 font-mono text-xs">{node.text}</code
      >{:else if node.kind === "strong"}<strong class="font-semibold"
        >{@render inline(node.children)}</strong
      >{:else}<em>{@render inline(node.children)}</em>{/if}
  {/each}
{/snippet}
