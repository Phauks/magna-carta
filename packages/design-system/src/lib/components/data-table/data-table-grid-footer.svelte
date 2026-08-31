<script lang="ts" generics="TRow">
  /*
   * DataTable.GridFooter — the counts strip under the grid, the settled footer conventions:
   * unfiltered it tallies every row; under a filter it reads "Showing n of m · filtered" in the
   * accent register with the filtered columns named and a one-click "Show all"; a selection adds
   * its count with a say-what-it-does "Select none". The strip holds ONE line at a fixed minimum
   * height, so a selection or filter appearing never reflows it. The `end` snippet is the
   * surface's own trailing figures (money, seams) — not this component's business.
   */
  import type { Snippet } from "svelte";
  import Funnel from "@lucide/svelte/icons/funnel";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { DataTableGridState } from "./data-table-grid-state.svelte.ts";

  type Props = {
    grid: DataTableGridState<TRow>;
    /** The surface's own trailing content (labelled figures, seams). */
    end?: Snippet;
    /**
     * Replaces the unfiltered tally's "{n} items" with the surface's own phrasing (the file
     * manager's "2 folders, 5 files"). The filtered tally keeps the shared wording either way, so
     * "Showing n of m · filtered" reads the same on every table.
     */
    tallyText?: string;
    /**
     * Offers "Select all" beside the counts whenever rows exist and not all of them are selected.
     * "Select none" already shows with any selection; together they make the pair a toggle.
     */
    selectAllToggle?: boolean;
    class?: string;
  };
  let {
    grid,
    end,
    tallyText = undefined,
    selectAllToggle = false,
    class: className,
  }: Props = $props();

  const noun = $derived(grid.totalRowCount === 1 ? grid.itemNoun.singular : grid.itemNoun.plural);
  const selectedCount = $derived(grid.selectedKeys.length);
  const allSelected = $derived(
    grid.rowsInViewCount > 0 && selectedCount >= grid.rowsInViewCount,
  );
</script>

<div class={mergeClasses("mc-table-grid-footer", className)}>
  <span class="mc-table-grid-footer-tally">
    {#if grid.isFiltered}
      <span class="mc-table-grid-footer-filtered">
        <Funnel class="mc-table-grid-footer-filtered-icon" aria-hidden="true" />
        Showing {grid.rowsInViewCount} of {grid.totalRowCount}
        {noun} · filtered
      </span>
      <span>on {grid.activeFilterLabels.join(", ")}</span>
      <button
        type="button"
        class="mc-table-grid-footer-link"
        title="Clear every filter and show all {grid.totalRowCount} {noun}"
        onclick={() => grid.clearAllFilters()}
      >
        Show all
      </button>
    {:else if tallyText !== undefined}
      <span>{tallyText}</span>
    {:else}
      <span class="mc-table-grid-footer-count">{grid.totalRowCount}</span> {noun}
    {/if}
  </span>
  {#if selectedCount > 0}
    <span class="mc-table-grid-footer-tally">
      · <span class="mc-table-grid-footer-count">{selectedCount}</span> selected
    </span>
  {/if}
  <!--
    ONE control in ONE place, never two. Select all and Select none are the two ends of a single
    choice, so they take turns in the same spot rather than standing side by side: two controls
    that both act on the selection, both present, made the reader work out which one they wanted.
    Everything selected offers the way back; anything less offers the way to all of it.
  -->
  {#if selectAllToggle && grid.rowsInViewCount > 0}
    <button
      type="button"
      class="mc-table-grid-footer-link"
      title={allSelected
        ? `Let go of all ${String(selectedCount)} selected ${
            selectedCount === 1 ? grid.itemNoun.singular : grid.itemNoun.plural
          }`
        : `Select all ${String(grid.rowsInViewCount)} ${
            grid.rowsInViewCount === 1 ? grid.itemNoun.singular : grid.itemNoun.plural
          } in view`}
      onclick={() => (allSelected ? grid.clearSelection() : grid.selectAll())}
    >
      {allSelected ? "Select none" : "Select all"}
    </button>
  {/if}
  {#if end}
    <span class="mc-table-grid-footer-end">
      {@render end()}
    </span>
  {/if}
</div>
