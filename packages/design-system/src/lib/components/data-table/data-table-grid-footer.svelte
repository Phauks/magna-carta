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
    class?: string;
  };
  let { grid, end, class: className }: Props = $props();

  const noun = $derived(grid.totalRowCount === 1 ? grid.itemNoun.singular : grid.itemNoun.plural);
  const selectedCount = $derived(grid.selectedKeys.length);
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
    {:else}
      <span class="mc-table-grid-footer-count">{grid.totalRowCount}</span> {noun}
    {/if}
  </span>
  {#if selectedCount > 0}
    <span class="mc-table-grid-footer-tally">
      · <span class="mc-table-grid-footer-count">{selectedCount}</span> selected ·
      <button
        type="button"
        class="mc-table-grid-footer-link"
        title="Let go of {selectedCount === 1
          ? 'the selected ' + grid.itemNoun.singular
          : 'all ' + selectedCount + ' selected ' + grid.itemNoun.plural}"
        onclick={() => grid.clearSelection()}
      >
        Select none
      </button>
    </span>
  {/if}
  {#if end}
    <span class="mc-table-grid-footer-end">
      {@render end()}
    </span>
  {/if}
</div>
