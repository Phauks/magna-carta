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
  /*
   * The turn is taken on ANY selection, not on a complete one. Offering "Select all" while rows are
   * selected leaves a partial selection with no way to let go of it from the footer at all — the
   * reader would have to select everything first just to release it. So: something selected offers
   * the way back, nothing selected offers the way to all of it.
   */
  const hasSelection = $derived(selectedCount > 0);
  const releaseTitle = $derived(
    selectedCount === 1
      ? `Let go of the selected ${grid.itemNoun.singular}`
      : `Let go of all ${String(selectedCount)} selected ${grid.itemNoun.plural}`,
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
    Anything selected offers the way back; nothing selected offers the way to all of it.

    The two ends are reached on different terms, which is why this is not one flag. LETTING GO is
    offered wherever a selection exists, on every grid — it undoes something the reader just did,
    and a selection with no way out is a trap. SELECTING ALL is an act of its own, useful only on a
    surface that does something with a whole selection, so it stays opt-in behind selectAllToggle.
    Gating both on the flag is what broke this: grids that never opted in lost their way back.
  -->
  {#if hasSelection || (selectAllToggle && grid.rowsInViewCount > 0)}
    <button
      type="button"
      class="mc-table-grid-footer-link"
      title={hasSelection
        ? releaseTitle
        : `Select all ${String(grid.rowsInViewCount)} ${
            grid.rowsInViewCount === 1 ? grid.itemNoun.singular : grid.itemNoun.plural
          } in view`}
      onclick={() => (hasSelection ? grid.clearSelection() : grid.selectAll())}
    >
      {hasSelection ? "Select none" : "Select all"}
    </button>
  {/if}
  {#if end}
    <span class="mc-table-grid-footer-end">
      {@render end()}
    </span>
  {/if}
</div>
