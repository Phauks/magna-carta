<script lang="ts" generics="TRow">
  /*
   * The money toolbar: the strip at the top of every money section's list column.
   *
   * WHERE YOU ARE, AND THE SIBLINGS ONE CLICK AWAY. On a money section the section strip shows
   * "Money" with the gold bar and nothing else, so no word on screen said which of Time, Fees,
   * Costs, Billing or Trust the reader had opened. This row is the file manager's breadcrumb
   * applied to Money: the five sub-parts as quiet links, the current one in the active weight and
   * stated with aria-current, the same words and the same weights the section strip uses because
   * it is the same register. The list comes from the strip's own Money group (money-sections.ts),
   * never a hand-written one.
   *
   * THE ROW IS ALWAYS PRESENT, which amends the ruling that a row above a table exists only while
   * something has to be in it: something now always is. What joins it is what a row above a
   * ledger already carried, the way out of a filter, and a surface's own acts (Costs' Review).
   *
   * THE TWO VIEW CONTROLS END THE ROW. Density and layout are settings about how the table is
   * SHOWN, which is why they sit here beside the navigation, as the file manager's list/icons
   * toggle does, and not on the counts strip beneath the table, which holds the PANE toggles. Each
   * shows the state it would switch TO, as the file manager's toggle does, and says so in its
   * title; density also reads its state through aria-pressed, because "compact" is an on/off
   * rather than a pair of equals.
   */
  import type { Snippet } from "svelte";
  import Button from "@magna-carta/design-system/button";
  import type { DataTableGridState } from "@magna-carta/design-system/data-table";
  import Coins from "@lucide/svelte/icons/coins";
  import Expand from "@lucide/svelte/icons/expand";
  import Frame from "@lucide/svelte/icons/frame";
  import FunnelX from "@lucide/svelte/icons/funnel-x";
  import Rows3 from "@lucide/svelte/icons/rows-3";
  import Rows4 from "@lucide/svelte/icons/rows-4";
  import {
    moneySectionHref,
    moneySections,
    type MoneySectionSlug,
    type MoneySurfaceDensity,
    type MoneySurfaceLayout,
  } from "./money-sections.ts";

  let {
    matterId,
    section,
    grid,
    acts = undefined,
    layout,
    density,
    onLayoutChange,
    onDensityChange,
  }: {
    matterId: string;
    /** Which of the five the reader is on. */
    section: MoneySectionSlug;
    /** The ledger's grid, for the way out of a filter. */
    grid: DataTableGridState<TRow>;
    /** The surface's own acts, after Clear Filters. */
    acts?: Snippet;
    layout: MoneySurfaceLayout;
    density: MoneySurfaceDensity;
    onLayoutChange: (layout: MoneySurfaceLayout) => void;
    onDensityChange: (density: MoneySurfaceDensity) => void;
  } = $props();

  // The section strip's own weights and inks, so the two rows read as one register.
  const linkCurrentClasses = "font-semibold text-text-default";
  const linkOtherClasses = "font-medium text-text-muted";

  const compact = $derived(density === "compact");
  const densityTitle = $derived(compact ? "Show comfortable rows" : "Show compact rows");
  const flush = $derived(layout === "flush");
  const layoutTitle = $derived(
    flush ? "Frame the table inside the page" : "Run the table to the edges of the screen",
  );
  const clearFiltersTitle = $derived(
    `Clear all filters and show all ${String(grid.totalRowCount)} ${grid.itemNoun.plural}`,
  );
</script>

<!-- Flush, the strip is the file manager's: a rule beneath it and the list's own gutter. Framed,
     it is a plain row inside the page's padding, and the column's gap does the spacing. -->
<div
  class={flush
    ? "flex items-center gap-4 border-b border-border-default px-8 py-4"
    : "flex items-center gap-4"}
>
  <Coins class="size-16 shrink-0 text-text-subtle" aria-hidden="true" />
  <nav class="mc-scrollbar flex min-w-0 items-center gap-4 overflow-x-auto" aria-label="Money sections">
    {#each moneySections as moneySection (moneySection.slug)}
      {@const current = moneySection.slug === section}
      <Button
        variant="ghost"
        size="sm"
        href={moneySectionHref(matterId, moneySection.slug)}
        aria-current={current ? "page" : undefined}
        class="whitespace-nowrap {current ? linkCurrentClasses : linkOtherClasses}"
      >
        {moneySection.label}
      </Button>
    {/each}
  </nav>

  <div class="ms-auto flex shrink-0 items-center gap-4">
    {#if grid.isFiltered}
      <Button
        variant="secondary"
        size="sm"
        title={clearFiltersTitle}
        onclick={() => grid.clearAllFilters()}
      >
        <FunnelX class="size-16" aria-hidden="true" />
        Clear Filters
      </Button>
    {/if}
    {#if acts}
      {@render acts()}
    {/if}
    <Button
      variant="ghost"
      size="icon"
      aria-pressed={compact}
      title={densityTitle}
      aria-label={densityTitle}
      onclick={() => onDensityChange(compact ? "comfortable" : "compact")}
    >
      {#if compact}
        <Rows3 class="size-16" aria-hidden="true" />
      {:else}
        <Rows4 class="size-16" aria-hidden="true" />
      {/if}
    </Button>
    <Button
      variant="ghost"
      size="icon"
      title={layoutTitle}
      aria-label={layoutTitle}
      onclick={() => onLayoutChange(flush ? "framed" : "flush")}
    >
      {#if flush}
        <Frame class="size-16" aria-hidden="true" />
      {:else}
        <Expand class="size-16" aria-hidden="true" />
      {/if}
    </Button>
  </div>
</div>
