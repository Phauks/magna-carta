<script lang="ts" generics="TRow">
  /*
   * DataTable.ClearFilters — the one way back to the whole table, and the only place its shape is
   * decided.
   *
   * IT LIVES WHERE THE FILTERS ARE SET, in the surface's own control row above the table. That is
   * the owner's placement (2026-09-03): a reader who narrowed the view from the header looks for
   * the way back where they narrowed it, not at the far end of the strip counting rows.
   *
   * IT EXISTS ONLY WHILE SOMETHING IS IN PLAY, and absence is itself the answer to "is anything
   * hidden". This is the standing rule for a control that undoes a state, and it is why the
   * component renders NOTHING rather than rendering disabled.
   *
   * IT SAYS WHICH ACT IT IS. Column filters alone read "Clear Filters"; a surface whose own search
   * or scope is also holding rows back reads "Show Everything", because clearing a search under a
   * button labelled Clear Filters is a lie about what the press will do. Neither is configured —
   * both are derived from what is actually narrowing the view.
   *
   * THE HOVER STATES WHAT IS IN PLAY rather than restating the control: the control is the way to
   * undo it, and a sentence explaining a control under the reader's pointer is a sentence read once.
   */
  import FunnelX from "@lucide/svelte/icons/funnel-x";
  import Button from "../button/index.ts";
  import type { DataTableGridState } from "./data-table-grid-state.svelte.ts";

  let {
    grid = undefined,
    narrowing = undefined,
    class: className,
  }: {
    /**
     * The table's own filters. Optional because a surface can be narrowed before its grid exists —
     * a server-side search or scope holds rows back whether or not a column filter is set.
     */
    grid?: DataTableGridState<TRow>;
    /**
     * What else is holding rows back besides the column filters — the surface's own search, where it
     * has one. Present and active, the control speaks for both and clears both.
     */
    narrowing?: {
      readonly narrowed: boolean;
      /** What is in play, as the control's hover and the tail of its accessible name. */
      readonly summary: string;
      readonly clear: () => void;
    };
    class?: string;
  } = $props();

  const alsoNarrowed = $derived(narrowing?.narrowed === true);
  const filtered = $derived(grid?.isFiltered === true);
  const inPlay = $derived(filtered || alsoNarrowed);
  const label = $derived(alsoNarrowed ? "Show Everything" : "Clear Filters");
  const count = $derived(grid?.activeFilterCount ?? 0);
  const summary = $derived(
    narrowing?.summary ?? `${String(count)} ${count === 1 ? "column" : "columns"} filtered`,
  );
</script>

{#if inPlay}
  <Button
    variant="secondary"
    size="sm"
    class={className}
    title={summary}
    aria-label="{label}: {summary}"
    onclick={() => (narrowing === undefined ? grid?.clearAllFilters() : narrowing.clear())}
    data-clear-filters
  >
    <FunnelX class="size-16" aria-hidden="true" />
    {label}
  </Button>
{/if}
