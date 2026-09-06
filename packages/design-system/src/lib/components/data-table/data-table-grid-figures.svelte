<script lang="ts" generics="TRow">
  /*
   * DataTable.GridFigures — the labelled figures a table's footer ends with, and the one place their
   * shape is decided.
   *
   * THE LABEL LEADS AND THE FIGURE FOLLOWS, on every table. Five surfaces built this strip by hand
   * and one of them had already drifted into the opposite order, which is what a shared strip is for:
   * a reader who has learned to find the number after the word does not relearn it per screen.
   *
   * THE FIGURE ARRIVES AS TEXT. Money, durations and counts each format through their own home, and a
   * strip that took minor units and a currency would have to learn all three. What it owns is the
   * arrangement: the order, the separators, the tabular figures, and the sentence under a filter.
   *
   * UNDER A FILTER IT SAYS SO FIRST. "In view:" is not decoration — a total that silently changed
   * meaning when a column was filtered is the most quietly wrong thing a footer can do.
   */
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { DataTableGridState } from "./data-table-grid-state.svelte.ts";
  import type { GridFigure } from "./grid-figures.ts";

  let {
    grid,
    figures,
    class: className,
  }: {
    grid: DataTableGridState<TRow>;
    figures: readonly GridFigure[];
    class?: string;
  } = $props();
</script>

<span class={mergeClasses("inline-flex items-baseline gap-8", className)} data-grid-figures>
  {#if grid.isFiltered}
    <span class="text-text-link" title="Figures over the rows in view only">In view:</span>
  {/if}
  {#each figures as figure, index (figure.identifier)}
    {#if index > 0}<span aria-hidden="true">·</span>{/if}
    <span class="inline-flex items-baseline gap-4" title={figure.caption}>
      <span class="text-text-subtle">{figure.label}</span>
      <span class="font-semibold tabular-nums">{figure.value}</span>
    </span>
  {/each}
</span>
